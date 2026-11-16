import type { HttpExchange, TraceStep } from "@/lib/trace/types";
import { addressUrl, decodedHeaders, isX402Header, prettyJson, relTime, shortHex, stepHighlights } from "@/lib/console/format";

const KIND_COLOR: Record<string, string> = {
  reasoning: "#7fd8f5",
  discovery: "#a9b6ff",
  policy: "#f3b0fb",
  http_request: "#d5deeb",
  payment: "#63b0ff",
  settlement: "#63b0ff",
  erp: "#b5e655",
  review: "#ffbb4d",
  error: "#ff7272",
};

function statusColor(status?: number): string {
  if (status === 402) return "#ffbb4d";
  if (status && status >= 200 && status < 300) return "#44d98f";
  return "#ff7272";
}

export function kindLabel(step: TraceStep): string {
  switch (step.kind) {
    case "http_request":
      return "HTTP →";
    case "http_response":
      return `← ${step.http?.status ?? "HTTP"}`;
    case "erp":
      return "ERP";
    default:
      return step.kind.toUpperCase();
  }
}

function pathOf(url: string): string {
  try {
    const u = new URL(url, "http://local");
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

function statusText(s: number): string {
  const m: Record<number, string> = { 200: "OK", 201: "Created", 400: "Bad Request", 402: "Payment Required", 404: "Not Found", 409: "Conflict", 429: "Too Many Requests", 500: "Server Error" };
  return m[s] ?? "";
}

function ReqLine({ step, http }: { step: TraceStep; http: HttpExchange }) {
  const isResp = step.kind === "http_response" || (step.kind === "discovery" && http.status !== undefined);
  const s = http.status;
  const cls = s === 402 ? "st-402" : s && s < 300 ? "st-2xx" : "st-err";
  return (
    <div className="reqline">
      {step.kind === "http_response" ? "← " : "→ "}
      <b>{http.method}</b> {pathOf(http.url)}
      {isResp && s !== undefined && (
        <>
          {"  "}
          <span className={cls}>
            {s} {statusText(s)}
          </span>
        </>
      )}
    </div>
  );
}

function RawHttp({ http }: { http: HttpExchange }) {
  const decs = decodedHeaders(http);
  const headers = Object.entries(http.headers ?? {});
  return (
    <details className="raw">
      <summary>Raw HTTP exchange</summary>
      <div className="raw-body">
        <div className="raw-sec">
          <h4>{http.status !== undefined ? "Response" : "Request"}</h4>
          <pre>
            {http.method} {http.url}
            {http.status !== undefined ? `\nHTTP/1.1 ${http.status} ${statusText(http.status)}` : ""}
          </pre>
        </div>
        {headers.length > 0 && (
          <div className="raw-sec">
            <h4>Headers</h4>
            <div className="hdrs">
              {headers.map(([k, v]) => (
                <div key={k}>
                  <span className={`hk${isX402Header(k) ? " x402" : ""}`}>{k}:</span>
                  <span className="hv" title={v}>
                    {v}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        {decs.map((d) => (
          <div className="raw-sec" key={d.header}>
            <h4>{d.header} (base64 JSON, decoded)</h4>
            <pre>{prettyJson(d.value)}</pre>
          </div>
        ))}
        {http.body !== undefined && !(typeof http.body === "object" && http.body !== null && Object.keys(http.body).length === 0) && (
          <div className="raw-sec">
            <h4>Body</h4>
            <pre>{prettyJson(http.body)}</pre>
          </div>
        )}
      </div>
    </details>
  );
}

const DATA_KEYS: Record<string, string[]> = {
  policy: ["decision", "code", "price_usdc", "max_per_call_usdc", "spent_today_usdc", "daily_budget_usdc", "reason"],
  payment: ["amount_usdc", "scheme", "network", "from", "to"],
  settlement: ["amount_usdc", "network", "request_id"],
  erp: ["erp_file", "status", "journal", "reference", "lines"],
  review: ["review_reasons", "channel"],
  reasoning: ["inbox_file"],
};

/**
 * Renders one array item: ledger lines as "6257 D 160.60", 402 requirement checks as "amount ✓",
 * other objects as compact JSON (the chip CSS wraps long values inside the card).
 */
export function chipItem(v: unknown): string {
  if (v && typeof v === "object") {
    const o = v as { account?: string; debit?: number; credit?: number; check?: string; ok?: boolean };
    if (typeof o.account === "string") {
      const amt = (o.debit ?? 0) > 0 ? `D ${Number(o.debit).toFixed(2)}` : `C ${Number(o.credit ?? 0).toFixed(2)}`;
      return `${o.account} ${amt}`;
    }
    if (typeof o.check === "string" && typeof o.ok === "boolean") return `${o.check} ${o.ok ? "✓" : "✕"}`;
    return JSON.stringify(v);
  }
  return String(v);
}

export function chipValue(v: unknown): string {
  if (Array.isArray(v)) return v.map(chipItem).join(" / ");
  if (v && typeof v === "object") return chipItem(v);
  if (typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v)) return shortHex(v);
  if (typeof v === "string" && v.length > 40) return shortHex(v, 12, 6);
  return String(v);
}

function DataChips({ step }: { step: TraceStep }) {
  const d = step.data;
  if (!d) return null;
  const keys = DATA_KEYS[step.kind] ?? Object.keys(d).slice(0, 5);
  const shown = keys.filter((k) => Array.isArray(d[k]) || (d[k] !== undefined && d[k] !== null && typeof d[k] !== "object"));
  const tx = typeof d.tx_hash === "string" ? d.tx_hash : undefined;
  const explorer = typeof d.explorer_url === "string" ? d.explorer_url : null;
  if (shown.length === 0 && !tx) return null;
  return (
    <div className="datagrid">
      {shown.map((k) => {
        const v = d[k];
        const tone = k === "decision" ? (v === "allow" ? " ok" : " warn") : k.includes("usdc") ? " money" : "";
        const addr = typeof v === "string" ? addressUrl(v) : null;
        return (
          <span key={k} className={`hl${tone}`}>
            {k}:{" "}
            <b>
              {addr ? (
                <a href={addr} target="_blank" rel="noreferrer">
                  {chipValue(v)}
                </a>
              ) : (
                chipValue(v)
              )}
            </b>
          </span>
        );
      })}
      {tx && (
        <span className="hl money">
          tx:{" "}
          <b>
            {explorer ? (
              <a href={explorer} target="_blank" rel="noreferrer">
                {shortHex(tx, 10, 6)} ↗
              </a>
            ) : (
              shortHex(tx, 10, 6)
            )}
          </b>
          {!explorer && <span className="sim-tag" style={{ marginLeft: 6 }}>SIMULATED tx</span>}
        </span>
      )}
    </div>
  );
}

export function TraceStepItem({ step }: { step: TraceStep }) {
  const color = step.kind === "http_response" ? statusColor(step.http?.status) : (KIND_COLOR[step.kind] ?? "#d5deeb");
  const hls = stepHighlights(step);
  return (
    <li className={`step k-${step.kind}`} style={{ ["--k" as string]: color }} data-kind={step.kind}>
      <span className="step-dot" aria-hidden="true" />
      <div className="step-card">
        <div className="step-top">
          <span className="kind">{kindLabel(step)}</span>
          <span className="step-time">{relTime(step.t_ms)}</span>
        </div>
        <div className="step-title">{step.title}</div>
        {step.detail && <p className="step-detail">{step.detail}</p>}
        {step.http && <ReqLine step={step} http={step.http} />}
        {hls.length > 0 && (
          <div className="highlights">
            {hls.map((h) => (
              <span key={h.label} className={`hl ${h.tone ?? ""}`}>
                {h.label}: <b>{h.value}</b>
              </span>
            ))}
          </div>
        )}
        <DataChips step={step} />
        {step.http && <RawHttp http={step.http} />}
        {!step.http && step.kind === "payment" && step.data && (
          <details className="raw">
            <summary>Signed authorisation (EIP-3009)</summary>
            <div className="raw-body">
              <div className="raw-sec">
                <pre>{prettyJson(step.data)}</pre>
              </div>
            </div>
          </details>
        )}
      </div>
    </li>
  );
}
