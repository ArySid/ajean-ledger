// GET /api/v1/operator/stats — free. The agent economy seen by the operator: calls served,
// USDC earned, revenue per endpoint, recent transactions. Falls back to the recorded replays
// (source "replay") while the store has no paid call yet, so /operator is never empty.
// The headline counts the CURRENT payment mode only (Phase 7 review M2): a TESTNET deployment never
// adds simulated (fake-hash) calls to its revenue; the other mode is reported in `hidden`.
import { NextResponse } from "next/server";
import { allReplays } from "@/agent/replays";
import { PAID_ENDPOINTS, PAID_ENDPOINT_LIST, atomicToUsdc, usdcToAtomic, type PaidEndpointId } from "@/lib/payments/pricing";
import { getPaymentMode, type PaymentMode } from "@/lib/payments/config";
import { getStore, type StoreStats } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RecentRow {
  request_id: string;
  at: string;
  endpoint: string;
  payer: string | null;
  amount: string;
  tx_hash: string;
  explorer_url: string | null;
  mode: string;
  human_review_required?: boolean;
}

interface OperatorStatsBody {
  calls: number;
  usdc_earned: string;
  by_endpoint: { endpoint: string; calls: number; usdc: string }[];
  by_mode?: StoreStats["by_mode"];
  /** Payment mode the headline figures are computed for (the deployment's current mode). */
  mode: PaymentMode;
  /** Calls of the other payment mode, left out of every figure above (null when none). */
  hidden: { mode: PaymentMode; calls: number; usdc: string } | null;
  recent: RecentRow[];
  /**
   * Calls whose result required a human review, counted over `review_window.calls` calls (the recent
   * window for a store; all calls for the replay fallback). Exact count, never extrapolated.
   */
  review_window: { calls: number; review_required: number };
  source: string;
  generated_at: string;
}

function reviewWindow(recent: RecentRow[]): OperatorStatsBody["review_window"] {
  return { calls: recent.length, review_required: recent.filter((r) => r.human_review_required === true).length };
}

function fromStore(s: StoreStats, mode: PaymentMode): OperatorStatsBody {
  const other: PaymentMode = mode === "testnet" ? "simulated" : "testnet";
  const cur = s.by_mode[mode];
  const perEndpoint = s.revenue_per_endpoint_by_mode?.[mode];
  const hiddenCalls = s.by_mode[other]?.calls ?? 0;
  const recent: RecentRow[] = s.recent_transactions.filter((t) => t.mode === mode).map((t) => ({
    request_id: t.request_id,
    at: t.paid_at,
    endpoint: PAID_ENDPOINTS[t.endpoint as PaidEndpointId]?.path ?? t.endpoint,
    payer: t.payer,
    amount: t.amount,
    tx_hash: t.tx_hash,
    explorer_url: t.explorer_url,
    mode: t.mode,
    human_review_required: t.human_review_required,
  }));
  return {
    calls: cur?.calls ?? 0,
    usdc_earned: cur?.usdc ?? "0.00",
    by_endpoint: PAID_ENDPOINT_LIST.map((e) => ({ endpoint: e.path, calls: perEndpoint?.[e.id]?.calls ?? 0, usdc: perEndpoint?.[e.id]?.usdc ?? "0.00" })),
    by_mode: s.by_mode,
    mode,
    hidden: hiddenCalls > 0 ? { mode: other, calls: hiddenCalls, usdc: s.by_mode[other].usdc } : null,
    recent,
    review_window: reviewWindow(recent),
    source: s.store,
    generated_at: new Date().toISOString(),
  };
}

/** Aggregates the recorded replays (each successful run = one paid call; a policy refusal has no receipt and is skipped). */
function statsFromReplays(mode: PaymentMode): OperatorStatsBody {
  const recent: RecentRow[] = [];
  for (const t of allReplays()) {
    const r = (t.result ?? null) as { request_id?: string; human_review_required?: boolean; receipt?: Record<string, unknown> } | null;
    const rc = r?.receipt;
    if (!rc) continue;
    const call = t.steps.find((s) => s.kind === "http_response" && s.http?.status === 200 && s.http.method === "POST");
    const endpoint = call?.http?.url ? new URL(call.http.url, "http://x").pathname : PAID_ENDPOINTS.entry.path;
    recent.push({
      request_id: r?.request_id ?? t.id,
      at: String(rc.paid_at ?? t.recorded_at),
      endpoint,
      payer: (rc.payer as string | null) ?? t.agent.wallet ?? null,
      amount: String(rc.amount ?? "0"),
      tx_hash: String(rc.tx_hash ?? ""),
      explorer_url: (rc.explorer_url as string | null) ?? null,
      mode: String(rc.mode ?? t.recorded_from ?? "simulated"),
      human_review_required: !!r?.human_review_required,
    });
  }
  recent.sort((a, b) => b.at.localeCompare(a.at));
  const sum = (rows: RecentRow[]) => atomicToUsdc(rows.reduce((s, x) => s + BigInt(usdcToAtomic(x.amount)), 0n));
  return {
    calls: recent.length,
    usdc_earned: sum(recent),
    by_endpoint: PAID_ENDPOINT_LIST.map((e) => {
      const rows = recent.filter((x) => x.endpoint === e.path);
      return { endpoint: e.path, calls: rows.length, usdc: sum(rows) };
    }),
    // The replays are labelled recordings (source "replay"), all made on TESTNET; `mode` still names the
    // deployment's current mode so the client can say which calls a live store would show.
    mode,
    hidden: null,
    recent,
    review_window: reviewWindow(recent),
    source: "replay",
    generated_at: new Date().toISOString(),
  };
}

export async function GET() {
  const mode = getPaymentMode();
  let body: OperatorStatsBody;
  try {
    const s = await getStore().stats();
    if ((s.by_mode[mode]?.calls ?? 0) > 0) body = fromStore(s, mode);
    else {
      // No call in the current mode yet: show the recordings, and still say what was left out.
      body = statsFromReplays(mode);
      const other: PaymentMode = mode === "testnet" ? "simulated" : "testnet";
      if ((s.by_mode[other]?.calls ?? 0) > 0) body.hidden = { mode: other, calls: s.by_mode[other].calls, usdc: s.by_mode[other].usdc };
    }
  } catch {
    body = statsFromReplays(mode);
  }
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
