import { ACCEPTED_ASSETS, ASSETS, PAID_ENDPOINT_LIST, atomicToUsdc, type AssetSymbol, type PaidEndpointId } from "@/lib/payments/pricing";
import { receiptAsset, receiptMethod } from "@/lib/payments/receipt";
import type {
  AssetRevenue,
  CreditStats,
  EndpointRevenue,
  ReceiptEndpointId,
  ReceiptRecord,
  RevenueChannel,
  StoreKind,
  StoreStats,
  TxSummary,
} from "./types";

type Mode = "testnet" | "simulated";
const MODES: Mode[] = ["testnet", "simulated"];

export function toTxSummary(r: ReceiptRecord): TxSummary {
  return {
    request_id: r.request_id,
    endpoint: r.endpoint,
    amount: r.receipt.amount,
    asset: receiptAsset(r.receipt),
    method: receiptMethod(r.receipt),
    tx_hash: r.receipt.tx_hash,
    payer: r.receipt.payer,
    mode: r.receipt.mode,
    explorer_url: r.receipt.explorer_url,
    paid_at: r.receipt.paid_at,
    human_review_required: (r.result as { human_review_required?: unknown } | null)?.human_review_required === true,
  };
}

/** Revenue channel of a stored receipt: the asset paid via x402, or "credits". */
export function channelOf(r: ReceiptRecord): RevenueChannel {
  return receiptMethod(r.receipt) === "credits" ? "credits" : receiptAsset(r.receipt);
}

/**
 * Counter key: `${mode}:${endpoint}:${channel}`. Legacy keys written before ADR-024 have two parts
 * (`${mode}:${endpoint}`) and are read as USDC.
 */
export function counterKey(r: ReceiptRecord): string {
  return `${r.receipt.mode}:${r.endpoint}:${channelOf(r)}`;
}

export function parseCounterKey(key: string): { mode: string; endpoint: string; channel: RevenueChannel } {
  const [mode, endpoint, channel] = key.split(":");
  const ch: RevenueChannel = channel === "EURC" ? "EURC" : channel === "credits" ? "credits" : "USDC";
  return { mode, endpoint, channel: ch };
}

/** Aggregated counters: key = counterKey() → { calls, atomic }. */
export type Counters = Map<string, { calls: number; atomic: bigint }>;

export function countersFromRecords(records: ReceiptRecord[]): Counters {
  const c: Counters = new Map();
  for (const r of records) {
    const k = counterKey(r);
    const cur = c.get(k) ?? { calls: 0, atomic: 0n };
    cur.calls += 1;
    cur.atomic += BigInt(r.receipt.amount_atomic);
    c.set(k, cur);
  }
  return c;
}

interface Acc {
  calls: number;
  usdc: bigint;
  eurc: bigint;
  credit_calls: number;
}
const acc = (): Acc => ({ calls: 0, usdc: 0n, eurc: 0n, credit_calls: 0 });

function rev(a: Acc): EndpointRevenue {
  return {
    calls: a.calls,
    usdc: atomicToUsdc(a.usdc),
    usdc_atomic: a.usdc.toString(),
    eurc: atomicToUsdc(a.eurc, ASSETS.EURC.decimals),
    eurc_atomic: a.eurc.toString(),
    credit_calls: a.credit_calls,
  };
}

function assetRev(payments: number, atomic: bigint, asset: AssetSymbol): AssetRevenue {
  return { payments, amount: atomicToUsdc(atomic, ASSETS[asset].decimals), amount_atomic: atomic.toString() };
}

function isPaidEndpoint(id: string): id is PaidEndpointId {
  return PAID_ENDPOINT_LIST.some((e) => e.id === id);
}

