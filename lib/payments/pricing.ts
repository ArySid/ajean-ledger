/**
 * Ajean Ledger — SINGLE source of truth for endpoints, prices, accepted assets and credit packs.
 *
 * Everything that shows a price or an endpoint (x402 route config, catalog,
 * openapi.json, llms.txt, agent.json, MCP tools, console, operator view) must
 * read it from here. Prices are USDC strings (2 decimals); atomic units use the
 * 6 decimals of USDC. EURC prices are DERIVED from the USDC prices with a fixed
 * demo conversion rate (ADR-024), never typed by hand.
 *
 * Testnet only: Base Sepolia (CAIP-2 eip155:84532), Circle test USDC (default) and
 * Circle test EURC (second accepted stablecoin, Phase 6 bonus).
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

/**
 * Circle test EURC on Base Sepolia. Verified on-chain (sepolia.base.org eth_call, 2026-11-16):
 * name() = "EURC", version() = "2", decimals() = 6, DOMAIN_SEPARATOR() matches the EIP-712 domain
 * {name "EURC", version "2", chainId 84532, verifyingContract below}, and
 * TRANSFER_WITH_AUTHORIZATION_TYPEHASH() is the EIP-3009 typehash (FiatToken v2, same contract family as USDC).
 */
export const EURC = {
  symbol: "EURC",
  address: "0x808456652fdb597867f38412077A9182bf77359F",
  decimals: 6,
  eip712: { name: "EURC", version: "2" },
} as const;

export type AssetSymbol = "USDC" | "EURC";
export interface AssetInfo {
  symbol: AssetSymbol;
  address: string;
  decimals: number;
  eip712: { name: string; version: string };
}
export const ASSETS: Record<AssetSymbol, AssetInfo> = { USDC, EURC };
/** Accepted assets, in the order of the 402 `accepts` list. USDC MUST stay first (default for every client). */
export const ACCEPTED_ASSETS: readonly AssetSymbol[] = ["USDC", "EURC"] as const;

/**
 * Fixed DEMO conversion rate used to derive EURC prices (ADR-024). Not a live FX feed: an
 * assumption documented in docs/PAYMENTS.md. 1 EURC = 1.08 USDC; EURC prices are rounded
 * half-up to the cent.
 */
export const FX_DEMO = {
  usdc_per_eurc: "1.08",
  numerator: 108n,
  denominator: 100n,
  note: "Fixed demo rate (assumption, not a live FX quote): 1 EURC = 1.08 USDC. EURC prices = USDC price / 1.08, rounded half-up to the cent.",
} as const;

/** Asset by token address (case-insensitive), or null. */
export function assetByAddress(address: string | null | undefined): AssetInfo | null {
  if (!address) return null;
  const a = address.toLowerCase();
  return Object.values(ASSETS).find((x) => x.address.toLowerCase() === a) ?? null;
}

/** USDC atomic → EURC atomic with the demo rate, rounded half-up to the cent (10_000 atomic units). */
export function usdcAtomicToEurcAtomic(usdcAtomic: string | bigint): string {
  const v = BigInt(usdcAtomic);
  const cent = 10_000n;
  const num = v * FX_DEMO.denominator;
  const den = FX_DEMO.numerator * cent;
  return (((num + den / 2n) / den) * cent).toString();
}

/** Atomic price of a USDC-denominated amount in the given asset. */
export function priceInAsset(usdcAtomic: string, asset: AssetSymbol): string {
  return asset === "USDC" ? BigInt(usdcAtomic).toString() : usdcAtomicToEurcAtomic(usdcAtomic);
}

/**
 * Value of an asset amount in USDC atomic units, for spending policies (EURC × 1.08, rounded UP so a
 * budget is never under-counted). USDC is returned unchanged.
 */
export function usdcEquivalentAtomic(asset: AssetSymbol, atomic: string | bigint): bigint {
  const v = BigInt(atomic);
  if (asset === "USDC") return v;
  return (v * FX_DEMO.numerator + FX_DEMO.denominator - 1n) / FX_DEMO.denominator;
}

export interface AssetPrice {
  asset: AssetSymbol;
  /** Decimal string, e.g. "0.14". */
  amount: string;
  /** Atomic units (6 decimals), e.g. "140000". */
  amount_atomic: string;
  address: string;
}

/** Prices of a USDC-denominated amount in every accepted asset, in `accepts` order. */
export function assetPrices(usdcAtomic: string): AssetPrice[] {
  return ACCEPTED_ASSETS.map((sym) => {
    const atomic = priceInAsset(usdcAtomic, sym);
    return { asset: sym, amount: atomicToUsdc(atomic, ASSETS[sym].decimals), amount_atomic: atomic, address: ASSETS[sym].address };
  });
}

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

// ---------------------------------------------------------------------------
// Prepaid credit packs (Phase 6 bonus, ADR-025). Bought with one x402 payment on POST /api/v1/credits;
// the returned bearer token (X-Credit-Token) then pays the paid endpoints at their USDC price.
// ---------------------------------------------------------------------------

export type CreditPackId = "starter" | "pro";

export interface CreditPack {
  id: CreditPackId;
  title: string;
  /** Price of the pack in USDC (decimal string). The EURC price is derived (assetPrices). */
  price_usdc: string;
  price_atomic: string;
  /** Call credit granted, in USDC (decimal string). */
  credit_usdc: string;
  credit_atomic: string;
  /** Volume bonus in percent (credit / price - 1). */
  bonus_pct: number;
}

export const CREDITS_PATH = "/api/v1/credits";
export const CREDITS_BALANCE_PATH = "/api/v1/credits/balance";
export const CREDIT_TOKEN_HEADER = "X-Credit-Token";
/** Credit tokens expire this many days after purchase. */
export const CREDIT_TTL_DAYS = 30;

export const CREDIT_PACKS: Record<CreditPackId, CreditPack> = {
  starter: { id: "starter", title: "Starter pack", price_usdc: "1.00", price_atomic: "1000000", credit_usdc: "1.20", credit_atomic: "1200000", bonus_pct: 20 },
  pro: { id: "pro", title: "Pro pack", price_usdc: "10.00", price_atomic: "10000000", credit_usdc: "12.00", credit_atomic: "12000000", bonus_pct: 20 },
};
export const CREDIT_PACK_LIST: CreditPack[] = Object.values(CREDIT_PACKS);

export function isCreditPackId(v: unknown): v is CreditPackId {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(CREDIT_PACKS, v);
}

export const FREE_ENDPOINTS: FreeEndpoint[] = [
  { id: "catalog", method: "GET", path: "/api/v1/catalog", price_usdc: "0", description: "Machine-readable service and pricing manifest." },
  { id: "openapi", method: "GET", path: "/openapi.json", price_usdc: "0", description: "OpenAPI 3.1 specification." },
  { id: "llms_txt", method: "GET", path: "/llms.txt", price_usdc: "0", description: "Agent discovery file (what the service does, how to pay, examples)." },
  { id: "agent_json", method: "GET", path: "/.well-known/agent.json", price_usdc: "0", description: "Agent card for discovery." },
  { id: "receipts", method: "GET", path: "/api/v1/receipts/{id}", price_usdc: "0", description: "Payment receipt + result retrieval by request_id (idempotency)." },
  { id: "health", method: "GET", path: "/api/health", price_usdc: "0", description: "Service status: payment mode, network, payTo, store kind. No secrets." },
  { id: "credits_balance", method: "GET", path: CREDITS_BALANCE_PATH, price_usdc: "0", description: "Remaining balance and expiry of a prepaid credit token (send it in the X-Credit-Token header)." },
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
