/**
 * GET /llms.txt — Markdown discovery file for LLM agents (llmstxt.org conventions:
 * H1, blockquote summary, details, H2 sections with link lists). Prices from pricing.ts.
 * The "## Errors" section is the target of every error's docs_url ("/llms.txt#errors").
 */
import { rateLimitPerMinute } from "@/lib/api/rate-limit";
import { getPaymentMode, getPayTo } from "@/lib/payments/config";
import {
  AUDIT_MAX_ITEMS,
  CREDIT_PACK_LIST,
  CREDIT_TOKEN_HEADER,
  CREDIT_TTL_DAYS,
  CREDITS_BALANCE_PATH,
  CREDITS_PATH,
  EURC,
  FREE_ENDPOINTS,
  FX_DEMO,
  NETWORK_CAIP2,
  NETWORK_NAME,
  PAID_ENDPOINT_LIST,
  USDC,
  X402_VERSION,
  assetPrices,
} from "@/lib/payments/pricing";
import { MAX_BODY_BYTES, allErrorCodes } from "./errors";
import { EXAMPLE_ENTRY_RESPONSE } from "./examples";
import { DISCLAIMER, SERVICE_NAME, SERVICE_TAGLINE, SERVICE_VERSION, discoveryLinks } from "./meta";
import { GET_CATALOG_TOOL, GET_RECEIPT_TOOL } from "./tools";

const MINIMAL_INVOICE = {
  input: {
    format: "json",
    invoice: {
      document_type: "invoice",
      number: "BE-2026-0412",
      issue_date: "2026-10-05",
      currency: "EUR",
      supplier: { name: "Buro Velours SARL (fictional)", siren: "000001016", vat_id: "FR53000001016", country: "FR", address: "48 boulevard Voltaire, 75011 Paris" },
      customer: { name: "Atelier Lumenor SAS (fictional)", siren: "000001008", vat_id: "FR29000001008", country: "FR", address: "12 rue des Ateliers, 69002 Lyon" },
      operation_nature: "goods",
      lines: [{ description: "Ramettes papier A4 80 g (carton de 5)", quantity: 4, unit_price_excl_vat: 22.5, vat_rate: 0.2, kind: "goods" }],
      totals: { total_excl_vat: 90, total_vat: 18, total_incl_vat: 108 },
      payment_terms: "30 jours date de facture",
      late_payment_penalties: "3 fois le taux d'intérêt légal",
      fixed_recovery_indemnity_mention: true,
    },
  },
};

