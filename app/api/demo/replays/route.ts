// GET /api/demo/replays?scenario=03 — a recorded AgentTrace (mode "REPLAY"), the console's fallback.
// GET /api/demo/replays — the list of recorded runs.
import { NextResponse, type NextRequest } from "next/server";
import { allReplays, getReplay } from "@/agent/replays";
import { isDemoScenarioId } from "@/agent/scenarios";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const scenario = req.nextUrl.searchParams.get("scenario");
  const headers = { "Cache-Control": "no-store" };
  if (scenario === null) {
    return NextResponse.json(
      {
        replays: allReplays().map((t) => ({
          scenario: t.scenario,
          scenario_label: t.scenario_label,
          id: t.id,
          mode: t.mode,
          recorded_from: t.recorded_from ?? null,
          recorded_at: t.recorded_at,
          outcome: t.outcome,
          steps: t.steps.length,
          url: `/api/demo/replays?scenario=${t.scenario}`,
        })),
      },
      { headers },
    );
  }
  if (!isDemoScenarioId(scenario)) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: 'No replay for this scenario. Use "01", "03", "04" or "06".' } }, { status: 404, headers });
  }
  return NextResponse.json(getReplay(scenario), { headers });
}
