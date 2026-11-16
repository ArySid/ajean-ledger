/**
 * GET /api/v1/catalog — machine-readable service + pricing manifest (free).
 * Built from pricing.ts (prices, endpoints), payments config (mode, payTo, facilitator) and
 * lib/api/errors.ts (error codes). No secrets.
 */
import { DOCS_BASE_URL, ERROR_STATUS } from "@/lib/api/errors";
import { IDEMPOTENCY_HEADER, IDEMPOTENCY_KEY_MAX, IDEMPOTENT_REPLAY_HEADER } from "@/lib/api/idempotency";
import { rateLimitPerMinute } from "@/lib/api/rate-limit";
import { getFacilitatorUrl, getPaymentMode, getPayTo } from "@/lib/payments/config";
import {
  AUDIT_MAX_ITEMS,
  CHAIN_ID,
  EXPLORER_TX_BASE_URL,
  FREE_ENDPOINTS,
  MAX_TIMEOUT_SECONDS,
  NETWORK_CAIP2,
  NETWORK_NAME,
  PAID_ENDPOINT_LIST,
  PAYMENT_SCHEME,
  USDC,
  X402_VERSION,
} from "@/lib/payments/pricing";
import { MAX_BODY_BYTES, allErrorCodes } from "./errors";
import { EXAMPLE_ENTRY_RESPONSE, EXAMPLE_REQUESTS } from "./examples";
import { DISCLAIMER, PROVIDER, SERVICE_NAME, SERVICE_SLUG, SERVICE_TAGLINE, SERVICE_VERSION, discoveryLinks } from "./meta";
import { GET_CATALOG_TOOL, GET_RECEIPT_TOOL } from "./tools";

const REQUEST_SCHEMA: Record<string, string> = {
  invoice_check: "CheckInvoiceRequest",
  entry: "CreateEntryRequest",
  audit: "AuditRequest",
};
const RESPONSE_SCHEMA: Record<string, string> = {
  invoice_check: "CheckResponse",
  entry: "EntryResponse",
  audit: "AuditResponse",
};
const FORMATS: Record<string, string[]> = {
  invoice_check: ["json", "facturx", "ubl", "pdf", "image"],
  entry: ["json", "facturx", "ubl", "bank_transaction", "pdf", "image"],
  audit: [],
};

export function paymentInfo() {
  const mode = getPaymentMode();
  return {
    protocol: "x402",
    x402Version: X402_VERSION,
    scheme: PAYMENT_SCHEME,
    network: NETWORK_CAIP2,
    network_name: NETWORK_NAME,
    chain_id: CHAIN_ID,
    testnet: true,
    asset: { symbol: USDC.symbol, address: USDC.address, decimals: USDC.decimals, eip712: USDC.eip712 },
    payTo: getPayTo(mode),
    facilitator: mode === "testnet" ? getFacilitatorUrl() : "local simulated facilitator (no on-chain transaction)",
    mode,
    mode_label: mode === "testnet" ? "TESTNET" : "SIMULATED",
    max_timeout_seconds: MAX_TIMEOUT_SECONDS,
    explorer_tx_base_url: EXPLORER_TX_BASE_URL,
    authentication: "none — payment is the authentication (no sign-up, no API key)",
    charged_only_on_success: true,
    headers: {
      payment_required: "PAYMENT-REQUIRED",
      payment_signature: "PAYMENT-SIGNATURE",
      payment_response: "PAYMENT-RESPONSE",
    },
    how_to_pay: [
      "1. Call the paid endpoint with your JSON body and no payment: you get HTTP 402 with a PAYMENT-REQUIRED header (base64 JSON PaymentRequired: x402Version 2, resource, accepts[0] = {scheme: exact, network, amount (atomic USDC), asset, payTo, maxTimeoutSeconds, extra {name, version}}).",
      "2. Sign an EIP-3009 transferWithAuthorization for accepts[0] (amount to payTo, USDC EIP-712 domain from extra) with your wallet, e.g. @x402/fetch + ExactEvmScheme.",
      "3. Retry the exact same request with the PAYMENT-SIGNATURE header (base64 JSON PaymentPayload). Optionally add an Idempotency-Key header.",
      "4. Read the 200 JSON result (request_id + receipt + result) and the PAYMENT-RESPONSE header (base64 JSON SettleResponse with the transaction hash). Failed calls (status >= 400) are never settled.",
    ],
    sdk: { client: ["@x402/fetch", "@x402/evm (ExactEvmScheme)", "@x402/mcp (createx402MCPClient)"], version: "2.31.0" },
    test_funds: "Base Sepolia test USDC from https://faucet.circle.com (gas is paid by the facilitator).",
  };
}

