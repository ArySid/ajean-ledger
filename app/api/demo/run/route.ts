// POST /api/demo/run {scenario: "01"|"03"|"04"|"06", mode?} — used by the /live console.
// Runs the demo purchasing agent IN-PROCESS against this same deployment (real HTTP: catalog,
// 402, x402 payment, 200) and returns its AgentTrace. Never fails hard: on error it answers
// 200 with outcome "error", the steps so far and fallback_hint "replay".
import { NextResponse, type NextRequest } from "next/server";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { runAgent } from "@/agent/core";
import { MemoryErp } from "@/agent/erp";
import { MemorySpendLedger, policyFromEnv } from "@/agent/policy";
import { DEMO_SCENARIO_LABELS, isDemoScenarioId, scenarioItem } from "@/agent/scenarios";
import type { AgentTrace } from "@/agent/types";
import { checkRateLimit, clientKey } from "@/lib/api/rate-limit";
import { getPaymentMode } from "@/lib/payments/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The agent run must finish well before the console's 45 s timeout. */
const RUN_TIMEOUT_MS = 40_000;

type Global = typeof globalThis & { __ajeanDemoRunning?: boolean; __ajeanDemoLedger?: MemorySpendLedger };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** Base URL of this deployment as seen by the agent (override: AJEAN_LEDGER_INTERNAL_URL). */
function selfBaseUrl(req: NextRequest): string {
  const override = process.env.AJEAN_LEDGER_INTERNAL_URL?.trim();
  if (override) return override.replace(/\/$/, "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (host) return `${proto || req.nextUrl.protocol.replace(":", "")}://${host}`;
  return req.nextUrl.origin;
}

function errorTrace(scenario: string, label: string, mode: AgentTrace["mode"], serviceUrl: string, title: string, detail: string): AgentTrace {
  return {
    id: `trace_${scenario}_error_${Date.now()}`,
    scenario,
    scenario_label: label,
    mode,
    recorded_at: new Date().toISOString(),
    agent: { name: "Atelier Lumen purchasing agent", wallet: "", policy: policyFromEnv() },
    service_url: serviceUrl,
    steps: [{ t_ms: 0, kind: "error", title, detail }],
    duration_ms: 0,
    outcome: "error",
  };
}

export async function POST(req: NextRequest) {
  const g = globalThis as Global;
  const wait = checkRateLimit(`demo-run:${clientKey(req.headers)}`);
  if (wait !== null) {
    return json({ error: { code: "RATE_LIMITED", message: `Too many demo runs, retry in ${wait} s.` }, fallback_hint: "replay" }, 429);
  }

  let body: { scenario?: unknown; mode?: unknown; reasoning?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: { code: "INVALID_JSON", message: 'Body must be JSON: {"scenario": "01"|"03"|"04"|"06", "mode"?: "testnet"|"simulated"}' } }, 400);
  }
  const scenario = body?.scenario;
  if (!isDemoScenarioId(scenario)) {
    return json({ error: { code: "INVALID_SCENARIO", message: 'scenario must be one of "01", "03", "04", "06".' } }, 400);
  }

  const serverMode = getPaymentMode();
  const modeLabel = serverMode === "testnet" ? "TESTNET" : "SIMULATED";
  const serviceUrl = selfBaseUrl(req);
  const label = DEMO_SCENARIO_LABELS[scenario];

  if (g.__ajeanDemoRunning) {
    return json({ error: { code: "DEMO_BUSY", message: "A demo run is already in progress on this instance." }, fallback_hint: "replay" }, 429);
  }

  // Wallet: the configured throwaway agent wallet; in SIMULATED mode only, an ephemeral key if none.
  let wallet: PrivateKeyAccount;
  let walletNote: string | undefined;
  const key = process.env.AGENT_PRIVATE_KEY?.trim();
  if (key && /^0x[0-9a-fA-F]{64}$/.test(key)) {
    wallet = privateKeyToAccount(key as `0x${string}`);
  } else if (serverMode === "simulated") {
    wallet = privateKeyToAccount(generatePrivateKey());
    walletNote = "AGENT_PRIVATE_KEY not configured: ephemeral wallet generated for this run (SIMULATED only)";
  } else {
    const t = errorTrace(scenario, label, modeLabel, serviceUrl, "Agent wallet not configured", "AGENT_PRIVATE_KEY is missing on this deployment, so the agent cannot pay in TESTNET mode.");
    return json({ ...t, fallback_hint: "replay" });
  }

  // Daily spend: real test USDC is tracked per instance; simulated runs start from zero.
  const ledger = serverMode === "testnet" ? (g.__ajeanDemoLedger ??= new MemorySpendLedger()) : new MemorySpendLedger();

  g.__ajeanDemoRunning = true;
  try {
    const trace = await runAgent({
      serviceUrl,
      item: scenarioItem(scenario),
      mode: body.mode === "testnet" || body.mode === "simulated" ? body.mode : serverMode,
      wallet,
      walletNote,
      policy: policyFromEnv(),
      ledger,
      erp: new MemoryErp(),
      reasoning: body.reasoning === "llm" ? "llm" : "scripted",
      timeoutMs: RUN_TIMEOUT_MS,
      scenarioLabel: label,
    });
    trace.mode = modeLabel;
    return json(trace.outcome === "error" ? { ...trace, fallback_hint: "replay" } : trace);
  } catch (e) {
    const t = errorTrace(scenario, label, modeLabel, serviceUrl, "Demo run failed", e instanceof Error ? e.message : String(e));
    return json({ ...t, fallback_hint: "replay" });
  } finally {
    g.__ajeanDemoRunning = false;
  }
}