export function buildStats(store: StoreKind, counters: Counters, recent: ReceiptRecord[]): StoreStats {
  const byMode = { testnet: acc(), simulated: acc() } as Record<Mode, Acc>;
  const byEndpoint = new Map<PaidEndpointId, Acc>(PAID_ENDPOINT_LIST.map((e) => [e.id, acc()]));
  const byModeEndpoint = Object.fromEntries(MODES.map((m) => [m, new Map(PAID_ENDPOINT_LIST.map((e) => [e.id, acc()]))])) as Record<
    Mode,
    Map<PaidEndpointId, Acc>
  >;
  const cash = Object.fromEntries(MODES.map((m) => [m, Object.fromEntries(ACCEPTED_ASSETS.map((a) => [a, { n: 0, atomic: 0n }]))])) as Record<
    Mode,
    Record<AssetSymbol, { n: number; atomic: bigint }>
  >;
  const packs = Object.fromEntries(
    MODES.map((m) => [m, { packs: 0, sold: Object.fromEntries(ACCEPTED_ASSETS.map((a) => [a, { n: 0, atomic: 0n }])), calls: 0, consumed: 0n }]),
  ) as Record<Mode, { packs: number; sold: Record<AssetSymbol, { n: number; atomic: bigint }>; calls: number; consumed: bigint }>;

  for (const [key, v] of counters) {
    const { mode: rawMode, endpoint, channel } = parseCounterKey(key);
    if (rawMode !== "testnet" && rawMode !== "simulated") continue;
    const mode = rawMode as Mode;
    if (channel !== "credits") {
      cash[mode][channel].n += v.calls;
      cash[mode][channel].atomic += v.atomic;
    }
    if ((endpoint as ReceiptEndpointId) === "credits") {
      // Credit pack purchases: cash in, but no call served.
      if (channel !== "credits") {
        packs[mode].packs += v.calls;
        packs[mode].sold[channel].n += v.calls;
        packs[mode].sold[channel].atomic += v.atomic;
        if (channel === "USDC") byMode[mode].usdc += v.atomic;
        else byMode[mode].eurc += v.atomic;
      }
      continue;
    }
    if (!isPaidEndpoint(endpoint)) continue;
    for (const a of [byMode[mode], byEndpoint.get(endpoint)!, byModeEndpoint[mode].get(endpoint)!]) {
      a.calls += v.calls;
      if (channel === "USDC") a.usdc += v.atomic;
      else if (channel === "EURC") a.eurc += v.atomic;
      else a.credit_calls += v.calls;
    }
    if (channel === "credits") {
      packs[mode].calls += v.calls;
      packs[mode].consumed += v.atomic;
    }
  }

  const callsServed = byMode.testnet.calls + byMode.simulated.calls;
  const usdcEarned = byMode.testnet.usdc + byMode.simulated.usdc;
  const credits = Object.fromEntries(
    MODES.map((m): [Mode, CreditStats] => [
      m,
      {
        packs_sold: packs[m].packs,
        sold: Object.fromEntries(ACCEPTED_ASSETS.map((a) => [a, assetRev(packs[m].sold[a].n, packs[m].sold[a].atomic, a)])) as Record<AssetSymbol, AssetRevenue>,
        calls: packs[m].calls,
        consumed_usdc: atomicToUsdc(packs[m].consumed),
        consumed_usdc_atomic: packs[m].consumed.toString(),
      },
    ]),
  ) as Record<Mode, CreditStats>;

  return {
    store,
    calls_served: callsServed,
    usdc_earned: atomicToUsdc(usdcEarned),
    usdc_earned_atomic: usdcEarned.toString(),
    by_mode: { testnet: rev(byMode.testnet), simulated: rev(byMode.simulated) },
    revenue_per_endpoint: Object.fromEntries([...byEndpoint].map(([id, v]) => [id, rev(v)])) as Record<PaidEndpointId, EndpointRevenue>,
    revenue_per_endpoint_by_mode: Object.fromEntries(
      MODES.map((m) => [m, Object.fromEntries([...byModeEndpoint[m]].map(([id, v]) => [id, rev(v)]))]),
    ) as StoreStats["revenue_per_endpoint_by_mode"],
    revenue_by_asset: Object.fromEntries(
      MODES.map((m) => [m, Object.fromEntries(ACCEPTED_ASSETS.map((a) => [a, assetRev(cash[m][a].n, cash[m][a].atomic, a)]))]),
    ) as StoreStats["revenue_by_asset"],
    credits,
    recent_transactions: recent.map(toTxSummary),
  };
}

export function fingerprintKey(fp: { supplier_key: string; number: string; issue_date: string }): string {
  return `${fp.supplier_key}|${fp.number}|${fp.issue_date}`;
}
