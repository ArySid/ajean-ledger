import type { Anomaly, ComplianceCheck } from "@/engine/types";
import type { AgentTrace } from "@/lib/trace/types";
import { addressUrl, asEntryResponse, invoiceTotalLabel, money, policyRefusalSummary, shortHex, txExplorerUrl, vatSummary } from "@/lib/console/format";

/**
 * The engine's `compliance.status` covers the mandatory invoice MENTIONS only (e-invoicing / L441 rules);
 * VAT and accounting problems are anomalies and drive the review flag. The chip says so explicitly, so a
 * green chip never sits next to a VAT anomaly looking like "everything is fine" (Phase 5 review m4).
 */
const STATUS_PILL: Record<string, { cls: string; label: string }> = {
  compliant: { cls: "pill-ok", label: "✓ Invoice mentions: compliant" },
  warning: { cls: "pill-warn", label: "! Invoice mentions: warning" },
  non_compliant: { cls: "pill-err", label: "✕ Invoice mentions: non-compliant" },
};
const STATUS_TITLE =
  "Compliance status = mandatory invoice mentions (e-invoicing rules). VAT and accounting anomalies are reported separately and trigger the human review flag.";

const SEV_COLOR: Record<string, string> = { error: "var(--err)", warning: "var(--warn)", info: "var(--faint)" };

const REGIME_LABEL: Record<string, string> = {
  standard: "Standard rate",
  reduced: "Reduced rate",
  reverse_charge_intra_eu: "Intra-EU reverse charge (autoliquidation)",
  reverse_charge_non_eu: "Non-EU services, reverse charge (autoliquidation, to review)",
  exempt: "Exempt",
  out_of_scope: "Out of scope",
  mixed_rates: "Mixed rates",
};

function sortChecks(checks: ComplianceCheck[]): ComplianceCheck[] {
  const rank = (c: ComplianceCheck) => (c.passed ? 3 : c.severity === "error" ? 0 : c.severity === "warning" ? 1 : 2);
  return [...checks].sort((a, b) => rank(a) - rank(b));
}

function sortAnomalies(list: Anomaly[]): Anomaly[] {
  const rank = (a: Anomaly) => (a.severity === "error" ? 0 : a.severity === "warning" ? 1 : 2);
  return [...list].sort((a, b) => rank(a) - rank(b));
}

/** Result column of a run the agent refused to pay for (scenario 90): nothing was bought, so no entry. */
function PolicyRefusalPanel({ trace }: { trace: AgentTrace }) {
  const r = policyRefusalSummary(trace.steps, trace.outcome);
  if (!r) return null;
  return (
    <div className="result" data-testid="refusal-panel">
      <div className="banner-review banner-refused" role="alert">
        <span className="ico" aria-hidden="true">
          ⛔
        </span>
        <div>
          <div className="refused-title">
            <b>REFUSED BY POLICY — no payment made</b>
          </div>
          <div className="muted" style={{ fontSize: "0.9rem" }}>
            {r.endpoint} costs <b className="money">{r.price_usdc} USDC</b>, above the <b>{r.max_per_call_usdc} USDC</b> per-call limit set by the agent&apos;s operator.
            The agent stopped before calling the paid endpoint and escalated to a human.
          </div>
        </div>
      </div>

      <div className="summary-row">
        <span className="pill pill-err">{r.code}</span>
        <span className="pill pill-plain">0.00 USDC spent</span>
        <span className="pill pill-plain">nothing signed</span>
        <span className="pill pill-plain">no POST to {r.endpoint}</span>
      </div>

      <section className="card" aria-label="Spending policy">
        <h3>Spending policy (deterministic code, not an LLM)</h3>
        <dl className="kv">
          <dt>Endpoint</dt>
          <dd className="mono">POST {r.endpoint}</dd>
          <dt>Price (from the catalog)</dt>
          <dd>
            <b className="money">{r.price_usdc} USDC</b>
          </dd>
          <dt>Max per call</dt>
          <dd>{r.max_per_call_usdc} USDC</dd>
          <dt>Spent today</dt>
          <dd>
            {r.spent_today_usdc} / {r.daily_budget_usdc} USDC (unchanged)
          </dd>
          <dt>Decision</dt>
          <dd>
            <b style={{ color: "var(--err)" }}>REFUSE</b> · {r.reason}
          </dd>
        </dl>
      </section>

      <section className="card" aria-label="HTTP calls made">
        <h3>
          <span>HTTP calls the agent made</span>
          <span>{r.http_calls.length}</span>
        </h3>
        <ul className="checks">
          {r.http_calls.map((c, i) => (
            <li key={`${c}-${i}`}>
              <span className="ic-ok" aria-label="free call">
                ✓
              </span>
              <span className="mono">{c}</span>
            </li>
          ))}
          <li className="failed">
            <span className="ic-err" aria-label="not called">
              ✕
            </span>
            <span>
              <span className="mono">POST {r.endpoint}</span> never sent: no 402, no PAYMENT-SIGNATURE, no settlement{r.paid_posts.length ? ` (unexpected: ${r.paid_posts.join(", ")})` : ""}
            </span>
          </li>
        </ul>
      </section>

      {r.escalation && (
        <section className="card" aria-label="Escalation">
          <h3>Message the agent sends to its operator</h3>
          <p className="explanation">{r.escalation}</p>
        </section>
      )}
    </div>
  );
}

