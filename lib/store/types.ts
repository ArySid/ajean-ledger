import type { InvoiceFingerprint } from "@/engine/types";
import type { PaymentMode } from "@/lib/payments/config";
import type { PaymentMethod, Receipt } from "@/lib/payments/receipt";
import type { AssetSymbol, CreditPackId, PaidEndpointId } from "@/lib/payments/pricing";

/** What a stored receipt paid for: a paid endpoint, or a prepaid credit pack ("credits"). */
export type ReceiptEndpointId = PaidEndpointId | "credits";

/** Revenue channel of a receipt: the asset paid via x402, or "credits" (debit on a prepaid token). */
export type RevenueChannel = AssetSymbol | "credits";

export type StoreKind = "memory" | "file" | "neon" | "upstash" | "cloudflare-kv";

/** One paid, settled call. Only successful (200 + settled) calls are stored. */
export interface ReceiptRecord {
  /** = request_id ("req_..."). */
  request_id: string;
  endpoint: ReceiptEndpointId;
  idempotency_key: string | null;
  /** sha256 of endpoint + canonical request body (idempotency conflict detection). */
  request_hash: string;
  receipt: Receipt;
  /** Engine result (without request_id / receipt). */
  result: unknown;
  /** Raw base64 PAYMENT-RESPONSE header, echoed on idempotent replays. */
  payment_response: string | null;
  created_at: string;
}

export interface TxSummary {
  request_id: string;
  endpoint: ReceiptEndpointId;
  amount: string;
  asset: AssetSymbol;
  method: PaymentMethod;
  tx_hash: string;
  payer: string | null;
  mode: Receipt["mode"];
  explorer_url: string | null;
  paid_at: string;
  /** The result asked for a human review (entry / audit results); false when the result carries no such flag. */
  human_review_required: boolean;
}

export interface EndpointRevenue {
  /** Calls served (every payment method). */
  calls: number;
  /** USDC received via x402 (cash in). */
  usdc: string;
  usdc_atomic: string;
  /** EURC received via x402 (cash in, ADR-024). */
  eurc?: string;
  eurc_atomic?: string;
  /** Calls paid by debiting a prepaid credit token (no new cash: the pack was cashed when sold, ADR-025). */
  credit_calls?: number;
}

/** Cash received in one asset. */
export interface AssetRevenue {
  payments: number;
  amount: string;
  amount_atomic: string;
}

/** Prepaid credit packs sold and credit consumed, per payment mode. */
export interface CreditStats {
  packs_sold: number;
  /** Cash received for packs, per asset. */
  sold: Record<AssetSymbol, AssetRevenue>;
  /** Calls paid with credit tokens. */
  calls: number;
  /** Credit consumed by those calls (USDC). */
  consumed_usdc: string;
  consumed_usdc_atomic: string;
}

/**
 * A prepaid credit account (ADR-025). Only the SHA-256 of the bearer token is stored, never the token.
 * Balances are USDC atomic units, whatever asset paid for the pack.
 */
export interface CreditAccount {
  token_hash: string;
  pack: CreditPackId;
  mode: PaymentMode;
  initial_atomic: string;
  balance_atomic: string;
  created_at: string;
  updated_at: string;
  expires_at: string;
  /** request_id of the x402 purchase (POST /api/v1/credits). */
  purchase_request_id: string;
  paid_asset: AssetSymbol;
  paid_amount_atomic: string;
  /** Calls debited so far. */
  calls: number;
}

/**
 * Feeds the /operator page. `calls_served` / `by_mode.*.calls` count the calls to paid endpoints
 * (every payment method); `usdc_earned` / `by_mode.*.usdc` are the USDC received (x402 calls +
 * credit packs paid in USDC). EURC received is in `revenue_by_asset`.
 */
export interface StoreStats {
  store: StoreKind;
  calls_served: number;
  usdc_earned: string;
  usdc_earned_atomic: string;
  by_mode: Record<Receipt["mode"], EndpointRevenue>;
  revenue_per_endpoint: Record<PaidEndpointId, EndpointRevenue>;
  /** Same split per payment mode, so the operator view can show one mode only (Phase 7 review M2). */
  revenue_per_endpoint_by_mode: Record<Receipt["mode"], Record<PaidEndpointId, EndpointRevenue>>;
  /** Cash received per asset (x402 calls + credit packs), per payment mode (ADR-024). */
  revenue_by_asset: Record<Receipt["mode"], Record<AssetSymbol, AssetRevenue>>;
  /** Credit packs sold and credit consumed, per payment mode (ADR-025). */
  credits: Record<Receipt["mode"], CreditStats>;
  recent_transactions: TxSummary[];
}

export interface Store {
  readonly kind: StoreKind;
  saveReceipt(r: ReceiptRecord): Promise<void>;
  getReceipt(requestId: string): Promise<ReceiptRecord | null>;
  getByIdempotencyKey(key: string): Promise<ReceiptRecord | null>;
  listRecent(limit: number): Promise<ReceiptRecord[]>;
  stats(): Promise<StoreStats>;
  /** Remember an invoice fingerprint for a client (duplicate detection across calls). */
  saveFingerprint(profileSiren: string, fp: InvoiceFingerprint): Promise<void>;
  history(profileSiren: string): Promise<InvoiceFingerprint[]>;
  /** Prepaid credit accounts, keyed by the SHA-256 (hex) of the bearer token. */
  getCredit(tokenHash: string): Promise<CreditAccount | null>;
  saveCredit(account: CreditAccount): Promise<void>;
}
