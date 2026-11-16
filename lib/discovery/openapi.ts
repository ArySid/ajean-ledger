/**
 * GET /openapi.json — OpenAPI 3.1 spec, generated from:
 *   - pricing.ts (paths, prices → x-x402 / x-payment per operation),
 *   - lib/discovery/schemas.ts (zod → JSON Schema 2020-12 components),
 *   - lib/discovery/errors.ts (error code enum).
 */
import { IDEMPOTENCY_HEADER, IDEMPOTENCY_KEY_MAX, IDEMPOTENT_REPLAY_HEADER } from "@/lib/api/idempotency";
import { getPaymentMode, getPayTo } from "@/lib/payments/config";
import {
  ACCEPTED_ASSETS,
  ASSETS,
  AUDIT_MAX_ITEMS,
  CREDIT_PACK_LIST,
  CREDIT_TOKEN_HEADER,
  CREDITS_BALANCE_PATH,
  CREDITS_PATH,
  FX_DEMO,
  MAX_TIMEOUT_SECONDS,
  NETWORK_CAIP2,
  NETWORK_NAME,
  PAID_ENDPOINT_LIST,
  PAYMENT_SCHEME,
  USDC,
  X402_VERSION,
  assetPrices,
  priceInAsset,
  type PaidEndpoint,
} from "@/lib/payments/pricing";
import { allErrorCodes } from "./errors";
import { EXAMPLE_CREDIT_RECEIPT, EXAMPLE_ENTRY_RESPONSE, EXAMPLE_REQUESTS, examplePaymentRequiredBody } from "./examples";
import { DISCLAIMER, DISCOVERY_PATHS, SERVICE_NAME, SERVICE_TAGLINE, SERVICE_VERSION } from "./meta";
import { contractJsonSchemas } from "./schemas";

type Obj = Record<string, unknown>;
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

const OPERATION: Record<string, { operationId: string; request: string; response: string; summary: string }> = {
  invoice_check: { operationId: "check_invoice", request: "CheckInvoiceRequest", response: "CheckResponse", summary: "E-invoice compliance check" },
  entry: { operationId: "create_entry", request: "CreateEntryRequest", response: "EntryResponse", summary: "Journal entry proposal" },
  audit: { operationId: "audit_entries", request: "AuditRequest", response: "AuditResponse", summary: "Batch audit" },
};

const errorResponse = (description: string, extraHeaders: Obj = {}) => ({
  description,
  headers: { "X-Request-Id": { $ref: "#/components/headers/X-Request-Id" }, ...extraHeaders },
  content: { "application/json": { schema: ref("ErrorResponse") } },
});

/** The `accepts` list of the 402 for a USDC-denominated price (USDC first, then EURC — ADR-024). */
function acceptsDoc(usdcAtomic: string, payTo: string | null): Obj[] {
  return ACCEPTED_ASSETS.map((sym) => ({
    scheme: PAYMENT_SCHEME,
    network: NETWORK_CAIP2,
    asset: ASSETS[sym].address,
    asset_symbol: sym,
    amount: priceInAsset(usdcAtomic, sym),
    payTo,
    maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
    extra: { name: ASSETS[sym].eip712.name, version: ASSETS[sym].eip712.version },
  }));
}

