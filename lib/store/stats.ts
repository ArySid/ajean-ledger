import { PAID_ENDPOINT_LIST, atomicToUsdc, type PaidEndpointId } from "@/lib/payments/pricing";
import type { EndpointRevenue, ReceiptRecord, StoreKind, StoreStats, TxSummary } from "./types";

export function toTxSummary(r: ReceiptRecord): TxSummary {
  return {
    request_id: r.request_id,
    endpoint: r.endpoint,
    amount: r.receipt.amount,
    tx_hash: r.receipt.tx_hash,
    payer: r.receipt.payer,
    mode: r.receipt.mode,
    explorer_url: r.receipt.explorer_url,
    paid_at: r.receipt.paid_at,
    human_review_required: (r.result as { human_review_required?: unknown } | null)?.human_review_required === true,
  };
}

function rev(calls: number, atomic: bigint): EndpointRevenue {
  return { calls, usdc: atomicToUsdc(atomic), usdc_atomic: atomic.toString() };
}

/** Aggregated counters: key = `${mode}:${endpoint}` → { calls, atomic }. */
export type Counters = Map<string, { calls: number; atomic: bigint }>;

export function countersFromRecords(records: ReceiptRecord[]): Counters {
  const c: Counters = new Map();
  for (const r of records) {
    const k = `${r.receipt.mode}:${r.endpoint}`;
    const cur = c.get(k) ?? { calls: 0, atomic: 0n };
    cur.calls += 1;
    cur.atomic += BigInt(r.receipt.amount_atomic);
    c.set(k, cur);
  }
  return c;
}

export function buildStats(store: StoreKind, counters: Counters, recent: ReceiptRecord[]): StoreStats {
  let calls = 0;
  let atomic = 0n;
  const byMode = { testnet: { calls: 0, atomic: 0n }, simulated: { calls: 0, atomic: 0n } };
  const byEndpoint = new Map<PaidEndpointId, { calls: number; atomic: bigint }>();
  for (const e of PAID_ENDPOINT_LIST) byEndpoint.set(e.id, { calls: 0, atomic: 0n });
  const byModeEndpoint = {
    testnet: new Map(PAID_ENDPOINT_LIST.map((e) => [e.id, { calls: 0, atomic: 0n }])),
    simulated: new Map(PAID_ENDPOINT_LIST.map((e) => [e.id, { calls: 0, atomic: 0n }])),
  } as Record<"testnet" | "simulated", Map<PaidEndpointId, { calls: number; atomic: bigint }>>;
  for (const [key, v] of counters) {
    const [mode, endpoint] = key.split(":") as ["testnet" | "simulated", PaidEndpointId];
    calls += v.calls;
    atomic += v.atomic;
    if (mode in byMode) {
      byMode[mode].calls += v.calls;
      byMode[mode].atomic += v.atomic;
      const me = byModeEndpoint[mode].get(endpoint);
      if (me) {
        me.calls += v.calls;
        me.atomic += v.atomic;
      }
    }
    const ep = byEndpoint.get(endpoint);
    if (ep) {
      ep.calls += v.calls;
      ep.atomic += v.atomic;
    }
  }
  return {
    store,
    calls_served: calls,
    usdc_earned: atomicToUsdc(atomic),
    usdc_earned_atomic: atomic.toString(),
    by_mode: { testnet: rev(byMode.testnet.calls, byMode.testnet.atomic), simulated: rev(byMode.simulated.calls, byMode.simulated.atomic) },
    revenue_per_endpoint: Object.fromEntries(
      [...byEndpoint].map(([id, v]) => [id, rev(v.calls, v.atomic)]),
    ) as Record<PaidEndpointId, EndpointRevenue>,
    revenue_per_endpoint_by_mode: {
      testnet: Object.fromEntries([...byModeEndpoint.testnet].map(([id, v]) => [id, rev(v.calls, v.atomic)])) as Record<PaidEndpointId, EndpointRevenue>,
      simulated: Object.fromEntries([...byModeEndpoint.simulated].map(([id, v]) => [id, rev(v.calls, v.atomic)])) as Record<PaidEndpointId, EndpointRevenue>,
    },
    recent_transactions: recent.map(toTxSummary),
  };
}

export function fingerprintKey(fp: { supplier_key: string; number: string; issue_date: string }): string {
  return `${fp.supplier_key}|${fp.number}|${fp.issue_date}`;
}
