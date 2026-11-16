/**
 * Remote MCP server (app/mcp/route.ts): Streamable HTTP, stateless (one McpServer + transport per
 * HTTP request), JSON responses.
 *
 * Paid tools use @x402/mcp `createPaymentWrapper` with the SAME x402ResourceServer
 * (getResourceServer) and the SAME requirements (buildRouteConfig → pricing.ts) as the HTTP API:
 *   unpaid tools/call → tool result { isError: true, structuredContent: PaymentRequired }  (x402 MCP transport)
 *   paid  tools/call (params._meta["x402/payment"] = PaymentPayload) → verify → engine → settle
 *         → result { request_id, receipt, ...engineResult } + _meta["x402/payment-response"] = SettleResponse.
 * Engine errors return isError: true, so the wrapper never settles (not charged).
 * The engine is called through the same envelope parsers and engine adapter as the HTTP routes.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { MCP_PAYMENT_RESPONSE_META_KEY, createPaymentWrapper, type MCPToolCallback, type ToolResult } from "@x402/mcp";
import { encodePaymentResponseHeader } from "@x402/core/http";
import type { SettleResponse } from "@x402/core/types";
import type { x402ResourceServer } from "@x402/core/server";
import type { ClientProfile, InvoiceFingerprint } from "@/engine/types";
import { defaultProfile, fingerprintOf, getEngine, llmAdapter } from "@/lib/api/engine";
import { parseAuditEnvelope, parseInvoiceEnvelope } from "@/lib/api/envelope";
import { ApiError, errorBody, toApiError } from "@/lib/api/errors";
import { requestHash } from "@/lib/api/idempotency";
import { newRequestId } from "@/lib/api/request-id";
import { getPayTo, getPaymentMode, type PaymentMode } from "@/lib/payments/config";
import { NETWORK_CAIP2, PAYMENT_SCHEME, assetPrices, getPaidEndpoint, type PaidEndpointId } from "@/lib/payments/pricing";
import { buildReceipt } from "@/lib/payments/receipt";
import { buildRouteConfig, getResourceServer } from "@/lib/payments/server";
import { getStore, type ReceiptRecord } from "@/lib/store";
import { fingerprintKey } from "@/lib/store/stats";
import { buildCatalog } from "./catalog";
import { SERVICE_SLUG, SERVICE_VERSION } from "./meta";
import { GET_CATALOG_TOOL, GET_RECEIPT_TOOL, MCP_SERVER_INSTRUCTIONS, PAID_TOOLS, type PaidToolDef } from "./tools";

type Args = Record<string, unknown>;
type CallResult = { content: { type: "text"; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean; _meta?: Record<string, unknown> };

function jsonResult(body: Record<string, unknown>, isError = false): CallResult {
  return { content: [{ type: "text", text: JSON.stringify(body) }], structuredContent: body, ...(isError ? { isError: true } : {}) };
}

// ---------------------------------------------------------------------------
// Engine call (same envelope parsers + engine adapter as lib/api/paid-route.ts)
// ---------------------------------------------------------------------------

interface ComputeOut {
  result: unknown;
  siren?: string;
  fingerprint?: InvoiceFingerprint | null;
}

function mergeHistory(a: InvoiceFingerprint[] = [], b: InvoiceFingerprint[] = []): InvoiceFingerprint[] {
  const m = new Map<string, InvoiceFingerprint>();
  for (const fp of [...a, ...b]) m.set(fingerprintKey(fp), fp);
  return [...m.values()];
}

export async function computeForTool(endpoint: PaidEndpointId, args: Args): Promise<ComputeOut> {
  if (endpoint === "audit") {
    const env = parseAuditEnvelope(args);
    return { result: await getEngine().auditEntries(env.items, { profile: env.profile, llm: llmAdapter() }) };
  }
  const env = parseInvoiceEnvelope(args, endpoint);
  if ((env.input.format === "pdf" || env.input.format === "image") && !process.env.ANTHROPIC_API_KEY) {
    throw new ApiError(
      "LLM_UNAVAILABLE",
      "Unstructured pdf/image extraction needs the LLM layer, which is not configured on this deployment. Send format json, facturx or ubl. Not charged.",
    );
  }
  const profile: ClientProfile | undefined = env.profile;
  const siren = profile?.siren ?? defaultProfile()?.siren ?? "default";
  let history = env.history;
  if (env.use_server_history) history = mergeHistory(history, await getStore().history(siren));
  const ctx = { profile, history, llm: llmAdapter() };
  if (endpoint === "invoice_check") return { result: await getEngine().checkInvoice(env.input, ctx) };
  const result = await getEngine().createEntry(env.input, ctx);
  return { result, siren, fingerprint: fingerprintOf(result?.invoice) };
}

// ---------------------------------------------------------------------------
// Payment wrappers (one per mode/endpoint/payTo), built lazily at the first paid call
// so tools/list never contacts the facilitator.
// ---------------------------------------------------------------------------

type Wrapper = (h: (args: Args) => Promise<ToolResult>) => MCPToolCallback<Args>;
type Global = typeof globalThis & { __ajeanMcpWrappers?: Map<string, Promise<Wrapper>> };
function wrappers(): Map<string, Promise<Wrapper>> {
  const g = globalThis as Global;
  return (g.__ajeanMcpWrappers ??= new Map());
}

async function ensureInitialized(server: x402ResourceServer): Promise<void> {
  if (!server.getSupportedKind(2, NETWORK_CAIP2, PAYMENT_SCHEME)) await server.initialize();
}

async function createWrapper(tool: PaidToolDef, mode: PaymentMode): Promise<Wrapper> {
  const config = buildRouteConfig(tool.endpoint, mode);
  if (!config) throw new ApiError("SERVICE_MISCONFIGURED", "SERVICE_PAY_TO_ADDRESS is not configured for testnet mode. Not charged.");
  const server = getResourceServer(mode);
  await ensureInitialized(server);
  // Same accepts as the HTTP 402: USDC (default, first) then EURC (ADR-024).
  const options = Array.isArray(config.accepts) ? config.accepts : [config.accepts];
  const accepts = [];
  for (const option of options) {
    accepts.push(
      ...(await server.buildPaymentRequirements({
        scheme: option.scheme,
        network: option.network,
        payTo: option.payTo as string,
        price: option.price as Parameters<x402ResourceServer["buildPaymentRequirements"]>[0]["price"],
        maxTimeoutSeconds: option.maxTimeoutSeconds,
      })),
    );
  }
  const endpoint = getPaidEndpoint(tool.endpoint);
  return createPaymentWrapper(server, {
    accepts,
    resource: {
      url: `mcp://tool/${tool.name}`,
      description: `${endpoint.description} (${assetPrices(endpoint.price_atomic).map((p) => `${p.amount} ${p.asset}`).join(" or ")})`,
      mimeType: "application/json",
      serviceName: "Ajean Ledger",
      tags: ["accounting", "france", "e-invoicing", "vat", tool.name],
    },
  }) as unknown as Wrapper;
}

function getWrapper(tool: PaidToolDef, mode: PaymentMode): Promise<Wrapper> {
  const key = `${mode}:${tool.endpoint}:${getPayTo(mode)}`;
  let w = wrappers().get(key);
  if (!w) {
    w = createWrapper(tool, mode);
    w.catch(() => wrappers().delete(key)); // retry later (e.g. facilitator down)
    wrappers().set(key, w);
  }
  return w;
}

/** Test helper. */
export function resetMcpWrappers(): void {
  wrappers().clear();
}