function paidOperation(e: PaidEndpoint, payTo: string | null, mode: string): Obj {
  const op = OPERATION[e.id];
  const eurc = assetPrices(e.price_atomic).find((p) => p.asset === "EURC")!;
  const x402 = {
    x402Version: X402_VERSION,
    scheme: PAYMENT_SCHEME,
    network: NETWORK_CAIP2,
    asset: USDC.address,
    amount: e.price_atomic,
    price_usdc: e.price_usdc,
    payTo,
    maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
    extra: { name: USDC.eip712.name, version: USDC.eip712.version },
    accepts: acceptsDoc(e.price_atomic, payTo),
    mode,
  };
  return {
    operationId: op.operationId,
    summary: `${op.summary} — ${e.price_usdc} USDC`,
    description:
      `${e.description}\n\nPaid per call: **${e.price_usdc} USDC** (${e.price_atomic} atomic units, ${NETWORK_NAME} testnet) via x402 v2, ` +
      `or **${eurc.amount} EURC** (accepts[1], demo rate 1 EURC = ${FX_DEMO.usdc_per_eurc} USDC). ` +
      "Call without payment → 402 + PAYMENT-REQUIRED; sign the EIP-3009 authorization; retry with PAYMENT-SIGNATURE. " +
      `Prepaid alternative: send ${CREDIT_TOKEN_HEADER} (bought at POST ${CREDITS_PATH}) instead of PAYMENT-SIGNATURE: the USDC price is debited from the token (receipt.method = "credits"). ` +
      "Failed calls (status >= 400) are never settled nor debited." +
      (e.id === "audit" ? ` Batch of 1..${AUDIT_MAX_ITEMS} items.` : ""),
    tags: ["paid"],
    parameters: [
      { $ref: "#/components/parameters/PaymentSignature" },
      { $ref: "#/components/parameters/CreditToken" },
      { $ref: "#/components/parameters/IdempotencyKey" },
    ],
    requestBody: {
      required: true,
      content: { "application/json": { schema: ref(op.request), examples: { fixture_01: { summary: "fixtures/01.json (synthetic)", value: EXAMPLE_REQUESTS[e.id] } } } },
    },
    responses: {
      "200": {
        description: "Paid and settled (or debited from a credit token). Body = engine result + request_id + receipt.",
        headers: {
          "PAYMENT-RESPONSE": { $ref: "#/components/headers/PAYMENT-RESPONSE" },
          "X-Credit-Balance": { $ref: "#/components/headers/X-Credit-Balance" },
          "X-Request-Id": { $ref: "#/components/headers/X-Request-Id" },
          [IDEMPOTENT_REPLAY_HEADER]: { $ref: `#/components/headers/${IDEMPOTENT_REPLAY_HEADER}` },
        },
        content: {
          "application/json": {
            schema: ref(op.response),
            ...(e.id === "entry"
              ? {
                  examples: {
                    fixture_01_truncated: { summary: "Truncated", value: EXAMPLE_ENTRY_RESPONSE },
                    paid_with_credits_truncated: { summary: "Truncated, paid with X-Credit-Token", value: { ...EXAMPLE_ENTRY_RESPONSE, receipt: EXAMPLE_CREDIT_RECEIPT } },
                  },
                }
              : {}),
          },
        },
      },
      "400": { $ref: "#/components/responses/BadRequest" },
      "402": {
        description:
          "Payment required (no PAYMENT-SIGNATURE: code PAYMENT_REQUIRED), rejected (PAYMENT_INVALID), not settled (PAYMENT_SETTLEMENT_FAILED), " +
          "or credit token refused (CREDITS_INSUFFICIENT, CREDIT_TOKEN_INVALID: details.credits; nothing debited). " +
          "The PAYMENT-REQUIRED header (base64 JSON, schema PaymentRequired) carries the requirements to pay: accepts[0] USDC, accepts[1] EURC.",
        headers: {
          "PAYMENT-REQUIRED": { $ref: "#/components/headers/PAYMENT-REQUIRED" },
          "X-Request-Id": { $ref: "#/components/headers/X-Request-Id" },
        },
        content: {
          "application/json": {
            schema: ref("ErrorResponse"),
            example: examplePaymentRequiredBody(payTo ?? "0x…", mode),
          },
        },
      },
      "409": { $ref: "#/components/responses/Conflict" },
      "413": { $ref: "#/components/responses/PayloadTooLarge" },
      "415": { $ref: "#/components/responses/UnsupportedFormat" },
      "422": { $ref: "#/components/responses/Unprocessable" },
      "429": { $ref: "#/components/responses/RateLimited" },
      "500": { $ref: "#/components/responses/Internal" },
      "502": { $ref: "#/components/responses/FacilitatorUnavailable" },
      "503": { $ref: "#/components/responses/Unavailable" },
    },
    "x-x402": x402,
    "x-payment": {
      protocol: "x402",
      required: true,
      price_usdc: e.price_usdc,
      price_atomic: e.price_atomic,
      currency: USDC.symbol,
      network: NETWORK_CAIP2,
      alternatives: [{ currency: "EURC", price: eurc.amount, price_atomic: eurc.amount_atomic }],
      prepaid_credits: { header: CREDIT_TOKEN_HEADER, debit_usdc: e.price_usdc },
    },
    "x-mcp-tool": e.mcp_tool,
  };
}

const freeGet = (operationId: string, summary: string, description: string, content: Obj, extra: Obj = {}): Obj => ({
  get: {
    operationId,
    summary,
    description,
    tags: ["free", ...(extra.tags as string[] | undefined ?? [])],
    "x-payment": { required: false, price_usdc: "0" },
    responses: { "200": { description: "OK", content } },
    ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== "tags")),
  },
});

