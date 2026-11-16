/**
 * The ONE data-access module of the /live console.
 *
 * Fallback ladder (the demo must never fail):
 *   1. POST /api/demo/run {scenario, mode}            → live AgentTrace (TESTNET / SIMULATED)
 *   2. GET  /api/demo/replays?scenario=XX             → recorded AgentTrace (REPLAY)
 *   3. static import of demo/replays/XX.json          → bundled AgentTrace (REPLAY), always available
 *
 * Any network error, timeout, non-2xx status or malformed payload moves one rung down.
 * Nothing here ever throws to the caller.
 */
import type { AgentTrace, TraceStep } from "@/lib/trace/types";
import { bundledReplay, type ConsoleTrace } from "./replays";
import type { ScenarioId } from "./scenarios";

export type RunMode = "testnet" | "simulated";
export type TraceOrigin = "live" | "replay-api" | "replay-bundled";

export interface RunOutcome {
  trace: ConsoleTrace;
  origin: TraceOrigin;
  /** Visible notice for the presenter (e.g. live call failed → replay). */
  notice?: string;
  /** Technical reason of the fallback, shown in small print. */
  error?: string;
}

export interface SourceOptions {
  /** Injected for tests; defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
  /** Prefix for API URLs (tests / external host). Default: same origin. */
  baseUrl?: string;
  /** Live run timeout. Default 45 s. */
  liveTimeoutMs?: number;
  /** Replay API timeout. Default 4 s. */
  replayTimeoutMs?: number;
  /** Cancels the live call (the fallback still resolves). */
  signal?: AbortSignal;
}

export const LIVE_TIMEOUT_MS = 45_000;
export const REPLAY_API_TIMEOUT_MS = 4_000;
export const LIVE_FAILED_NOTICE = "Live call failed → showing recorded run (REPLAY)";

const STEP_KINDS = new Set([
  "reasoning",
  "discovery",
  "policy",
  "http_request",
  "http_response",
  "payment",
  "settlement",
  "erp",
  "review",
  "error",
]);

function isStep(s: unknown): s is TraceStep {
  if (!s || typeof s !== "object") return false;
  const o = s as Record<string, unknown>;
  return typeof o.kind === "string" && STEP_KINDS.has(o.kind) && typeof o.title === "string";
}

/** Minimal structural check: enough for the console to render without crashing. */
export function isAgentTrace(v: unknown): v is AgentTrace {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.scenario === "string" && Array.isArray(o.steps) && o.steps.length > 0 && o.steps.every(isStep);
}

/** Accepts a bare AgentTrace, `{trace}`, `{replay}`, or an array of traces. */
export function extractTrace(json: unknown, scenario: string): ConsoleTrace | null {
  if (isAgentTrace(json)) return json as ConsoleTrace;
  if (Array.isArray(json)) {
    const found = json.find((t) => isAgentTrace(t) && t.scenario === scenario);
    return found ? (found as ConsoleTrace) : null;
  }
  if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    for (const k of ["trace", "replay", "data"]) {
      if (isAgentTrace(o[k])) return o[k] as ConsoleTrace;
    }
  }
  return null;
}

function normalise(trace: ConsoleTrace): ConsoleTrace {
  const steps = trace.steps.map((s, i) => ({ ...s, t_ms: typeof s.t_ms === "number" ? s.t_ms : i * 500 }));
  steps.sort((a, b) => a.t_ms - b.t_ms);
  return {
    ...trace,
    steps,
    scenario_label: trace.scenario_label || `Scenario ${trace.scenario}`,
    duration_ms: typeof trace.duration_ms === "number" ? trace.duration_ms : steps[steps.length - 1].t_ms,
  };
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number, fetchImpl: typeof fetch, outer?: AbortSignal): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error(`timeout after ${Math.round(timeoutMs / 1000)} s`)), timeoutMs);
  const onOuterAbort = () => ctrl.abort(new Error("cancelled"));
  outer?.addEventListener("abort", onOuterAbort);
  try {
    const res = await fetchImpl(url, { ...init, signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) {
      // Keep the server's machine-readable code (DEMO_BUSY, RATE_LIMITED…) or a 1102 body in the reason.
      let why = "";
      try {
        const text = (await res.text()).trim();
        let code: unknown;
        try {
          const j = JSON.parse(text) as { error?: { code?: unknown } };
          code = j?.error?.code;
        } catch {
          /* not JSON */
        }
        why = typeof code === "string" ? ` ${code}` : text && text.length <= 80 && !text.startsWith("<") ? ` (${text})` : "";
      } catch {
        /* body unreadable */
      }
      throw new Error(`HTTP ${res.status}${why} from ${new URL(url, "http://x").pathname}`);
    }
    return await res.json();
  } catch (e) {
    if (ctrl.signal.aborted && ctrl.signal.reason instanceof Error) throw ctrl.signal.reason;
    throw e;
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", onOuterAbort);
  }
}