async function paidToolCall(tool: PaidToolDef, args: Args, extra: unknown): Promise<CallResult> {
  const mode = getPaymentMode();
  const requestId = newRequestId();
  let wrapper: Wrapper;
  try {
    wrapper = await getWrapper(tool, mode);
  } catch (e) {
    const err = e instanceof ApiError ? e : new ApiError("FACILITATOR_UNAVAILABLE", `x402 facilitator error: ${(e as Error).message}. Not charged.`);
    return jsonResult(errorBody(err.code, err.message, err.details, requestId) as unknown as Args, true);
  }

  let computed: ComputeOut | undefined;
  const handler = async (a: Args): Promise<ToolResult> => {
    try {
      computed = await computeForTool(tool.endpoint, a);
      return jsonResult(computed.result as Args) as unknown as ToolResult;
    } catch (e) {
      const err = toApiError(e);
      return jsonResult(errorBody(err.code, err.message, err.details, requestId) as unknown as Args, true) as unknown as ToolResult;
    }
  };

  const out = (await wrapper(handler)(args, extra)) as unknown as CallResult;
  const settle = out._meta?.[MCP_PAYMENT_RESPONSE_META_KEY] as SettleResponse | undefined;
  if (out.isError || !computed || !settle?.success) return out; // 402-equivalent or error: not charged

  // Paid and settled: attach request_id + receipt, persist (receipts tool, operator stats).
  const payload = (extra as { _meta?: Record<string, unknown> } | undefined)?._meta?.["x402/payment"] as { accepted?: { asset?: string } } | undefined;
  const receipt = buildReceipt({ endpoint: tool.endpoint, settle, payTo: getPayTo(mode) ?? "", mode, assetAddress: payload?.accepted?.asset ?? null });
  const record: ReceiptRecord = {
    request_id: requestId,
    endpoint: tool.endpoint,
    idempotency_key: null,
    request_hash: requestHash(tool.endpoint, args, JSON.stringify(args)),
    receipt,
    result: computed.result,
    payment_response: encodePaymentResponseHeader(settle),
    created_at: receipt.paid_at,
  };
  try {
    const store = getStore();
    await store.saveReceipt(record);
    if (computed.fingerprint && computed.siren) await store.saveFingerprint(computed.siren, computed.fingerprint);
  } catch (e) {
    console.error("[mcp] could not persist receipt:", e instanceof Error ? e.message : e);
  }
  const body = { request_id: requestId, receipt, ...(computed.result as Args) };
  return { ...jsonResult(body), _meta: out._meta };
}

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