export function buildOpenApi(baseUrl: string): Obj {
  const mode = getPaymentMode();
  const payTo = getPayTo(mode);
  const schemas = contractJsonSchemas();

  // Error code enum (API codes + engine codes passed through).
  const codes = allErrorCodes();
  const errSchema = schemas.ErrorResponse as { properties?: { error?: { properties?: Obj } } };
  if (errSchema.properties?.error?.properties) {
    errSchema.properties.error.properties.code = {
      type: "string",
      enum: codes.map((c) => c.code),
      description: "Machine-readable error code. See /llms.txt#errors.",
      "x-enum-descriptions": Object.fromEntries(codes.map((c) => [c.code, `${c.status}: ${c.description}`])),
    };
  }

  schemas.AgentCard = { type: "object", description: "A2A-style agent card (see /.well-known/agent.json).", additionalProperties: true };
  schemas.Catalog = { type: "object", description: "Service + pricing manifest (see /api/v1/catalog).", additionalProperties: true };
  schemas.Health = { type: "object", description: "Service status. No secrets.", additionalProperties: true };
  schemas.JsonRpcMessage = {
    type: "object",
    description: "MCP JSON-RPC 2.0 message (initialize, tools/list, tools/call, …).",
    properties: { jsonrpc: { const: "2.0" }, id: { type: ["string", "integer"] }, method: { type: "string" }, params: { type: "object" } },
    required: ["jsonrpc"],
  };

  const paths: Obj = {};
  for (const e of PAID_ENDPOINT_LIST) paths[e.path] = { post: paidOperation(e, payTo, mode) };

  paths["/api/v1/receipts/{id}"] = {
    get: {
      operationId: "get_receipt",
      summary: "Payment receipt + stored result (free)",
      description: "Returns the receipt and the original result of a paid, settled call by request_id. Free.",
      tags: ["free"],
      parameters: [
        { name: "id", in: "path", required: true, description: "request_id (req_…)", schema: { type: "string", pattern: "^req_[0-9A-HJKMNP-TV-Z]{26}$" } },
      ],
      "x-payment": { required: false, price_usdc: "0" },
      responses: {
        "200": { description: "Receipt found", content: { "application/json": { schema: ref("ReceiptLookup") } } },
        "400": errorResponse("INVALID_RECEIPT_ID"),
        "404": errorResponse("NOT_FOUND (in-memory deployments may forget receipts)"),
      },
    },
  };
  paths[CREDITS_PATH] = {
    post: {
      operationId: "buy_credits",
      summary: `Prepaid credit pack — ${CREDIT_PACK_LIST.map((p) => `${p.id} ${p.price_usdc} USDC → ${p.credit_usdc} USDC`).join(", ")}`,
      description:
        `Buys a prepaid credit pack with ONE x402 payment (USDC or EURC, same 402 flow as the paid endpoints; the price depends on body.pack). ` +
        `Returns a bearer credit token valid 30 days: send it as ${CREDIT_TOKEN_HEADER} instead of PAYMENT-SIGNATURE and each call debits its USDC price ` +
        "(no settlement per call). Only the token's SHA-256 is stored; an idempotent replay (same Idempotency-Key) returns the same token. " +
        "x402 SDK clients cap a payment at $1 by default: raise spendControls.maxAmountPerPayment for the pro pack.",
      tags: ["paid", "credits"],
      parameters: [{ $ref: "#/components/parameters/PaymentSignature" }, { $ref: "#/components/parameters/IdempotencyKey" }],
      requestBody: { required: true, content: { "application/json": { schema: ref("CreditPurchaseRequest"), example: { pack: "starter" } } } },
      responses: {
        "200": {
          description: "Paid and settled: credit token issued.",
          headers: { "PAYMENT-RESPONSE": { $ref: "#/components/headers/PAYMENT-RESPONSE" }, "X-Request-Id": { $ref: "#/components/headers/X-Request-Id" } },
          content: { "application/json": { schema: ref("CreditPurchaseResponse") } },
        },
        "400": errorResponse("INVALID_CREDIT_PACK or INVALID_JSON. Not charged."),
        "402": {
          description: "Payment required / invalid / not settled. PAYMENT-REQUIRED header: accepts[0] USDC, accepts[1] EURC for the chosen pack.",
          headers: { "PAYMENT-REQUIRED": { $ref: "#/components/headers/PAYMENT-REQUIRED" } },
          content: { "application/json": { schema: ref("ErrorResponse") } },
        },
        "409": { $ref: "#/components/responses/Conflict" },
        "429": { $ref: "#/components/responses/RateLimited" },
        "502": { $ref: "#/components/responses/FacilitatorUnavailable" },
      },
      "x-x402": {
        x402Version: X402_VERSION,
        scheme: PAYMENT_SCHEME,
        network: NETWORK_CAIP2,
        payTo,
        mode,
        packs: Object.fromEntries(CREDIT_PACK_LIST.map((p) => [p.id, { price_usdc: p.price_usdc, credit_usdc: p.credit_usdc, accepts: acceptsDoc(p.price_atomic, payTo) }])),
      },
      "x-payment": { protocol: "x402", required: true, priced_by: "body.pack" },
    },
  };
  paths[CREDITS_BALANCE_PATH] = freeGet(
    "get_credit_balance",
    "Credit token balance (free)",
    `Remaining USDC balance, pack and expiry of the token sent in ${CREDIT_TOKEN_HEADER}. 404 NOT_FOUND for an unknown token.`,
    { "application/json": { schema: ref("CreditBalance") } },
    { parameters: [{ $ref: "#/components/parameters/CreditToken" }], tags: ["credits"] },
  );
  paths[DISCOVERY_PATHS.catalog] = freeGet("get_catalog", "Service + pricing manifest (free)", "Machine-readable catalog: endpoints, prices, x402 payment details, errors, discovery links.", {
    "application/json": { schema: ref("Catalog") },
  });
  paths[DISCOVERY_PATHS.openapi] = freeGet("get_openapi", "This OpenAPI 3.1 document (free)", "OpenAPI 3.1 specification.", {
    "application/json": { schema: { type: "object" } },
  });
  paths[DISCOVERY_PATHS.llms_txt] = freeGet("get_llms_txt", "llms.txt (free)", "Markdown discovery file for LLM agents (llmstxt.org).", {
    "text/plain": { schema: { type: "string" } },
  });
  paths[DISCOVERY_PATHS.agent_card] = freeGet("get_agent_card", "Agent card (free)", "A2A-style agent card with skills and payment section.", {
    "application/json": { schema: ref("AgentCard") },
  });
  paths[DISCOVERY_PATHS.health] = freeGet("get_health", "Health (free)", "Payment mode, network, payTo, store kind. No secrets.", {
    "application/json": { schema: ref("Health") },
  });
  paths[DISCOVERY_PATHS.mcp] = {
    post: {
      operationId: "mcp",
      summary: "Remote MCP server (Streamable HTTP, stateless)",
      description:
        "Model Context Protocol endpoint. Tools: check_invoice, create_entry, audit_entries (paid via the x402 MCP transport: " +
        "unpaid tools/call → result with isError + structuredContent = PaymentRequired; retry with params._meta['x402/payment'] = PaymentPayload; " +
        "settlement in result._meta['x402/payment-response']) and get_catalog, get_receipt (free). Send Accept: application/json, text/event-stream.",
      tags: ["mcp"],
      "x-payment": { required: "per tool", protocol: "x402 MCP transport" },
      requestBody: { required: true, content: { "application/json": { schema: ref("JsonRpcMessage") } } },
      responses: {
        "200": { description: "JSON-RPC response", content: { "application/json": { schema: ref("JsonRpcMessage") } } },
        "202": { description: "Notification accepted" },
        "406": { description: "Accept header must include application/json and text/event-stream" },
        "429": { $ref: "#/components/responses/RateLimited" },
      },
    },
  };

  return {
    openapi: "3.1.0",
    jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
    info: {
      title: SERVICE_NAME,
      version: SERVICE_VERSION,
      summary: SERVICE_TAGLINE,
      description:
        `${SERVICE_TAGLINE}\n\nBuilt for AI agents: no sign-up, no API key — **payment is the authentication** (x402 v2, ${NETWORK_NAME}, USDC or EURC, or a prepaid credit token bought with x402). ` +
        `Discovery: ${DISCOVERY_PATHS.catalog}, ${DISCOVERY_PATHS.llms_txt}, ${DISCOVERY_PATHS.agent_card}, MCP at ${DISCOVERY_PATHS.mcp}.\n\n${DISCLAIMER}`,
      "x-disclaimer": DISCLAIMER,
    },
    servers: [{ url: baseUrl, description: `Current deployment (payment mode: ${mode})` }],
    tags: [
      { name: "paid", description: "Paid per call in USDC via x402 v2 (HTTP 402)." },
      { name: "free", description: "Free discovery and receipt endpoints." },
      { name: "credits", description: "Prepaid credit packs: one x402 payment, then X-Credit-Token on each call." },
      { name: "mcp", description: "Model Context Protocol." },
    ],
    externalDocs: { description: "llms.txt", url: `${baseUrl}${DISCOVERY_PATHS.llms_txt}` },
    "x-x402": {
      x402Version: X402_VERSION,
      scheme: PAYMENT_SCHEME,
      network: NETWORK_CAIP2,
      asset: { symbol: USDC.symbol, address: USDC.address, decimals: USDC.decimals },
      accepted_assets: ACCEPTED_ASSETS.map((a) => ({ symbol: a, address: ASSETS[a].address, decimals: ASSETS[a].decimals, eip712: ASSETS[a].eip712 })),
      fx: { usdc_per_eurc: FX_DEMO.usdc_per_eurc, note: FX_DEMO.note },
      payTo,
      mode,
      headers: { request: "PAYMENT-SIGNATURE", challenge: "PAYMENT-REQUIRED", receipt: "PAYMENT-RESPONSE", prepaid: CREDIT_TOKEN_HEADER },
    },
    paths,
    components: {
      schemas,
      parameters: {
        PaymentSignature: {
          name: "PAYMENT-SIGNATURE",
          in: "header",
          required: false,
          description: "x402 v2 payment: base64 JSON PaymentPayload (signed EIP-3009 transferWithAuthorization). Omit it to receive the 402 + price.",
          schema: { type: "string", contentEncoding: "base64", contentMediaType: "application/json", contentSchema: ref("PaymentPayload") },
        },
        CreditToken: {
          name: CREDIT_TOKEN_HEADER,
          in: "header",
          required: false,
          description:
            "Prepaid alternative to PAYMENT-SIGNATURE: bearer credit token (ajc_…) bought at POST /api/v1/credits. The call's USDC price is debited; errors are never debited. Ignored when PAYMENT-SIGNATURE is present.",
          schema: { type: "string", pattern: "^ajc_[A-Za-z0-9_-]{43}$" },
        },
        IdempotencyKey: {
          name: IDEMPOTENCY_HEADER,
          in: "header",
          required: false,
          description: "Optional. Same key + same body → stored response replayed, not charged again. Different body → 409.",
          schema: { type: "string", minLength: 1, maxLength: IDEMPOTENCY_KEY_MAX, pattern: "^[\\x21-\\x7e]+$" },
        },
      },
      headers: {
        "PAYMENT-REQUIRED": {
          description: "On 402: base64 JSON PaymentRequired (x402 v2).",
          schema: { type: "string", contentEncoding: "base64", contentMediaType: "application/json", contentSchema: ref("PaymentRequired") },
        },
        "PAYMENT-RESPONSE": {
          description: "On 200: base64 JSON SettleResponse (transaction hash, network, payer).",
          schema: { type: "string", contentEncoding: "base64", contentMediaType: "application/json", contentSchema: ref("SettleResponse") },
        },
        "X-Request-Id": { description: "req_… (same as request_id in the body).", schema: { type: "string" } },
        "X-Credit-Balance": { description: 'Calls paid with X-Credit-Token: remaining USDC balance, e.g. "1.05".', schema: { type: "string" } },
        [IDEMPOTENT_REPLAY_HEADER]: { description: '"true" when the response is a stored idempotent replay (not charged).', schema: { type: "string", enum: ["true"] } },
        "Retry-After": { description: "Seconds to wait.", schema: { type: "integer" } },
      },
      responses: {
        BadRequest: errorResponse("INVALID_JSON, INVALID_INPUT, BATCH_TOO_LARGE, EMPTY_BATCH or INVALID_IDEMPOTENCY_KEY. Not charged."),
        Conflict: errorResponse("IDEMPOTENCY_CONFLICT or IDEMPOTENCY_IN_PROGRESS.", { "Retry-After": { $ref: "#/components/headers/Retry-After" } }),
        PayloadTooLarge: errorResponse("PAYLOAD_TOO_LARGE (body > 5 MB). Not charged."),
        UnsupportedFormat: errorResponse("UNSUPPORTED_FORMAT (details.supported_formats). Not charged."),
        Unprocessable: errorResponse("Engine document error (INVALID_PDF, INVALID_XML, FACTURX_XML_NOT_FOUND, LLM_OUTPUT_INVALID…). Not charged."),
        RateLimited: errorResponse("RATE_LIMITED.", { "Retry-After": { $ref: "#/components/headers/Retry-After" } }),
        Internal: errorResponse("INTERNAL. Not charged."),
        FacilitatorUnavailable: errorResponse("FACILITATOR_UNAVAILABLE. Not charged."),
        Unavailable: errorResponse("LLM_UNAVAILABLE, ENGINE_UNAVAILABLE or SERVICE_MISCONFIGURED. Not charged."),
      },
    },
  };
}
