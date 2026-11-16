/**
 * Operator stats for /operator.
 *
 * Source ladder: GET /api/v1/operator/stats → stats computed from the bundled replays.
 * The normaliser accepts both the documented console shape
 *   {calls, usdc_earned, by_endpoint:[{endpoint, calls, usdc}], recent:[{request_id, at, endpoint, payer, amount, tx_hash, explorer_url, mode}], source}
 * and the store shape of lib/store/types.ts (StoreStats: calls_served, revenue_per_endpoint, recent_transactions, store).
 */
import { asEntryResponse, isSimulatedTx, txExplorerUrl } from "./format";
import { endpointPath, PRICE_ROWS } from "./pricing";
import { allBundledReplays, type ConsoleTrace } from "./replays";

export interface EndpointStat {
  endpoint: string;
  calls: number;
  usdc: number;
}

export interface RecentTx {
  request_id: string;
  at: string;
  endpoint: string;
  payer: string | null;
  amount: number;
  tx_hash: string;
  explorer_url: string | null;
  mode: string;
  human_review_required?: boolean;
}

export interface OperatorStats {
  calls: number;
  usdc_earned: number;
  by_endpoint: EndpointStat[];
  recent: RecentTx[];
  /** Count of calls whose result required human review, when the source knows it. */
  review_required: number | null;
  /** Number of calls `review_required` is counted over (all calls, or the recent window). Null when unknown. */
  review_window: number | null;
  source: string;
}

export const STATS_TIMEOUT_MS = 5_000;

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Ensures every paid endpoint appears (0 calls if none), in pricing order. */
function completeEndpoints(list: EndpointStat[]): EndpointStat[] {
  const map = new Map(list.map((e) => [endpointPath(e.endpoint), { ...e, endpoint: endpointPath(e.endpoint) }]));
  const out: EndpointStat[] = PRICE_ROWS.map((r) => map.get(r.path) ?? { endpoint: r.path, calls: 0, usdc: 0 });
  for (const [k, v] of map) if (!PRICE_ROWS.some((r) => r.path === k)) out.push(v);
  return out;
}

export function normaliseStats(json: unknown): OperatorStats | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const calls = o.calls ?? o.calls_served;
  if (calls === undefined || o.usdc_earned === undefined) return null;

  let byEndpoint: EndpointStat[] = [];
  if (Array.isArray(o.by_endpoint)) {
    byEndpoint = (o.by_endpoint as Record<string, unknown>[]).map((e) => ({
      endpoint: String(e.endpoint ?? e.path ?? e.id ?? "?"),
      calls: num(e.calls),
      usdc: num(e.usdc),
    }));
  } else if (o.revenue_per_endpoint && typeof o.revenue_per_endpoint === "object") {
    byEndpoint = Object.entries(o.revenue_per_endpoint as Record<string, Record<string, unknown>>).map(([id, e]) => ({
      endpoint: id,
      calls: num(e.calls),
      usdc: num(e.usdc),
    }));
  }

  const rawRecent = (Array.isArray(o.recent) ? o.recent : Array.isArray(o.recent_transactions) ? o.recent_transactions : []) as Record<
    string,
    unknown
  >[];
  const recent: RecentTx[] = rawRecent.map((r) => ({
    request_id: String(r.request_id ?? ""),
    at: String(r.at ?? r.paid_at ?? r.created_at ?? ""),
    endpoint: endpointPath(String(r.endpoint ?? "")),
    payer: r.payer ? String(r.payer) : null,
    amount: num(r.amount),
    tx_hash: String(r.tx_hash ?? ""),
    explorer_url: r.explorer_url ? String(r.explorer_url) : null,
    mode: String(r.mode ?? ""),
    human_review_required: typeof r.human_review_required === "boolean" ? r.human_review_required : undefined,
  }));

  // Exact counts only, never extrapolated: over all calls when the source gives a total, else over the
  // recent window the source reported (Phase 5 review m8).
  let reviewRequired: number | null = null;
  let reviewWindow: number | null = null;
  const rw = o.review_window as { calls?: unknown; review_required?: unknown } | undefined;
  if (typeof o.review_required === "number") {
    reviewRequired = o.review_required;
    reviewWindow = num(calls);
  } else if (rw && typeof rw.review_required === "number" && typeof rw.calls === "number" && rw.calls > 0) {
    reviewRequired = rw.review_required;
    reviewWindow = rw.calls;
  } else if (recent.length > 0 && recent.every((r) => typeof r.human_review_required === "boolean")) {
    reviewRequired = recent.filter((r) => r.human_review_required).length;
    reviewWindow = recent.length;
  }

  return {
    calls: num(calls),
    usdc_earned: num(o.usdc_earned),
    by_endpoint: completeEndpoints(byEndpoint),
    recent,
    review_required: reviewRequired,
    review_window: reviewWindow,
    source: String(o.source ?? o.store ?? "api"),
  };
}