export function createRemoteMcpServer(baseUrl: string): McpServer {
  const server = new McpServer(
    { name: SERVICE_SLUG, title: "Ajean Ledger", version: SERVICE_VERSION },
    { instructions: MCP_SERVER_INSTRUCTIONS, maxToolInputElements: 200_000 },
  );

  for (const tool of PAID_TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: { title: tool.title, readOnlyHint: true, openWorldHint: false, idempotentHint: true },
        _meta: {
          "x402/price": {
            usdc: getPaidEndpoint(tool.endpoint).price_usdc,
            atomic: getPaidEndpoint(tool.endpoint).price_atomic,
            network: NETWORK_CAIP2,
            eurc: assetPrices(getPaidEndpoint(tool.endpoint).price_atomic).find((p) => p.asset === "EURC")?.amount,
          },
        },
      },
      (async (args: Args, extra: unknown) => paidToolCall(tool, args, extra)) as never,
    );
  }

  server.registerTool(
    GET_CATALOG_TOOL.name,
    { title: GET_CATALOG_TOOL.title, description: GET_CATALOG_TOOL.description, inputSchema: GET_CATALOG_TOOL.inputSchema, annotations: { readOnlyHint: true } },
    (async () => jsonResult(buildCatalog(baseUrl) as unknown as Args)) as never,
  );

  server.registerTool(
    GET_RECEIPT_TOOL.name,
    { title: GET_RECEIPT_TOOL.title, description: GET_RECEIPT_TOOL.description, inputSchema: GET_RECEIPT_TOOL.inputSchema, annotations: { readOnlyHint: true } },
    (async ({ request_id }: { request_id: string }) => {
      const rec = await getStore().getReceipt(request_id);
      if (!rec) return jsonResult(errorBody("NOT_FOUND", `No receipt for ${request_id} (receipts may expire on in-memory deployments).`) as unknown as Args, true);
      return jsonResult({
        request_id: rec.request_id,
        endpoint: rec.endpoint,
        created_at: rec.created_at,
        idempotency_key_used: rec.idempotency_key !== null,
        receipt: rec.receipt,
        result: rec.result,
      });
    }) as never,
  );

  return server;
}

/** Handles one Streamable HTTP request statelessly (new server + transport per request). */
export async function handleMcpRequest(req: Request, baseUrl: string): Promise<Response> {
  const server = createRemoteMcpServer(baseUrl);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    maxRequestBodySize: 5_000_000,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    // JSON mode: the response is complete once handleRequest resolves.
    void transport.close().catch(() => undefined);
    void server.close().catch(() => undefined);
  }
}
