/**
 * Stdio MCP bridge — tool implementations (entry point: mcp/server.ts).
 *
 * Exposes the same tools as the remote /mcp endpoint. Each paid tool call is an HTTP call to the
 * Ajean Ledger API, paid with @x402/fetch + ExactEvmScheme using the agent wallet, under a spending
 * policy (AGENT_MAX_PER_CALL_USDC, AGENT_DAILY_BUDGET_USDC). Logs go to stderr only; keys are never logged.
 *
 * Asset: USDC by default (accepts[0]); `preferAsset: "EURC"` (env AJEAN_PAY_ASSET=EURC) selects the EURC
 * requirement instead, budgeted at its USDC value (ADR-024). Prepaid credits: with `creditToken`
 * (env AJEAN_CREDIT_TOKEN) each call first tries X-Credit-Token; on a 402 CREDITS_INSUFFICIENT /
 * CREDIT_TOKEN_INVALID it falls back to a normal x402 payment under the policy (ADR-025).
 *
 * Relative imports only: Claude Desktop runs this file with tsx from an arbitrary working directory.
 */
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { decodePaymentResponseHeader, x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import type { PrivateKeyAccount } from "viem/accounts";
import { CREDIT_TOKEN_HEADER, EURC, NETWORK_CAIP2, PAID_ENDPOINTS, assetByAddress, atomicToUsdc, type AssetSymbol } from "../lib/payments/pricing";
import { SERVICE_SLUG, SERVICE_VERSION } from "../lib/discovery/meta";
import { GET_CATALOG_TOOL, GET_RECEIPT_TOOL, MCP_SERVER_INSTRUCTIONS, PAID_TOOLS, type PaidToolDef } from "../lib/discovery/tools";
import { SpendingPolicy } from "./policy";

type Json = Record<string, unknown>;
type CallResult = { content: { type: "text"; text: string }[]; structuredContent?: Json; isError?: boolean; _meta?: Json };

export interface BridgeOptions {
  /** Base URL of the Ajean Ledger HTTP API, e.g. http://localhost:3000 */
  baseUrl: string;
  /** Agent wallet (testnet). Without it, paid tools answer with a clear error; free tools still work. */
  account: PrivateKeyAccount | null;
  policy: SpendingPolicy;
  fetchImpl?: typeof fetch;
  log?: (msg: string) => void;
  /** Asset to pay x402 calls with when the server offers it (default USDC). */
  preferAsset?: AssetSymbol;
  /** Prepaid credit token (ajc_…) tried before any x402 payment. */
  creditToken?: string | null;
}

function result(body: Json, isError = false, note?: string): CallResult {
  const content: CallResult["content"] = [{ type: "text", text: JSON.stringify(body) }];
  if (note) content.push({ type: "text", text: note });
  return { content, structuredContent: body, ...(isError ? { isError: true } : {}) };
}

function policyError(code: string, message: string, details: Json): CallResult {
  return result({ error: { code, message, details, docs_url: "/llms.txt#errors" } }, true, `Refused by the agent spending policy: ${message}`);
}

async function readJson(res: Response): Promise<Json> {
  const text = await res.text();
  try {
    return JSON.parse(text) as Json;
  } catch {
    return { error: { code: "NON_JSON_RESPONSE", message: `HTTP ${res.status}: ${text.slice(0, 300)}` } };
  }
}

export function createBridgeServer(opts: BridgeOptions): McpServer {
  const baseUrl = opts.baseUrl.replace(/\/$/, "");
  const fetchImpl = opts.fetchImpl ?? fetch;
  const log = opts.log ?? ((m: string) => console.error(`[ajean-mcp] ${m}`));
  const { policy } = opts;

  const server = new McpServer(
    { name: `${SERVICE_SLUG}-stdio-bridge`, title: "Ajean Ledger (stdio bridge)", version: SERVICE_VERSION },
    { instructions: MCP_SERVER_INSTRUCTIONS },
  );

  const preferEurc = opts.preferAsset === "EURC";

  /** Tries the prepaid credit token; null = not usable (fall back to x402). */
  async function callWithCredits(tool: PaidToolDef, args: Json): Promise<CallResult | null> {
    const endpoint = PAID_ENDPOINTS[tool.endpoint];
    const url = `${baseUrl}${endpoint.path}`;
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": randomUUID(), [CREDIT_TOKEN_HEADER]: opts.creditToken! },
        body: JSON.stringify(args),
      });
    } catch (e) {
      log(`${tool.name} credits call failed: ${(e as Error).message}`);
      return null;
    }
    const body = await readJson(res);
    if (res.status === 200) {
      const receipt = body.receipt as { remaining_balance?: string } | undefined;
      log(`${tool.name} paid with prepaid credits (${endpoint.price_usdc} USDC), remaining ${receipt?.remaining_balance ?? "?"} USDC`);
      return result(body, false, `Paid ${endpoint.price_usdc} USDC from prepaid credits (no on-chain payment). Remaining balance ${receipt?.remaining_balance ?? "?"} USDC. request_id ${String(body.request_id)}.`);
    }
    const code = (body.error as { code?: string } | undefined)?.code;
    if (res.status === 402 && (code === "CREDITS_INSUFFICIENT" || code === "CREDIT_TOKEN_INVALID")) {
      log(`${tool.name}: credits not usable (${code}), falling back to x402`);
      return null;
    }
    return result({ http_status: res.status, ...body }, true, `HTTP ${res.status}: not charged (errors are never debited).`);
  }

  async function callPaid(tool: PaidToolDef, args: Json): Promise<CallResult> {
    const endpoint = PAID_ENDPOINTS[tool.endpoint];
    if (opts.creditToken) {
      const viaCredits = await callWithCredits(tool, args);
      if (viaCredits) return viaCredits;
    }
    if (!opts.account) {
      return policyError("AGENT_WALLET_MISSING", "AGENT_PRIVATE_KEY is not set for the MCP bridge, so it cannot pay. Set a TESTNET wallet key in the MCP server env.", {
        tool: tool.name,
        price_usdc: endpoint.price_usdc,
      });
    }
    // 1) Local pre-check with the published price (pricing.ts / catalog).
    const listed = BigInt(endpoint.price_atomic);
    const pre = policy.check(listed);
    if (!pre.ok) {
      log(`refused ${tool.name}: ${pre.reason}`);
      return policyError("SPENDING_POLICY_REFUSED", pre.reason!, { tool: tool.name, price_usdc: endpoint.price_usdc, policy: policy.summary() });
    }

    // 2) Authoritative check on the server's x402 requirements, right before signing.
    let reservedAmount = 0n;
    let refusal: string | undefined;
    let paidAsset: AssetSymbol = "USDC";
    const client = x402Client
      .fromConfig({
        schemes: [{ network: NETWORK_CAIP2, client: new ExactEvmScheme(opts.account) }],
        // EURC is not an x402 SDK default asset: allow it explicitly when preferred (the policy still caps the spend).
        spendControls: preferEurc ? { maxAmountPerPayment: false, allowedAssets: [{ network: NETWORK_CAIP2, asset: EURC.address }] } : { maxAmountPerPayment: false },
        paymentRequirementsSelector: (_v, reqs) =>
          (preferEurc ? reqs.find((r) => r.asset.toLowerCase() === EURC.address.toLowerCase()) : undefined) ?? reqs[0],
      })
      .onBeforePaymentCreation(async ({ selectedRequirements }) => {
        const d = policy.checkRequirements(selectedRequirements, preferEurc);
        if (!d.ok) {
          refusal = d.reason;
          return { abort: true as const, reason: d.reason! };
        }
        paidAsset = assetByAddress(selectedRequirements.asset)?.symbol ?? "USDC";
        reservedAmount = d.usdcEquivalent ?? BigInt(selectedRequirements.amount);
        policy.reserve(reservedAmount);
      });
    const payFetch = wrapFetchWithPayment(fetchImpl, client);

    const url = `${baseUrl}${endpoint.path}`;
    const idemKey = randomUUID();
    log(`${tool.name} → POST ${url} (listed ${endpoint.price_usdc} USDC)`);
    let res: Response;
    try {
      res = await payFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": idemKey },
        body: JSON.stringify(args),
      });
    } catch (e) {
      if (reservedAmount) policy.release(reservedAmount);
      if (refusal) {
        log(`refused ${tool.name}: ${refusal}`);
        return policyError("SPENDING_POLICY_REFUSED", refusal, { tool: tool.name, policy: policy.summary() });
      }
      const msg = (e as Error).message;
      log(`${tool.name} failed: ${msg}`);
      return result({ error: { code: "BRIDGE_REQUEST_FAILED", message: `Could not call ${url}: ${msg}`, docs_url: "/llms.txt#errors" } }, true);
    }

    const body = await readJson(res);
    const settledHeader = res.headers.get("PAYMENT-RESPONSE");
    const replay = res.headers.get("Idempotent-Replay") === "true";
    if (res.status === 200 && settledHeader && !replay && reservedAmount) {
      let paid = reservedAmount;
      let paidLabel = `${atomicToUsdc(paid)} USDC`;
      try {
        const s = decodePaymentResponseHeader(settledHeader);
        if (s.amount && /^\d+$/.test(s.amount)) {
          // Budget in USDC: an EURC payment counts at its USDC value (reserved above).
          if (paidAsset === "USDC") paid = BigInt(s.amount);
          paidLabel = `${atomicToUsdc(s.amount)} ${paidAsset}`;
        }
      } catch {
        /* keep the reserved amount */
      }
      policy.release(reservedAmount);
      policy.commit(paid);
      const receipt = body.receipt as { tx_hash?: string; mode?: string } | undefined;
      log(`${tool.name} paid ${paidLabel} (${receipt?.mode ?? "?"}) tx ${receipt?.tx_hash ?? "?"}; spent today ${policy.summary().spent_today_usdc} USDC`);
      const s = policy.summary();
      return {
        ...result(
          body,
          false,
          `Paid ${paidLabel} via x402 (${String(receipt?.mode ?? "").toUpperCase()}), tx ${receipt?.tx_hash}. Spent today ${s.spent_today_usdc}/${s.daily_budget_usdc} USDC. request_id ${String(body.request_id)}.`,
        ),
        _meta: { "ajean/spending": s },
      };
    }
    if (reservedAmount) policy.release(reservedAmount);
    if (res.status === 200) return result(body, false, replay ? "Idempotent replay: not charged again." : undefined);
    log(`${tool.name} → HTTP ${res.status} (not charged)`);
    return result({ http_status: res.status, ...body }, true, `HTTP ${res.status}: not charged (Ajean Ledger never settles failed calls).`);
  }

  for (const tool of PAID_TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: `${tool.description} This local bridge pays automatically with the configured agent wallet within its spending policy.`,
        inputSchema: tool.inputSchema,
        annotations: { title: tool.title, readOnlyHint: true, openWorldHint: true },
      },
      (async (args: Json) => callPaid(tool, args)) as never,
    );
  }

  server.registerTool(
    GET_CATALOG_TOOL.name,
    { title: GET_CATALOG_TOOL.title, description: GET_CATALOG_TOOL.description, inputSchema: GET_CATALOG_TOOL.inputSchema, annotations: { readOnlyHint: true } },
    (async () => {
      try {
        const res = await fetchImpl(`${baseUrl}/api/v1/catalog`);
        const body = await readJson(res);
        return result({ ...body, agent_spending_policy: policy.summary() }, !res.ok);
      } catch (e) {
        return result({ error: { code: "BRIDGE_REQUEST_FAILED", message: `Could not reach ${baseUrl}: ${(e as Error).message}` } }, true);
      }
    }) as never,
  );

  server.registerTool(
    GET_RECEIPT_TOOL.name,
    { title: GET_RECEIPT_TOOL.title, description: GET_RECEIPT_TOOL.description, inputSchema: GET_RECEIPT_TOOL.inputSchema, annotations: { readOnlyHint: true } },
    (async ({ request_id }: { request_id: string }) => {
      try {
        const res = await fetchImpl(`${baseUrl}/api/v1/receipts/${encodeURIComponent(request_id)}`);
        return result(await readJson(res), !res.ok);
      } catch (e) {
        return result({ error: { code: "BRIDGE_REQUEST_FAILED", message: `Could not reach ${baseUrl}: ${(e as Error).message}` } }, true);
      }
    }) as never,
  );

  return server;
}