/** Stats derived from recorded traces (fallback when the stats API is unavailable). */
export function statsFromReplays(traces: ConsoleTrace[] = allBundledReplays()): OperatorStats {
  const recent: RecentTx[] = [];
  for (const t of traces) {
    const res = asEntryResponse(t.result);
    const r = res?.receipt;
    if (!r) continue;
    const httpStep = t.steps.find((s) => s.kind === "http_response" && s.http?.status === 200 && s.http.method === "POST");
    const path = httpStep?.http?.url ? new URL(httpStep.http.url, "http://x").pathname : "/api/v1/entry";
    recent.push({
      request_id: res?.request_id ?? t.id,
      at: r.paid_at ?? t.recorded_at,
      endpoint: path,
      payer: r.payer ?? t.agent?.wallet ?? null,
      amount: num(r.amount),
      tx_hash: r.tx_hash ?? "",
      explorer_url: txExplorerUrl(r),
      mode: isSimulatedTx(r) ? "simulated" : "testnet",
      human_review_required: !!res?.human_review_required,
    });
  }
  recent.sort((a, b) => b.at.localeCompare(a.at));
  const by = new Map<string, EndpointStat>();
  for (const r of recent) {
    const cur = by.get(r.endpoint) ?? { endpoint: r.endpoint, calls: 0, usdc: 0 };
    cur.calls += 1;
    cur.usdc = Math.round((cur.usdc + r.amount) * 1e6) / 1e6;
    by.set(r.endpoint, cur);
  }
  return {
    calls: recent.length,
    usdc_earned: Math.round(recent.reduce((s, r) => s + r.amount, 0) * 1e6) / 1e6,
    by_endpoint: completeEndpoints([...by.values()]),
    recent,
    review_required: recent.filter((r) => r.human_review_required).length,
    review_window: recent.length,
    source: "replay",
  };
}

/** Fetches live stats, falling back to replay-derived stats. Never throws. */
export async function loadOperatorStats(opts: { fetchImpl?: typeof fetch; baseUrl?: string; timeoutMs?: number } = {}): Promise<{
  stats: OperatorStats;
  fallback: boolean;
  error?: string;
}> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch?.bind(globalThis);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? STATS_TIMEOUT_MS);
  try {
    if (!fetchImpl) throw new Error("fetch unavailable");
    const res = await fetchImpl(`${opts.baseUrl ?? ""}/api/v1/operator/stats`, { signal: ctrl.signal, cache: "no-store", headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const stats = normaliseStats(await res.json());
    if (!stats) throw new Error("unexpected stats shape");
    // A fresh deployment has no traffic yet: show the recorded runs rather than an empty dashboard.
    if (stats.calls === 0) throw new Error("no live traffic recorded yet");
    return { stats, fallback: false };
  } catch (e) {
    return { stats: statsFromReplays(), fallback: true, error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}