/**
 * "agent run ended in error: <title>: <detail>" from the trace's last error step (or the route's
 * `error` field), so the presenter and the team can tell a facilitator refusal from a deadline or a
 * 1102 on a nested call (Phase 7 review M3).
 */
export function runErrorReason(json: unknown, trace: ConsoleTrace): string {
  const errStep = [...trace.steps].reverse().find((st) => st.kind === "error");
  const top = json && typeof json === "object" ? ((json as { error?: { title?: unknown; detail?: unknown } }).error ?? null) : null;
  const title = errStep?.title ?? (typeof top?.title === "string" ? top.title : "");
  const detail = errStep?.detail ?? (typeof top?.detail === "string" ? top.detail : "");
  const lastHttp = [...trace.steps].reverse().find((st) => st.kind === "http_response" && st.http?.status);
  const http = lastHttp?.http?.status && lastHttp.http.status !== 200 && lastHttp.http.status !== 402 ? ` [last HTTP ${lastHttp.http.status}]` : "";
  const text = [title, detail].filter(Boolean).join(": ");
  const clipped = text.length > 220 ? `${text.slice(0, 217)}…` : text;
  return `agent run ended in error${clipped ? `: ${clipped}` : ""}${http}`;
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

/** Loads a recorded run: replay API first, then the bundled JSON (never fails). */
export async function loadReplay(scenario: ScenarioId, opts: SourceOptions = {}): Promise<RunOutcome> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch?.bind(globalThis);
  const base = opts.baseUrl ?? "";
  if (fetchImpl) {
    try {
      const json = await fetchJson(
        `${base}/api/demo/replays?scenario=${encodeURIComponent(scenario)}`,
        { method: "GET", headers: { accept: "application/json" } },
        opts.replayTimeoutMs ?? REPLAY_API_TIMEOUT_MS,
        fetchImpl,
      );
      const t = extractTrace(json, scenario);
      if (t) return { trace: normalise({ ...t, mode: "REPLAY" }), origin: "replay-api" };
    } catch {
      /* fall through to the bundled replay */
    }
  }
  return { trace: normalise({ ...bundledReplay(scenario), mode: "REPLAY" }), origin: "replay-bundled" };
}

/**
 * Runs a scenario live through the demo agent (server route), or falls back to the recorded replay.
 * Returns the whole trace at once; the console animates it step by step.
 */
export async function runScenario(scenario: ScenarioId, mode: RunMode, opts: SourceOptions = {}): Promise<RunOutcome> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch?.bind(globalThis);
  const base = opts.baseUrl ?? "";
  try {
    if (!fetchImpl) throw new Error("fetch unavailable");
    const json = await fetchJson(
      `${base}/api/demo/run`,
      { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ scenario, mode }) },
      opts.liveTimeoutMs ?? LIVE_TIMEOUT_MS,
      fetchImpl,
      opts.signal,
    );
    const trace = extractTrace(json, scenario);
    if (!trace) throw new Error("malformed trace from /api/demo/run");
    if (trace.outcome === "error") {
      const reason = runErrorReason(json, trace);
      console.warn(`[live] ${reason}`);
      throw new Error(reason);
    }
    const fallbackMode = mode === "testnet" ? "TESTNET" : "SIMULATED";
    return { trace: normalise({ ...trace, mode: trace.mode || fallbackMode }), origin: "live" };
  } catch (e) {
    const replay = await loadReplay(scenario, opts);
    return { ...replay, notice: LIVE_FAILED_NOTICE, error: errMsg(e) };
  }
}

/**
 * The payment mode this deployment actually runs (GET /api/health → payment.mode), or null if unknown.
 * The console aligns its mode selector on it: the server, not the browser, decides how agents pay.
 * Never throws.
 */
export async function fetchServerMode(opts: { fetchImpl?: typeof fetch; baseUrl?: string; timeoutMs?: number } = {}): Promise<RunMode | null> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch?.bind(globalThis);
  if (!fetchImpl) return null;
  try {
    const json = (await fetchJson(`${opts.baseUrl ?? ""}/api/health`, { method: "GET", headers: { accept: "application/json" } }, opts.timeoutMs ?? REPLAY_API_TIMEOUT_MS, fetchImpl)) as {
      payment?: { mode?: unknown };
    };
    const m = json?.payment?.mode;
    return m === "testnet" || m === "simulated" ? m : null;
  } catch {
    return null;
  }
}
