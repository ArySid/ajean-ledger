import type { Anomaly, ComplianceCheck } from "@/engine/types";
import type { AgentTrace } from "@/lib/trace/types";
import { addressUrl, asEntryResponse, isSimulatedTx, money, pct, shortHex, txExplorerUrl } from "@/lib/console/format";

const STATUS_PILL: Record<string, { cls: string; label: string }> = {
  compliant: { cls: "pill-ok", label: "✓ COMPLIANT" },
  warning: { cls: "pill-warn", label: "! WARNING" },
  non_compliant: { cls: "pill-err", label: "✕ NON-COMPLIANT" },
};

const SEV_COLOR: Record<string, string> = { error: "var(--err)", warning: "var(--warn)", info: "var(--faint)" };

const REGIME_LABEL: Record<string, string> = {
  standard: "Standard rate",
  reduced: "Reduced rate",
  reverse_charge_intra_eu: "Intra-EU reverse charge (autoliquidation)",
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

export function ResultPanel({ trace }: { trace: AgentTrace }) {
  const res = asEntryResponse(trace.result);
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
  const simulated = isSimulatedTx(receipt) || trace.recorded_from === "simulated" || trace.mode === "SIMULATED";
  const explorer = simulated ? null : txExplorerUrl(receipt);
  const anomalies = sortAnomalies(res.anomalies ?? []);
  const checks = sortChecks(res.compliance?.checks ?? []);
  const failed = checks.filter((c) => !c.passed).length;
  const payerUrl = addressUrl(receipt?.payer ?? trace.agent?.wallet);

  return (
    <div className="result" data-testid="result-panel">
      <div>
        <div className="result-title">
          {res.invoice?.supplier?.name ?? "Invoice"} · {res.invoice?.number}
        </div>
        <div className="result-sub">
          {res.invoice?.date} · {money(res.invoice?.totals?.total_incl_vat)} EUR incl. VAT · for {res.invoice?.customer?.name ?? "the agent's client"}
        </div>
      </div>

      <div className="summary-row">
        <span className={`pill ${pill.cls}`} data-testid="compliance-pill">
          {pill.label}
        </span>
        {res.human_review_required ? <span className="pill pill-warn">HUMAN REVIEW REQUIRED</span> : <span className="pill pill-ok">NO HUMAN NEEDED</span>}
        {typeof res.confidence === "number" && <span className="pill pill-plain">confidence {Math.round(res.confidence * 100)}%</span>}
        {res.request_id && <span className="pill pill-plain mono">{res.request_id}</span>}
      </div>

      {receipt && (
        <div className="receipt-strip" data-testid="receipt">
          <span>
            Paid <span className="money amt">{receipt.amount ?? "?"}</span> <span className="money">{receipt.asset ?? "USDC"}</span>
          </span>
          <span className="tx">
            tx{" "}
            {explorer ? (
              <a href={explorer} target="_blank" rel="noreferrer">
                {shortHex(receipt.tx_hash, 10, 8)} ↗ Base Sepolia explorer
              </a>
            ) : (
              <>{shortHex(receipt.tx_hash, 10, 8)}</>
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
            )}{" "}
            · {receipt.network ?? "base-sepolia"}
          </span>
        </div>
      )}

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

      {res.vat && (
        <section className="card" aria-label="VAT treatment">
          <h3>VAT treatment</h3>
          <dl className="kv">
            <dt>Regime</dt>
            <dd>
              <b>{REGIME_LABEL[res.vat.regime] ?? res.vat.regime}</b>
            </dd>
            <dt>Rate</dt>
            <dd>{pct(res.vat.rate)}</dd>
            <dt>Deductible</dt>
            <dd>{res.vat.deductible ? "yes" : "no"}</dd>
            {res.vat.breakdown?.map((b, i) => (
              <span key={i} style={{ display: "contents" }}>
                <dt>Base / VAT</dt>
                <dd className="mono">
                  {money(b.base)} / {money(b.vat)} at {pct(b.rate)}
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
