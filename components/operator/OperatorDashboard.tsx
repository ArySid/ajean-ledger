"use client";

import { useCallback, useEffect, useState } from "react";
import { addressUrl, isRealTxHash, shortHex, SIMULATED_TX_PREFIX, usdc, utcTime } from "@/lib/console/format";
import { loadOperatorStats, modeFilterNote, type OperatorStats } from "@/lib/console/stats";

const SOURCE_LABEL: Record<string, string> = {
  neon: "source: Neon Postgres (live receipts)",
  upstash: "source: Upstash Redis (live receipts)",
  memory: "source: in-memory store (live receipts, this server instance)",
  file: "source: local file store (live receipts)",
  replay: "source: recorded replays",
};

function txLink(r: OperatorStats["recent"][number]): string | null {
  if (r.explorer_url) return r.explorer_url;
  if (r.mode === "testnet" && isRealTxHash(r.tx_hash) && !r.tx_hash.startsWith(SIMULATED_TX_PREFIX)) return `https://sepolia.basescan.org/tx/${r.tx_hash}`;
  return null;
}

export function OperatorDashboard() {
  const [state, setState] = useState<{ stats: OperatorStats; fallback: boolean; error?: string } | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const res = await loadOperatorStats();
    setState(res);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const s = state?.stats;
  const avg = s && s.calls > 0 ? s.usdc_earned / s.calls : 0;
  const reviewWin = s?.review_window ?? null;
  const reviewPct = s && s.review_required !== null && reviewWin ? Math.round((s.review_required / reviewWin) * 100) : null;
  const maxUsdc = s ? Math.max(...s.by_endpoint.map((e) => e.usdc), 0.000001) : 1;
  const filterNote = s ? modeFilterNote(s) : null;
  const simulatedOnly = s ? (s.mode ? s.mode === "simulated" : s.recent.length > 0 && s.recent.every((r) => r.mode === "simulated")) : false;

  return (
    <>
      <div className="page-head">
        <div>
          <span className="kicker">Operator view · the agent economy in action</span>
          <h1>Agents served, USDC earned</h1>
          <p>Every row below is an AI agent that found the service, paid per call in USDC and received a machine-readable result. No accounts, no invoices, no humans.</p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {s && (
            <span className={`pill ${state?.fallback ? "pill-plain" : "pill-ok"} src`} data-testid="stats-source">
              {state?.fallback ? SOURCE_LABEL.replay : (SOURCE_LABEL[s.source] ?? `source: ${s.source}`)}
            </span>
          )}
          <button type="button" className="btn" onClick={() => void refresh()} disabled={loading}>
            {loading ? "Loading…" : "↻ Refresh"}
          </button>
        </div>
      </div>
      {state?.fallback && state.error && (
        <p className="faint" style={{ fontSize: "0.8rem", margin: "0 0 4px" }}>
          Live stats unavailable ({state.error}): showing figures computed from the recorded agent runs.
        </p>
      )}

      {filterNote && (
        <p className="faint" style={{ fontSize: "0.8rem", margin: "0 0 4px" }} data-testid="mode-filter-note">
          {filterNote}
        </p>
      )}

      <div className="kpis">
        <div className="panel kpi">
          <div className="label">Paid calls served</div>
          <div className="value" data-testid="kpi-calls">
            {s ? s.calls : "…"}
          </div>
          <div className="hint">{simulatedOnly ? "each one paid over HTTP 402 (simulated settlement)" : "each one settled over HTTP 402"}</div>
        </div>
        <div className="panel kpi">
          <div className="label">USDC earned</div>
          <div className="value money">
            {s ? usdc(s.usdc_earned) : "…"}
            <small>USDC</small>
          </div>
          <div className="hint">
            {simulatedOnly ? "simulated: no on-chain transfer" : "test USDC on Base Sepolia"}
          </div>
        </div>
        <div className="panel kpi">
          <div className="label">Average price / call</div>
          <div className="value">
            {s ? usdc(avg, 3) : "…"}
            <small>USDC</small>
          </div>
          <div className="hint">pay per use, no subscription</div>
        </div>
        {s?.earned_by_asset && ((s.earned_by_asset.EURC ?? 0) > 0 || (s.credits?.packs_sold ?? 0) > 0) && (
          <div className="panel kpi" data-testid="kpi-assets">
            <div className="label">Per asset · credit packs</div>
            <div className="value money" style={{ fontSize: "1.1rem" }}>
              {usdc(s.earned_by_asset.USDC ?? 0)} <small>USDC</small> · {usdc(s.earned_by_asset.EURC ?? 0)} <small>EURC</small>
            </div>
            <div className="hint">
              {s.credits
                ? `${s.credits.packs_sold} pack${s.credits.packs_sold === 1 ? "" : "s"} sold · ${s.credits.calls} call${s.credits.calls === 1 ? "" : "s"} paid with credits (${usdc(s.credits.consumed_usdc)} USDC used)`
                : "cash received per stablecoin"}
            </div>
          </div>
        )}
        {reviewPct !== null && s && (
          <div className="panel kpi" data-testid="kpi-review">
            <div className="label">Needing human review</div>
            <div className="value" style={{ color: "var(--warn)" }}>
              {reviewPct}%
            </div>
            <div className="hint">
              {s.review_required} of {reviewWin && reviewWin < s.calls ? `the last ${reviewWin}` : reviewWin} call{reviewWin === 1 ? "" : "s"} · flagged instead of guessed
            </div>
          </div>
        )}
      </div>

      <div className="op-grid">
        <section className="panel" aria-labelledby="rev-h">
          <h2 id="rev-h">Revenue per endpoint</h2>
          <div className="bars">
            {s?.by_endpoint.map((e) => (
              <div className="bar-row" key={e.endpoint}>
                <div className="bar-label">
                  <span className="ep">{e.endpoint}</span>
                  <span>
                    <span className="money">{usdc(e.usdc)}</span> USDC
                    {(e.eurc ?? 0) > 0 && (
                      <>
                        {" "}
                        + <span className="money">{usdc(e.eurc ?? 0)}</span> EURC
                      </>
                    )}{" "}
                    · {e.calls} call{e.calls === 1 ? "" : "s"}
                    {(e.credit_calls ?? 0) > 0 && ` (${e.credit_calls} on credits)`}
                  </span>
                </div>
                <div className="bar-track" role="img" aria-label={`${e.endpoint}: ${usdc(e.usdc)} USDC`}>
                  <div className="bar-fill" style={{ width: `${Math.max((e.usdc / maxUsdc) * 100, e.usdc > 0 ? 3 : 0)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="panel" aria-labelledby="tx-h">
          <h2 id="tx-h">Recent transactions</h2>
          <div className="table-wrap">
            <table className="table tx-table" data-testid="tx-table">
              <thead>
                <tr>
                  <th scope="col">UTC</th>
                  <th scope="col">Endpoint</th>
                  <th scope="col">Payer wallet</th>
                  <th scope="col" className="num">
                    Amount
                  </th>
                  <th scope="col">Tx hash</th>
                  <th scope="col">Mode</th>
                </tr>
              </thead>
              <tbody>
                {s?.recent.length === 0 && (
                  <tr>
                    <td colSpan={6} className="muted">
                      No transactions yet.
                    </td>
                  </tr>
                )}
                {s?.recent.slice(0, 12).map((r, i) => {
                  const link = txLink(r);
                  const payerUrl = addressUrl(r.payer);
                  return (
                    <tr key={`${r.request_id}-${i}`}>
                      <td className="mono">{utcTime(r.at)}</td>
                      <td className="mono">{r.endpoint}</td>
                      <td className="mono">
                        {payerUrl ? (
                          <a href={payerUrl} target="_blank" rel="noreferrer">
                            {shortHex(r.payer)}
                          </a>
                        ) : (
                          shortHex(r.payer)
                        )}
                      </td>
                      <td className="num money">
                        {usdc(r.amount)}
                        {r.asset !== "USDC" && <small> {r.asset}</small>}
                      </td>
                      <td className="mono">
                        {r.method === "credits" ? (
                          <span className="muted">prepaid credits</span>
                        ) : link ? (
                          <a href={link} target="_blank" rel="noreferrer">
                            {shortHex(r.tx_hash, 6, 4)} ↗
                          </a>
                        ) : (
                          <>{shortHex(r.tx_hash, 6, 4)}</>
                        )}
                      </td>
                      <td>
                        <span className={`pill ${r.mode === "testnet" ? "pill-ok" : "pill-plain"}`} style={r.mode === "simulated" ? { color: "var(--violet)" } : undefined}>
                          {r.mode ? r.mode.toUpperCase() : "—"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
