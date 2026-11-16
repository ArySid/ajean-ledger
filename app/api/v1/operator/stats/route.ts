// GET /api/v1/operator/stats — free. The agent economy seen by the operator: calls served,
// USDC earned, revenue per endpoint, recent transactions. Falls back to the recorded replays
// (source "replay") while the store has no paid call yet, so /operator is never empty.
import { NextResponse } from "next/server";
import { allReplays } from "@/agent/replays";
import { PAID_ENDPOINTS, PAID_ENDPOINT_LIST, atomicToUsdc, usdcToAtomic, type PaidEndpointId } from "@/lib/payments/pricing";
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

function fromStore(s: StoreStats): OperatorStatsBody {
  const recent: RecentRow[] = s.recent_transactions.map((t) => ({
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
    calls: s.calls_served,
    usdc_earned: s.usdc_earned,
    by_endpoint: PAID_ENDPOINT_LIST.map((e) => ({ endpoint: e.path, calls: s.revenue_per_endpoint[e.id]?.calls ?? 0, usdc: s.revenue_per_endpoint[e.id]?.usdc ?? "0.00" })),
    by_mode: s.by_mode,
    recent,
    review_window: reviewWindow(recent),
    source: s.store,
    generated_at: new Date().toISOString(),
  };
}

/** Aggregates the recorded replays (each successful run = one paid call; a policy refusal has no receipt and is skipped). */
function statsFromReplays(): OperatorStatsBody {
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
    recent,
    review_window: reviewWindow(recent),
    source: "replay",
    generated_at: new Date().toISOString(),
  };
}

export async function GET() {
  let body: OperatorStatsBody;
  try {
    const s = await getStore().stats();
    body = s.calls_served > 0 ? fromStore(s) : statsFromReplays();
  } catch {
    body = statsFromReplays();
  }
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