export function buildCatalog(baseUrl: string) {
  const links = discoveryLinks(baseUrl);
  return {
    service: SERVICE_NAME,
    id: SERVICE_SLUG,
    version: SERVICE_VERSION,
    description: SERVICE_TAGLINE,
    disclaimer: DISCLAIMER,
    provider: PROVIDER,
    base_url: baseUrl,
    audience: "AI agents (machine-to-machine). JSON in, JSON out. No human UI in the product path.",
    payment: paymentInfo(),
    endpoints: {
      paid: PAID_ENDPOINT_LIST.map((e) => ({
        id: e.id,
        method: e.method,
        path: e.path,
        url: `${baseUrl}${e.path}`,
        title: e.title,
        description: e.description,
        price_usdc: e.price_usdc,
        price_atomic: e.price_atomic,
        currency: USDC.symbol,
        input_summary: e.input_summary,
        output_summary: e.output_summary,
        input_formats: FORMATS[e.id],
        ...(e.id === "audit" ? { max_items: AUDIT_MAX_ITEMS } : {}),
        request_schema: `${links.openapi}#/components/schemas/${REQUEST_SCHEMA[e.id]}`,
        response_schema: `${links.openapi}#/components/schemas/${RESPONSE_SCHEMA[e.id]}`,
        mcp_tool: e.mcp_tool,
        example_request: EXAMPLE_REQUESTS[e.id],
      })),
      free: FREE_ENDPOINTS.map((e) => ({
        id: e.id,
        method: e.method,
        path: e.path,
        url: `${baseUrl}${e.path}`,
        price_usdc: e.price_usdc,
        description: e.description,
      })),
    },
    idempotency: {
      header: IDEMPOTENCY_HEADER,
      format: `1..${IDEMPOTENCY_KEY_MAX} visible ASCII characters (UUID recommended)`,
      behaviour:
        "Same key + same endpoint + same body → stored response replayed (same request_id and receipt), not charged again, header Idempotent-Replay: true. Same key + different body → 409 IDEMPOTENCY_CONFLICT.",
      replay_header: IDEMPOTENT_REPLAY_HEADER,
      receipts_endpoint: `${baseUrl}/api/v1/receipts/{request_id}`,
    },
    mcp: {
      remote_url: links.mcp,
      transport: "streamable-http (stateless, JSON responses)",
      paid_tools: PAID_ENDPOINT_LIST.map((e) => ({ name: e.mcp_tool, price_usdc: e.price_usdc, endpoint: e.path })),
      free_tools: [GET_CATALOG_TOOL.name, GET_RECEIPT_TOOL.name],
      payment: "x402 MCP transport: unpaid call → tool result with PaymentRequired (isError); retry with _meta['x402/payment']; receipt in _meta['x402/payment-response'] and in the result.",
      stdio_bridge: "npm run mcp:stdio (mcp/server.ts): local MCP server for Claude Desktop that pays the HTTP API with the agent wallet under a spending policy.",
    },
    errors: {
      format: { error: { code: "string", message: "string", details: "optional", docs_url: DOCS_BASE_URL }, request_id: "req_…" },
      docs_url: `${links.llms_txt}#errors`,
      codes: allErrorCodes().map((c) => ({ code: c.code, http_status: c.status, description: c.description })),
      never_charged_on_error: true,
      http_statuses: [...new Set(Object.values(ERROR_STATUS))].sort(),
    },
    discovery: links,
    examples: {
      create_entry: { request: EXAMPLE_REQUESTS.entry, response_truncated: EXAMPLE_ENTRY_RESPONSE },
    },
    limits: {
      max_body_bytes: MAX_BODY_BYTES,
      audit_max_items: AUDIT_MAX_ITEMS,
      currency: "EUR invoices only",
      rate_limit_per_minute: rateLimitPerMinute(),
      rate_limit: "per client IP, fixed 60 s window (429 RATE_LIMITED + Retry-After); 0 = disabled",
      unstructured_documents: "pdf/image need the optional LLM layer (else 503 LLM_UNAVAILABLE, not charged)",
    },
    generated_at: new Date().toISOString(),
  };
}