export function ResultPanel({ trace }: { trace: AgentTrace }) {
  const res = asEntryResponse(trace.result);
  if (!res && trace.outcome === "refused_by_policy") return <PolicyRefusalPanel trace={trace} />;
  if (!res) {
    return (
      <div className="empty">
        <h3>No structured result</h3>
        <p>
          This run ended with outcome <b>{trace.outcome}</b>: the agent did not receive an entry.
        </p>
      </div>
    );
  }
  const status = res.compliance?.status ?? "warning";
  const pill = STATUS_PILL[status] ?? STATUS_PILL.warning;
  const lines = res.entry?.lines ?? [];
  const totalD = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const totalC = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const balanced = res.entry?.balanced ?? Math.abs(totalD - totalC) < 0.005;
  const receipt = res.receipt;
  // Decided per receipt (mode, simulated flag, 0x5151… hash), never per page (Phase 7 review M1).
  const explorer = txExplorerUrl(receipt);
  const anomalies = sortAnomalies(res.anomalies ?? []);
  const checks = sortChecks(res.compliance?.checks ?? []);
  const failed = checks.filter((c) => !c.passed).length;
  const payerUrl = addressUrl(receipt?.payer ?? trace.agent?.wallet);
  const vat = vatSummary(res);
  const vatAnomalies = anomalies.filter((a) => a.code.startsWith("VAT_") && a.severity !== "info");

  return (
    <div className="result" data-testid="result-panel">
      <div>
        <div className="result-title">
          {res.invoice?.supplier?.name ?? "Invoice"} · {res.invoice?.number}
        </div>
        <div className="result-sub">
          {res.invoice?.date} · {invoiceTotalLabel(res)} · for {res.invoice?.customer?.name ?? "the agent's client"}
        </div>
      </div>

      <div className="summary-row">
        <span className={`pill ${pill.cls}`} data-testid="compliance-pill" title={STATUS_TITLE}>
          {pill.label}
        </span>
        {vatAnomalies.length > 0 && (
          <span className="pill pill-warn" data-testid="vat-anomaly-pill">
            ! VAT anomaly: {[...new Set(vatAnomalies.map((a) => a.code))].join(", ")}
          </span>
        )}
        {res.human_review_required ? <span className="pill pill-warn">HUMAN REVIEW REQUIRED</span> : <span className="pill pill-ok">NO HUMAN NEEDED</span>}
        {typeof res.confidence === "number" && <span className="pill pill-plain">confidence {Math.round(res.confidence * 100)}%</span>}
        {res.request_id && !receipt && <span className="pill pill-plain mono">{res.request_id}</span>}
      </div>

      {receipt && (
        <div className="receipt-strip" data-testid="receipt">
          <span>
            Paid <span className="money amt">{receipt.amount ?? "?"}</span> <span className="money">{receipt.asset ?? "USDC"}</span>
          </span>
          <span className="tx">
            tx{" "}
            {explorer ? (
              <a href={explorer} target="_blank" rel="noreferrer" title="Open the transaction on the Base Sepolia explorer (Basescan)">
                {shortHex(receipt.tx_hash, 8, 6)} ↗ Basescan
              </a>
            ) : (
              <>{shortHex(receipt.tx_hash, 8, 6)}</>
            )}
          </span>
          {!explorer && <span className="sim-tag">SIMULATED tx</span>}
          <span className="faint" style={{ fontSize: "0.8rem" }}>
            from{" "}
            {payerUrl ? (
              <a href={payerUrl} target="_blank" rel="noreferrer" className="mono">
                {shortHex(receipt.payer ?? trace.agent?.wallet)}
              </a>
            ) : (
              <span className="mono">{shortHex(receipt.payer ?? trace.agent?.wallet)}</span>
            )}
            {res.request_id && <span className="mono"> · {res.request_id}</span>}
          </span>
        </div>
      )}

      {/* The mini-ledger comes right after the receipt so it is visible without scrolling at 1280×720 (Phase 7 review m1). */}
      <section className="card" aria-label="Journal entry">
        <h3>
          <span>
            Journal entry {res.entry?.journal ? `· journal ${res.entry.journal}` : ""} {res.entry?.reference ? `· ${res.entry.reference}` : ""}
          </span>
          <span className={balanced ? "balanced" : "unbalanced"}>{balanced ? "balanced ✓" : "NOT balanced ✕"}</span>
        </h3>
        <table className="ledger">
          <thead>
            <tr>
              <th scope="col">Account</th>
              <th scope="col">Label</th>
              <th scope="col" className="amt">
                Debit
              </th>
              <th scope="col" className="amt">
                Credit
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={`${l.account}-${i}`}>
                <td className="acct">{l.account}</td>
                <td>{l.label}</td>
                <td className="amt">{l.debit ? money(l.debit) : ""}</td>
                <td className="amt">{l.credit ? money(l.credit) : ""}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>Totals (EUR)</td>
              <td className="amt">{money(totalD)}</td>
              <td className="amt">{money(totalC)}</td>
            </tr>
          </tfoot>
        </table>
      </section>

      {res.human_review_required ? (
        <div className="banner-review" role="alert">
          <span className="ico" aria-hidden="true">
            ⚠
          </span>
          <div>
            <b>Human review required</b>
            {res.review_reasons && res.review_reasons.length > 0 && <span className="mono"> · {res.review_reasons.join(", ")}</span>}
            <div className="muted" style={{ fontSize: "0.88rem" }}>
              The agent prepared the entry but will not let it through on its own: a bookkeeper must confirm.
            </div>
          </div>
        </div>
      ) : (
        <div className="banner-review banner-ok">
          <span className="ico" aria-hidden="true">
            ✓
          </span>
          <div>
            <b>Safe to post automatically</b>
            <div className="muted" style={{ fontSize: "0.88rem" }}>
              Compliant invoice, balanced entry, no blocking anomaly.
            </div>
          </div>
        </div>
      )}

      {anomalies.length > 0 && (
        <section className="card" aria-label="Anomalies">
          <h3>
            Anomalies <span>{anomalies.length}</span>
          </h3>
          {anomalies.map((a, i) => (
            <div key={`${a.code}-${i}`} className="anomaly" style={{ ["--a" as string]: SEV_COLOR[a.severity] ?? "var(--faint)" }}>
              <span className="code">
                {a.code} · {a.severity}
              </span>
              <p>{a.detail}</p>
            </div>
          ))}
        </section>
      )}

      {res.vat && vat && (
        <section className="card" aria-label="VAT treatment" data-testid="vat-panel">
          <h3>VAT treatment</h3>
          <dl className="kv">
            <dt>Regime</dt>
            <dd>
              <b>{REGIME_LABEL[res.vat.regime] ?? res.vat.regime}</b>
            </dd>
            <dt>Deductible</dt>
            <dd>
              <b style={{ color: vat.deductible === "yes" ? "var(--ok)" : vat.deductible === "partly" ? "var(--warn)" : undefined }}>{vat.deductible}</b>
            </dd>
            {vat.rows.map((row, i) => (
              <span key={`${row.label}-${i}`} style={{ display: "contents" }}>
                <dt>{row.label}</dt>
                <dd>
                  <span className="mono" style={row.tone ? { color: row.tone === "ok" ? "var(--ok)" : "var(--warn)" } : undefined}>
                    {row.value}
                  </span>
                  {row.note && <span className="muted"> · {row.note}</span>}
                </dd>
              </span>
            ))}
            {res.vat.note && (
              <>
                <dt>Note</dt>
                <dd className="muted">{res.vat.note}</dd>
              </>
            )}
          </dl>
        </section>
      )}

      {res.explanation && (
        <section className="card" aria-label="Explanation">
          <h3>Explanation the agent relays to its operator</h3>
          <p className="explanation">{res.explanation}</p>
        </section>
      )}

      {checks.length > 0 && (
        <section className="card" aria-label="Compliance checks">
          <h3>
            <span>E-invoicing compliance checks</span>
            <span>
              {checks.length - failed}/{checks.length} passed
            </span>
          </h3>
          <ul className="checks">
            {checks.map((c) => {
              const ic = c.passed ? "ic-ok" : c.severity === "error" ? "ic-err" : "ic-warn";
              return (
                <li key={c.rule_id} className={c.passed ? "" : "failed"}>
                  <span className={ic} aria-label={c.passed ? "passed" : "failed"}>
                    {c.passed ? "✓" : c.severity === "error" ? "✕" : "!"}
                  </span>
                  <span>
                    {c.label}
                    <span className="rid">{c.rule_id}</span>
                    {!c.passed && c.fix_hint && <span className="fix">→ {c.fix_hint}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {res.engine && (
        <p className="disclaimer-small">
          Engine {res.engine.version} · {res.engine.extraction_method} · LLM used: {res.engine.llm_used ? "yes" : "no"} · rules:{" "}
          {res.engine.rules_applied?.join(", ")}
          <br />
          {res.disclaimer}
        </p>
      )}
    </div>
  );
}
