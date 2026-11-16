"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ModeBadge } from "@/components/ModeBadge";
import { resultRevealIndex, utcStamp } from "@/lib/console/format";
import { DEFAULT_SCENARIO, isScenarioId, SCENARIOS, type ScenarioId } from "@/lib/console/scenarios";
import { MODE_DECIDED_BY_SERVER, MODE_INFO, MODE_ORDER } from "@/lib/console/modes";
import { fetchServerMode, loadReplay, runScenario, LIVE_TIMEOUT_MS, type RunMode, type RunOutcome } from "@/lib/console/source";
import type { PaymentModeLabel, TraceStep } from "@/lib/trace/types";
import { ResultPanel } from "./ResultPanel";
import { TraceStepItem } from "./TraceStepItem";

type Phase = "idle" | "calling" | "playing" | "done";

const SPEEDS = [0.5, 1, 2, 4] as const;

/** Base delay (ms at 1×) before revealing a step: longer on the moments worth narrating. */
function delayFor(step: TraceStep | undefined): number {
  if (!step) return 900;
  if (step.kind === "reasoning") return 1600;
  if (step.kind === "http_response" && step.http?.status === 402) return 1500;
  if (step.kind === "payment" || step.kind === "review") return 1500;
  if (step.kind === "http_response") return 1400;
  return 1000;
}

const ORIGIN_LABEL: Record<RunOutcome["origin"], string> = {
  live: "live agent run",
  "replay-api": "recorded run served by /api/demo/replays",
  "replay-bundled": "recorded run bundled with the page (works offline)",
};