export function buildLlmsTxt(baseUrl: string): string {
  const mode = getPaymentMode();
  const payTo = getPayTo(mode) ?? "(not configured)";
  const links = discoveryLinks(baseUrl);
  const entry = PAID_ENDPOINT_LIST.find((e) => e.id === "entry")!;
  const resp = EXAMPLE_ENTRY_RESPONSE;
  const exampleResponse = {
    request_id: resp.request_id,
    receipt: { method: resp.receipt.method, amount: resp.receipt.amount, asset: resp.receipt.asset, network: resp.receipt.network, tx_hash: resp.receipt.tx_hash, mode: resp.receipt.mode },
    compliance: { status: resp.compliance.status, checks: ["…"] },
    entry: resp.entry,
    vat: { regime: resp.vat.regime, rate: resp.vat.rate, deductible: resp.vat.deductible },
    anomalies: resp.anomalies,
    confidence: resp.confidence,
    human_review_required: resp.human_review_required,
    explanation: resp.explanation,
  };

  const L: string[] = [];
  L.push(`# ${SERVICE_NAME}`);
  L.push("");
  L.push(`> ${SERVICE_TAGLINE} Built for AI agents: JSON only, no sign-up, no API key — payment is the authentication (x402 v${X402_VERSION}, HTTP 402). Testnet only.`);
  L.push("");
  L.push(`Version ${SERVICE_VERSION}. Base URL: ${baseUrl}. Payment mode of this deployment: **${mode === "testnet" ? "TESTNET" : "SIMULATED"}** (${mode === "testnet" ? "real test-USDC transfers on Base Sepolia" : "same 402 → pay → 200 flow, signatures checked, fake 0x5151… tx hash, no on-chain transfer"}).`);
  L.push("");
  L.push("## What it does");
  L.push("");
  L.push("- Turns a French supplier invoice, credit note or bank transaction into a balanced journal entry with PCG accounts (e.g. 6064 / 44566 / 401…).");
  L.push("- Determines the VAT treatment (standard, reduced, intra-EU reverse charge, exempt, out of scope) with a curated legal-basis id.");
  L.push("- Checks e-invoicing compliance, including the 2026 reform mentions (buyer SIREN, nature of the operation, delivery address, VAT-on-debits option) and classic mandatory mentions; every check has a stable `rule_id` and a `fix_hint`.");
  L.push("- Flags anomalies (duplicate suspected, wrong VAT rate, fixed asset vs expense…), returns a confidence score and `human_review_required`.");
  L.push("- Audits batches of entries with statutory-auditor and tax-inspector viewpoints (structured JSON).");
  L.push("- Inputs: structured JSON invoice, Factur-X PDF (base64), UBL 2.1 XML, bank transaction JSON; plain PDF/image only when the optional LLM layer is configured.");
  L.push("");
  L.push("## When to call it");
  L.push("");
  L.push("- You are an AP / purchasing / expense / pre-bookkeeping agent and must book a French invoice correctly without knowing PCG and French VAT rules → `create_entry`.");
  L.push("- You must decide whether a received e-invoice is compliant before paying it or asking the supplier for a corrected one → `check_invoice`.");
  L.push(`- You must review up to ${AUDIT_MAX_ITEMS} booked entries before a closing or an audit → \`audit_entries\`.`);
  L.push("- Do NOT call it for non-French accounting, for non-EUR invoices or for legal advice. Always surface `human_review_required: true` results to a human.");
  L.push("");
  L.push("## How to pay (x402 v2)");
  L.push("");
  L.push(`Network \`${NETWORK_CAIP2}\` (${NETWORK_NAME}, TESTNET), asset USDC \`${USDC.address}\` (${USDC.decimals} decimals, EIP-712 domain name "${USDC.eip712.name}" version "${USDC.eip712.version}"), scheme \`exact\`, payTo \`${payTo}\`.`);
  L.push("");
  L.push(`Also accepted: **EURC** \`${EURC.address}\` (${EURC.decimals} decimals, EIP-712 domain name "${EURC.eip712.name}" version "${EURC.eip712.version}"). Every 402 lists two \`accepts\`: \`accepts[0]\` = USDC (default; x402 SDK clients pick it), \`accepts[1]\` = EURC at a fixed demo rate (1 EURC = ${FX_DEMO.usdc_per_eurc} USDC, rounded half-up to the cent; an assumption, not a live quote). To pay in EURC, select \`accepts[1]\` and allow the asset in your client (EURC is not an x402 SDK default asset: \`spendControls.allowedAssets\`). \`receipt.asset\` says which asset was paid.`);
  L.push("");
  L.push("1. Call the paid endpoint with your JSON body and no payment → **HTTP 402** + `PAYMENT-REQUIRED` header (base64 JSON: `x402Version`, `resource`, `accepts[0]` = {scheme, network, amount in atomic USDC, asset, payTo, maxTimeoutSeconds, extra}).");
  L.push("2. Sign an EIP-3009 `transferWithAuthorization` for `accepts[0]` with your wallet (e.g. `@x402/fetch` `wrapFetchWithPayment` + `@x402/evm` `ExactEvmScheme`). You only need test USDC; the facilitator pays gas.");
  L.push("3. Retry the same request with the `PAYMENT-SIGNATURE` header (base64 JSON PaymentPayload). Optionally send `Idempotency-Key: <uuid>`.");
  L.push("4. Read the 200 JSON (`request_id`, `receipt` with `tx_hash`, result) and the `PAYMENT-RESPONSE` header (base64 JSON SettleResponse). You are charged only when the call succeeds.");
  L.push("");
  const eurc = (atomic: string) => assetPrices(atomic).find((p) => p.asset === "EURC")!;
  L.push("| Endpoint | MCP tool | Price (USDC) | Atomic units | or EURC |");
  L.push("|---|---|---|---|---|");
  for (const e of PAID_ENDPOINT_LIST) L.push(`| \`${e.method} ${e.path}\` | \`${e.mcp_tool}\` | ${e.price_usdc} | ${e.price_atomic} | ${eurc(e.price_atomic).amount} |`);
  L.push(`| \`POST ${CREDITS_PATH}\` | - | ${CREDIT_PACK_LIST.map((p) => `${p.price_usdc} (${p.id})`).join(" / ")} | ${CREDIT_PACK_LIST.map((p) => p.price_atomic).join(" / ")} | ${CREDIT_PACK_LIST.map((p) => eurc(p.price_atomic).amount).join(" / ")} |`);
  for (const e of FREE_ENDPOINTS) L.push(`| \`${e.method} ${e.path}\` | ${e.id === "catalog" ? `\`${GET_CATALOG_TOOL.name}\`` : e.id === "receipts" ? `\`${GET_RECEIPT_TOOL.name}\`` : "-"} | free | 0 | free |`);
  L.push("");
  L.push("## Prepaid credits (optional)");
  L.push("");
  L.push(`Volume pricing without a per-call signature. The token IS a prepaid payment: payment is still the authentication, no account, no API key.`);
  L.push("");
  for (const p of CREDIT_PACK_LIST) L.push(`- \`${p.id}\`: pay ${p.price_usdc} USDC (or ${eurc(p.price_atomic).amount} EURC) → ${p.credit_usdc} USDC of calls (+${p.bonus_pct}%), valid ${CREDIT_TTL_DAYS} days.`);
  L.push(`- Buy: \`POST ${baseUrl}${CREDITS_PATH}\` with \`{"pack":"starter"}\` — same 402 → pay → 200 x402 flow (send an \`Idempotency-Key\`: a replay returns the same token). x402 SDK clients cap a payment at $1 by default: raise \`spendControls.maxAmountPerPayment\` for \`pro\`.`);
  L.push(`- The 200 contains \`credit_token\` (\`ajc_…\`, bearer secret: only its SHA-256 is stored server-side) and the balance.`);
  L.push(`- Spend: send \`${CREDIT_TOKEN_HEADER}: <credit_token>\` instead of \`PAYMENT-SIGNATURE\` on any paid endpoint. The call's USDC price is debited; the receipt is \`{ "method": "credits", "amount", "remaining_balance", … }\` (no tx hash, no settlement) and the \`X-Credit-Balance\` header has the balance. Errors are never debited; \`Idempotency-Key\` replays are never debited twice.`);
  L.push(`- Low balance or unknown/expired token → **402** \`CREDITS_INSUFFICIENT\` / \`CREDIT_TOKEN_INVALID\` with the normal \`PAYMENT-REQUIRED\` header (pay that call with x402 instead) and \`error.details.credits\` (balance, price). Nothing debited.`);
  L.push(`- Balance: \`GET ${baseUrl}${CREDITS_BALANCE_PATH}\` with the header (free).`);
  L.push("");
  L.push("## Endpoints");
  L.push("");
  for (const e of PAID_ENDPOINT_LIST) {
    L.push(`- [${e.method} ${e.path}](${baseUrl}${e.path}): ${e.price_usdc} USDC (or ${eurc(e.price_atomic).amount} EURC, or prepaid credits). ${e.description} Body: \`${e.input_summary}\`. Returns: ${e.output_summary}.`);
  }
  L.push(`- [POST ${CREDITS_PATH}](${baseUrl}${CREDITS_PATH}): ${CREDIT_PACK_LIST.map((p) => `${p.price_usdc} USDC (${p.id})`).join(" or ")}. Buys a prepaid credit pack. Body: \`{ "pack": "starter" | "pro" }\`. Returns: request_id, receipt, credit_token, balance, expires_at.`);
  for (const e of FREE_ENDPOINTS) L.push(`- [${e.method} ${e.path}](${baseUrl}${e.path.replace("{id}", "{request_id}")}): free. ${e.description}`);
  L.push("");
  L.push("## Discovery");
  L.push("");
  L.push(`- [Catalog](${links.catalog}): JSON manifest (prices, payment details, errors, examples).`);
  L.push(`- [OpenAPI 3.1](${links.openapi}): full request/response schemas, x-x402 price per operation.`);
  L.push(`- [Agent card](${links.agent_card}): A2A-style agent card with skills.`);
  L.push(`- [MCP](${links.mcp}): remote MCP server (Streamable HTTP).`);
  L.push("");
  L.push("## Example");
  L.push("");
  L.push("Unpaid call (learn the price):");
  L.push("");
  L.push("```bash");
  L.push(`curl -i -X POST ${baseUrl}${entry.path} -H 'content-type: application/json' -d '{"input":{"format":"json","invoice":{}}}'`);
  L.push(`# HTTP/1.1 402 Payment Required  +  PAYMENT-REQUIRED: <base64 JSON, accepts[0].amount = "${entry.price_atomic}">`);
  L.push("```");
  L.push("");
  L.push(`Minimal paid request body for \`${entry.path}\` (synthetic data):`);
  L.push("");
  L.push("```json");
  L.push(JSON.stringify(MINIMAL_INVOICE, null, 2));
  L.push("```");
  L.push("");
  L.push("Response (200, truncated, for the full fixture invoice of 140.00 EUR excl. VAT):");
  L.push("");
  L.push("```json");
  L.push(JSON.stringify(exampleResponse, null, 2));
  L.push("```");
  L.push("");
  L.push("Paying from TypeScript:");
  L.push("");
  L.push("```ts");
  L.push('import { wrapFetchWithPayment, x402Client } from "@x402/fetch";');
  L.push('import { ExactEvmScheme } from "@x402/evm/exact/client";');
  L.push('import { privateKeyToAccount } from "viem/accounts";');
  L.push("const account = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY); // testnet wallet");
  L.push(`const pay = wrapFetchWithPayment(fetch, new x402Client().register("${NETWORK_CAIP2}", new ExactEvmScheme(account)));`);
  L.push(`const res = await pay("${baseUrl}${entry.path}", { method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify(body) });`);
  L.push("```");
  L.push("");
  L.push("## MCP");
  L.push("");
  L.push(`- Remote: \`${links.mcp}\` (Streamable HTTP, stateless). Tools: ${PAID_ENDPOINT_LIST.map((e) => `\`${e.mcp_tool}\` (${e.price_usdc} USDC)`).join(", ")}, \`${GET_CATALOG_TOOL.name}\` and \`${GET_RECEIPT_TOOL.name}\` (free). Tool arguments = the HTTP request body.`);
  L.push("- Paid tools follow the x402 MCP transport: the unpaid call returns a tool result with `isError: true` and `structuredContent` = PaymentRequired; retry with `params._meta[\"x402/payment\"]` = PaymentPayload (e.g. `createx402MCPClient` from `@x402/mcp`). The settlement is in `_meta[\"x402/payment-response\"]` and the receipt in the result.");
  L.push("- Local (Claude Desktop): `npm run mcp:stdio` runs a stdio MCP server that pays the HTTP API with your agent wallet (`AGENT_PRIVATE_KEY`) under a spending policy (`AGENT_MAX_PER_CALL_USDC`, `AGENT_DAILY_BUDGET_USDC`).");
  L.push("");
  L.push("## Idempotency and receipts");
  L.push("");
  L.push("- `Idempotency-Key` header (1..128 visible ASCII, UUID recommended): same key + same body → stored response replayed with `Idempotent-Replay: true`, not charged again; different body → 409 `IDEMPOTENCY_CONFLICT`.");
  L.push(`- \`GET ${baseUrl}/api/v1/receipts/{request_id}\` (free) returns the receipt and the stored result.`);
  L.push("- Outputs are deterministic for a given body.");
  L.push("");
  L.push('<a id="errors"></a>');
  L.push("## Errors");
  L.push("");
  L.push("Every error is JSON: `{ \"error\": { \"code\", \"message\", \"details\"?, \"docs_url\": \"/llms.txt#errors\" }, \"request_id\" }`. Errors are never charged (settlement only happens on success).");
  L.push("");
  L.push("| Code | HTTP | Meaning |");
  L.push("|---|---|---|");
  for (const c of allErrorCodes()) L.push(`| \`${c.code}\` | ${c.status} | ${c.description} |`);
  L.push("");
  L.push("## Limits");
  L.push("");
  L.push(`- Body ≤ ${MAX_BODY_BYTES / 1_000_000} MB; audit batches 1..${AUDIT_MAX_ITEMS} items; EUR invoices only; French accounting and VAT rules (PCG, French VAT) only.`);
  const rpm = rateLimitPerMinute();
  L.push(
    rpm
      ? `- Rate limit: ${rpm} requests per client IP and minute on the paid endpoints and \`/mcp\` (fixed 60 s window, per server instance) → 429 \`RATE_LIMITED\` + \`Retry-After\`, never charged. Discovery files are not limited.`
      : "- Rate limit: disabled on this deployment.",
  );
  L.push("- pdf/image inputs need the optional LLM layer (else 503 `LLM_UNAVAILABLE`, not charged); LLM output is always validated by the rules engine (`extraction_method: \"llm\"` + confidence).");
  L.push("- Receipts may be kept in memory on some deployments (lookups can 404 after a restart).");
  L.push("");
  L.push("## Disclaimer");
  L.push("");
  L.push(`- ${DISCLAIMER}`);
  L.push("- Course proof of concept (AI Agent Economy Challenge). All companies and SIREN numbers in examples are fictional. Ambiguous cases return `human_review_required: true`.");
  L.push("");
  return L.join("\n");
}
