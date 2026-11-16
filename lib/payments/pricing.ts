/**
 * Ajean Ledger — SINGLE source of truth for endpoints and prices.
 *
 * Everything that shows a price or an endpoint (x402 route config, catalog,
 * openapi.json, llms.txt, agent.json, MCP tools, console, operator view) must
 * read it from here. Prices are USDC strings (2 decimals); atomic units use the
 * 6 decimals of USDC.
 *
 * Testnet only: Base Sepolia (CAIP-2 eip155:84532), Circle test USDC.
 */

export const X402_VERSION = 2 as const;
export const NETWORK_CAIP2 = "eip155:84532" as const;
export const NETWORK_NAME = "base-sepolia" as const;
export const CHAIN_ID = 84532 as const;
export const PAYMENT_SCHEME = "exact" as const;

/** Circle test USDC on Base Sepolia (EIP-3009 `transferWithAuthorization`). */
export const USDC = {
  symbol: "USDC",
  address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  decimals: 6,
  /** EIP-712 domain of the token contract, required by the `exact` EVM scheme. */
  eip712: { name: "USDC", version: "2" },
} as const;

export const EXPLORER_TX_BASE_URL = "https://sepolia.basescan.org/tx/";
export const DEFAULT_FACILITATOR_URL = "https://x402.org/facilitator";
/** Max seconds between the 402 and the settlement (validBefore window). */
export const MAX_TIMEOUT_SECONDS = 300;
/** Max entries per /audit call. */
export const AUDIT_MAX_ITEMS = 50;

export type PaidEndpointId = "invoice_check" | "entry" | "audit";

export interface PaidEndpoint {
  id: PaidEndpointId;
  method: "POST";
  path: string;
  /** Price in USDC, decimal string, e.g. "0.15". */
  price_usdc: string;
  /** Price in USDC atomic units (6 decimals), e.g. "150000". */
  price_atomic: string;
  title: string;
  description: string;
  input_summary: string;
  output_summary: string;
  /** Name of the MCP tool that wraps this endpoint. */
  mcp_tool: "check_invoice" | "create_entry" | "audit_entries";
}

export interface FreeEndpoint {
  id: string;
  method: "GET";
  path: string;
  price_usdc: "0";
  description: string;
}

export const PAID_ENDPOINTS: Record<PaidEndpointId, PaidEndpoint> = {
  invoice_check: {
    id: "invoice_check",
    method: "POST",
    path: "/api/v1/invoice/check",
    price_usdc: "0.05",
    price_atomic: "50000",
    title: "E-invoice compliance check",
    description:
      "French e-invoice compliance check: mandatory mentions (incl. 2026 reform: buyer SIREN, operation nature, delivery address, VAT-on-debits option), format and VAT consistency.",
    input_summary:
      '{ input: EngineInput (format "json" | "facturx" | "ubl" | "pdf" | "image"), profile?: ClientProfile, history?: InvoiceFingerprint[] }',
    output_summary:
      "CheckResult: invoice summary, compliance {status, checks[rule_id, passed, severity, fix_hint]}, vat_consistency, anomalies, explanation, engine meta + request_id + receipt",
    mcp_tool: "check_invoice",
  },
  entry: {
    id: "entry",
    method: "POST",
    path: "/api/v1/entry",
    price_usdc: "0.15",
    price_atomic: "150000",
    title: "Journal entry proposal",
    description:
      "Full French journal entry proposal (PCG accounts) + VAT treatment + e-invoicing compliance + anomaly flags for one invoice, credit note or bank transaction.",
    input_summary:
      '{ input: EngineInput (format "json" | "facturx" | "ubl" | "bank_transaction" | "pdf" | "image"), profile?: ClientProfile, history?: InvoiceFingerprint[], use_server_history?: boolean }',
    output_summary:
      "EntryResult: invoice, compliance, entry {journal, lines[account, label, debit, credit], balanced}, vat, anomalies, confidence, human_review_required, explanation, engine meta + request_id + receipt",
    mcp_tool: "create_entry",
  },
  audit: {
    id: "audit",
    method: "POST",
    path: "/api/v1/audit",
    price_usdc: "1.00",
    price_atomic: "1000000",
    title: "Batch audit",
    description:
      "Batch audit of up to 50 entries or invoices (mini FEC extract): duplicates, VAT inconsistencies, suspicious accounts, with statutory-auditor and tax-inspector viewpoints.",
    input_summary: "{ items: AuditEntryInput[] (1..50), profile?: ClientProfile }",
    output_summary:
      "AuditResult: entries_audited, totals, anomalies[entry_ref], viewpoints {statutory_auditor, tax_inspector}, human_review_required, explanation + request_id + receipt",
    mcp_tool: "audit_entries",
  },
};

export const FREE_ENDPOINTS: FreeEndpoint[] = [
  { id: "catalog", method: "GET", path: "/api/v1/catalog", price_usdc: "0", description: "Machine-readable service and pricing manifest." },
  { id: "openapi", method: "GET", path: "/openapi.json", price_usdc: "0", description: "OpenAPI 3.1 specification." },
  { id: "llms_txt", method: "GET", path: "/llms.txt", price_usdc: "0", description: "Agent discovery file (what the service does, how to pay, examples)." },
  { id: "agent_json", method: "GET", path: "/.well-known/agent.json", price_usdc: "0", description: "Agent card for discovery." },
  { id: "receipts", method: "GET", path: "/api/v1/receipts/{id}", price_usdc: "0", description: "Payment receipt + result retrieval by request_id (idempotency)." },
  { id: "health", method: "GET", path: "/api/health", price_usdc: "0", description: "Service status: payment mode, network, payTo, store kind. No secrets." },
];

export const PAID_ENDPOINT_LIST: PaidEndpoint[] = Object.values(PAID_ENDPOINTS);

export function getPaidEndpoint(id: PaidEndpointId): PaidEndpoint {
  return PAID_ENDPOINTS[id];
}

export function findPaidEndpointByPath(path: string): PaidEndpoint | undefined {
  return PAID_ENDPOINT_LIST.find((e) => e.path === path);
}

/** "150000" → "0.15", "1000000" → "1.00", "1" → "0.000001" (at least 2 decimals). */
export function atomicToUsdc(atomic: string | bigint, decimals: number = USDC.decimals): string {
  const v = BigInt(atomic);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  let frac = (abs % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  if (frac.length < 2) frac = frac.padEnd(2, "0");
  return `${neg ? "-" : ""}${whole}.${frac}`;
}

/** "0.15" → "150000". Throws on more than `decimals` fractional digits. */
export function usdcToAtomic(usdc: string, decimals: number = USDC.decimals): string {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(usdc.trim());
  if (!m) throw new Error(`Invalid USDC amount: ${usdc}`);
  const frac = m[2] ?? "";
  if (frac.length > decimals) throw new Error(`Too many decimals in USDC amount: ${usdc}`);
  return (BigInt(m[1]) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0")).toString();
}

export function explorerTxUrl(txHash: string): string {
  return `${EXPLORER_TX_BASE_URL}${txHash}`;
}