export function LiveConsole() {
  const [scenario, setScenario] = useState<ScenarioId>(DEFAULT_SCENARIO);
  const [runMode, setRunMode] = useState<RunMode>("testnet");
  /** Mode of this deployment (GET /api/health); null until known or if unreachable. */
  const [serverMode, setServerMode] = useState<RunMode | null>(null);
  const [speed, setSpeed] = useState<number>(1);
  const [skipAnim, setSkipAnim] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [outcome, setOutcome] = useState<RunOutcome | null>(null);
  const [visible, setVisible] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const runToken = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const timelineEnd = useRef<HTMLDivElement | null>(null);
  const resultCol = useRef<HTMLDivElement | null>(null);

  const steps = outcome?.trace.steps ?? [];
  const revealAt = outcome ? resultRevealIndex(steps) : -1;
  const showResult = outcome !== null && visible > revealAt;

  const start = useCallback(
    async (kind: "run" | "replay", sc: ScenarioId, mode: RunMode, skip: boolean) => {
      const token = ++runToken.current;
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setOutcome(null);
      setVisible(0);
      setElapsed(0);
      setPhase("calling");
      const res = kind === "run" ? await runScenario(sc, mode, { signal: ctrl.signal }) : await loadReplay(sc);
      if (token !== runToken.current) return; // superseded by a newer run
      setOutcome(res);
      setVisible(skip ? res.trace.steps.length : 1);
      setPhase(skip ? "done" : "playing");
      resultCol.current?.scrollTo({ top: 0 });
    },
    [],
  );

  // Read ?scenario=03&autoplay=replay|run&mode=simulated&speed=2&skip=1 once (presenter shortcuts).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const sc = q.get("scenario");
    const sel: ScenarioId = isScenarioId(sc) ? sc : DEFAULT_SCENARIO;
    const m: RunMode = q.get("mode") === "simulated" ? "simulated" : "testnet";
    const sp = Number(q.get("speed"));
    const skip = q.get("skip") === "1";
    setScenario(sel);
    setRunMode(m);
    if ((SPEEDS as readonly number[]).includes(sp)) setSpeed(sp);
    if (skip) setSkipAnim(true);
    const auto = q.get("autoplay");
    if (auto === "replay" || auto === "run") void start(auto, sel, m, skip);
    return () => abortRef.current?.abort();
  }, [start]);

  // The server decides how agents pay: align the selector on the deployment's mode once known.
  useEffect(() => {
    let alive = true;
    void fetchServerMode().then((m) => {
      if (!alive || !m) return;
      setServerMode(m);
      setRunMode(m);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Step-by-step reveal.
  useEffect(() => {
    if (phase !== "playing" || !outcome) return;
    if (skipAnim || visible >= steps.length) {
      setVisible(steps.length);
      setPhase("done");
      return;
    }
    const t = setTimeout(() => setVisible((v) => v + 1), delayFor(steps[visible]) / speed);
    return () => clearTimeout(t);
  }, [phase, outcome, visible, steps, speed, skipAnim]);

  // Elapsed counter while the live call is pending.
  useEffect(() => {
    if (phase !== "calling") return;
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Date.now() - t0), 250);
    return () => clearInterval(id);
  }, [phase]);

  // Keep the newest step in view.
  useEffect(() => {
    if (visible > 0) timelineEnd.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [visible]);

  const busy = phase === "calling" || phase === "playing";
  const badgeMode: PaymentModeLabel = outcome ? outcome.trace.mode : runMode === "testnet" ? "TESTNET" : "SIMULATED";
  const badgeSub = outcome ? undefined : phase === "calling" ? "connecting…" : "selected";
  const sc = SCENARIOS.find((s) => s.id === scenario);
  const trace = outcome?.trace;

  return (
    <div className="live">
      <div className="controls" role="toolbar" aria-label="Scenario controls">
        <div className="field">
          <label htmlFor="scenario" className="sr-only">
            Scenario
          </label>
          <select id="scenario" className="select" value={scenario} onChange={(e) => setScenario(e.target.value as ScenarioId)} disabled={phase === "calling"}>
            {SCENARIOS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <span className="sr-only" id="mode-l">
            Payment mode for live runs
          </span>
          <div className="seg" role="group" aria-labelledby="mode-l">
            {(["testnet", "simulated"] as RunMode[]).map((m) => {
              const unavailable = serverMode !== null && serverMode !== m;
              const label = m === "testnet" ? "TESTNET" : "SIMULATED";
              return (
                <button
                  key={m}
                  type="button"
                  aria-pressed={runMode === m}
                  onClick={() => setRunMode(m)}
                  disabled={phase === "calling" || unavailable}
                  title={
                    unavailable
                      ? `This deployment runs in ${serverMode!.toUpperCase()} mode (PAYMENT_MODE). ${label} live runs need a ${m} deployment; REPLAY always works.`
                      : `${label}: ${MODE_INFO[label].long}`
                  }
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => void start("run", scenario, runMode, skipAnim)} disabled={phase === "calling"} data-testid="run-btn">
          ▶ Run scenario
        </button>
        <button type="button" className="btn" onClick={() => void start("replay", scenario, runMode, skipAnim)} disabled={phase === "calling"} data-testid="replay-btn">
          ⟲ Replay recorded run
        </button>
        <div className="field">
          <label htmlFor="speed" className="sr-only">
            Animation speed
          </label>
          <select id="speed" className="select" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}× speed
              </option>
            ))}
          </select>
        </div>
        <label className="toggle">
          <input type="checkbox" checked={skipAnim} onChange={(e) => setSkipAnim(e.target.checked)} />
          Skip animation
        </label>
        <details className="mode-legend" data-testid="mode-legend">
          <summary aria-label={`Payment mode ${badgeMode}. Click for what TESTNET, SIMULATED and REPLAY mean.`}>
            <ModeBadge mode={badgeMode} sub={badgeSub} hint />
          </summary>
          <div className="mode-legend-pop" role="note">
            <dl>
              {MODE_ORDER.map((m) => (
                <div key={m}>
                  <dt>
                    <span className={`mode-chip mode-${m}`}>{m}</span>
                  </dt>
                  <dd>{MODE_INFO[m].long}</dd>
                </div>
              ))}
            </dl>
            <p className="faint">
              {MODE_DECIDED_BY_SERVER}
              {serverMode ? ` This deployment: ${serverMode.toUpperCase()}.` : ""}
            </p>
          </div>
        </details>
      </div>

      {outcome?.notice && (
        <div className="notice notice-warn" role="alert" data-testid="fallback-notice">
          <b>⚠ {outcome.notice}</b>
          {outcome.error && <small>reason: {outcome.error}</small>}
        </div>
      )}
      {outcome && !outcome.notice && outcome.origin !== "live" && trace && (
        <div className="notice notice-info">
          <span>
            <b style={{ color: "var(--replay)" }}>REPLAY</b> · {ORIGIN_LABEL[outcome.origin]} · recorded from a {trace.recorded_from ?? "previous"} run on {utcStamp(trace.recorded_at)}
            {trace.sample ? " · sample trace" : ""}
          </span>
        </div>
      )}

      <div className="split">
        <div className="col" aria-label="Agent timeline">
          <div className="col-head">
            <h2>Agent timeline</h2>
            <span className="who">
              {trace ? `${trace.agent?.name ?? "agent"} · ${trace.scenario_label}` : "the buyer's AI agent, step by step"}
            </span>
          </div>

          {phase === "idle" && (
            <div className="empty" data-testid="empty-state">
              <h3>Watch an AI agent buy an accounting entry</h3>
              <p>
                The purchasing agent of <b>Atelier Lumenor SAS (fictional)</b> receives a supplier invoice. It does not know French VAT or e-invoicing rules, so it
                discovers Ajean Ledger, checks its budget, pays in USDC over HTTP 402 and books the result. No human clicks anything below.
              </p>
              <ol>
                <li>Pick a scenario (03 shows the VAT trap a human would miss).</li>
                <li>
                  <b>Run scenario</b> calls the real agent ({runMode.toUpperCase()}); if the network fails it falls back to a recording automatically.
                </li>
                <li>
                  <b>Replay recorded run</b> plays a stored trace: works with no backend at all.
                </li>
              </ol>
              {sc && <p className="faint" style={{ marginTop: 12 }}>Selected: {sc.takeaway}</p>}
            </div>
          )}

          {phase === "calling" && (
            <div className="waiting" role="status">
              <span className="spinner" aria-hidden="true" />
              <div style={{ flex: 1 }}>
                <b>Agent is working…</b>
                <div className="muted" style={{ fontSize: "0.88rem" }}>
                  Waiting for the trace · {(elapsed / 1000).toFixed(1)} s / {LIVE_TIMEOUT_MS / 1000} s, then automatic fallback to the recorded run.
                </div>
              </div>
              <button type="button" className="btn" onClick={() => abortRef.current?.abort()}>
                Use recorded run now
              </button>
            </div>
          )}

          {outcome && (
            <ol className="timeline" data-testid="timeline">
              {steps.slice(0, visible).map((s, i) => (
                <TraceStepItem key={`${outcome.trace.id}-${i}`} step={s} />
              ))}
            </ol>
          )}
          {phase === "playing" && visible < steps.length && (
            <div className="typing" aria-hidden="true">
              <i />
              <i />
              <i /> agent working
            </div>
          )}
          {phase === "done" && trace && (
            <p className="faint" style={{ paddingLeft: 44, fontSize: "0.85rem" }} data-testid="run-complete">
              Run complete · {steps.length} steps · {(trace.duration_ms / 1000).toFixed(1)} s of agent time · outcome: <b>{trace.outcome}</b>
            </p>
          )}
          <div ref={timelineEnd} />
        </div>

        <div className="col" ref={resultCol} aria-label="Structured result" aria-live="polite">
          <div className="col-head">
            <h2>What the agent received</h2>
            <span className="who">POST /api/v1/entry → 200</span>
          </div>
          {trace && showResult ? (
            <ResultPanel trace={trace} />
          ) : (
            <div className="empty">
              <h3>{busy ? "Waiting for the paid response…" : "No result yet"}</h3>
              <p>
                The structured result appears once the agent has paid and received <span className="mono">HTTP 200</span>: compliance status, the journal entry as a
                mini ledger, VAT treatment, anomalies and the payment receipt.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
