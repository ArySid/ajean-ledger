import type { InvoiceFingerprint } from "@/engine/types";
import type { Receipt } from "@/lib/payments/receipt";
import type { PaidEndpointId } from "@/lib/payments/pricing";

export type StoreKind = "memory" | "file" | "neon" | "upstash" | "cloudflare-kv";

/** One paid, settled call. Only successful (200 + settled) calls are stored. */
export interface ReceiptRecord {
  /** = request_id ("req_..."). */
  request_id: string;
  endpoint: PaidEndpointId;
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
  endpoint: PaidEndpointId;
  amount: string;
  tx_hash: string;
  payer: string | null;
  mode: Receipt["mode"];
  explorer_url: string | null;
  paid_at: string;
  /** The result asked for a human review (entry / audit results); false when the result carries no such flag. */
  human_review_required: boolean;
}

export interface EndpointRevenue {
  calls: number;
  usdc: string;
  usdc_atomic: string;
}

/** Feeds the /operator page. Amounts are USDC strings. */
export interface StoreStats {
  store: StoreKind;
  calls_served: number;
  usdc_earned: string;
  usdc_earned_atomic: string;
  by_mode: Record<Receipt["mode"], EndpointRevenue>;
  revenue_per_endpoint: Record<PaidEndpointId, EndpointRevenue>;
  /** Same split per payment mode, so the operator view can show one mode only (Phase 7 review M2). */
  revenue_per_endpoint_by_mode: Record<Receipt["mode"], Record<PaidEndpointId, EndpointRevenue>>;
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
}
