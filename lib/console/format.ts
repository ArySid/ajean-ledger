/** Formatting and decoding helpers for the console (pure, no React). */
import type { EntryResult } from "@/engine/types";
import type { HttpExchange, TraceStep } from "@/lib/trace/types";

export const BASE_SEPOLIA_EXPLORER = "https://sepolia.basescan.org";

/** Mirrors lib/payments/receipt.ts (kept optional-tolerant for older traces). */
export interface Receipt {
  amount?: string;
  amount_atomic?: string;
  asset?: string;
  network?: string;
  network_caip2?: string;
  tx_hash?: string;
  explorer_url?: string | null;
  payer?: string | null;
  pay_to?: string;
  mode?: "testnet" | "simulated";
  paid_at?: string;
  simulated?: boolean;
}

/** Prefix of tx hashes produced by the simulated facilitator (lib/payments/simulated-facilitator.ts). */
export const SIMULATED_TX_PREFIX = "0x5151";

/** What /api/v1/entry returns: EntryResult + request_id + receipt (all optional-tolerant). */
export type EntryResponse = Partial<EntryResult> & { request_id?: string; receipt?: Receipt };

export function asEntryResponse(v: unknown): EntryResponse | null {
  if (!v || typeof v !== "object") return null;
  return v as EntryResponse;
}

const eurFmt = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 1234.5 → "1,234.50" (deterministic, locale-pinned to avoid hydration drift). */
export function money(n: unknown): string {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return "—";
  return eurFmt.format(v);
}

export function usdc(n: unknown, digits = 2): string {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return "—";
  return v.toFixed(digits);
}

export function pct(rate: unknown): string {
  const v = typeof rate === "number" ? rate : Number(rate);
  if (!Number.isFinite(v)) return "—";
  const p = v * 100;
  return `${Number.isInteger(p) ? p.toFixed(0) : p.toFixed(1)}%`;
}

export function shortHex(h: string | undefined | null, head = 6, tail = 4): string {
  if (!h) return "—";
  if (h.length <= head + tail + 1) return h;
  return `${h.slice(0, head)}…${h.slice(-tail)}`;
}

export function isRealTxHash(h: string | undefined | null): h is string {
  return !!h && /^0x[0-9a-fA-F]{64}$/.test(h);
}

/** Explorer URL for a receipt, or null when the tx is simulated / unknown. */
export function txExplorerUrl(r: Receipt | undefined): string | null {
  if (!r || isSimulatedTx(r)) return null;
  if (r.explorer_url) return r.explorer_url;
  if (isRealTxHash(r.tx_hash)) return `${BASE_SEPOLIA_EXPLORER}/tx/${r.tx_hash}`;
  return null;
}

/**
 * Explorer link for a trace step that carries a `tx_hash` (settlement, ERP), or null when the tx is
 * simulated. Decided per hash, never per page: `explorer_url` wins; `simulated: true`, `mode: "simulated"`
 * or a `0x5151…` hash (simulated facilitator) mean simulated; any other 32-byte hash is a real Base
 * Sepolia tx and gets a Basescan link (older ERP steps had no `explorer_url`, Phase 7 review M1).
 */
export function stepTxExplorerUrl(data: Record<string, unknown> | undefined | null): string | null {
  if (!data) return null;
  const tx = typeof data.tx_hash === "string" ? data.tx_hash : null;
  if (typeof data.explorer_url === "string" && data.explorer_url) return data.explorer_url;
  if (data.simulated === true || data.mode === "simulated") return null;
  if (!isRealTxHash(tx) || tx.toLowerCase().startsWith(SIMULATED_TX_PREFIX)) return null;
  return `${BASE_SEPOLIA_EXPLORER}/tx/${tx}`;
}

export function addressUrl(addr: string | undefined | null): string | null {
  if (!addr || !/^0x[0-9a-fA-F]{40}$/.test(addr)) return null;
  return `${BASE_SEPOLIA_EXPLORER}/address/${addr}`;
}

export function isSimulatedTx(r: Receipt | undefined): boolean {
  if (!r) return true;
  if (r.simulated || r.mode === "simulated") return true;
  if (r.explorer_url) return false;
  return !isRealTxHash(r.tx_hash) || r.tx_hash.startsWith(SIMULATED_TX_PREFIX);
}

/** "+3.48 s" */
export function relTime(ms: number): string {
  return `+${(ms / 1000).toFixed(2)} s`;
}

/** Decode a base64 JSON header value; returns null if it is not base64 JSON. */
export function decodeBase64Json(value: string): unknown | null {
  try {
    const bin = typeof atob === "function" ? atob(value) : Buffer.from(value, "base64").toString("binary");
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const text = new TextDecoder().decode(bytes);
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const X402_HEADERS = ["payment-required", "payment-signature", "payment-response", "x-payment", "x-payment-response"];

export function isX402Header(name: string): boolean {
  return X402_HEADERS.includes(name.toLowerCase());
}

/** All decoded x402 headers of an exchange (from `decoded` or by decoding the header values). */
export function decodedHeaders(http: HttpExchange): { header: string; value: unknown }[] {
  const out: { header: string; value: unknown }[] = [];
  if (http.decoded) out.push(http.decoded);
  for (const [k, v] of Object.entries(http.headers ?? {})) {
    if (!isX402Header(k)) continue;
    if (out.some((d) => d.header.toLowerCase() === k.toLowerCase())) continue;
    const dec = decodeBase64Json(v);
    if (dec !== null) out.push({ header: k.toUpperCase(), value: dec });
  }
  return out;
}

export function prettyJson(v: unknown): string {
  if (v === undefined) return "";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

/** Atomic USDC units (6 decimals) → "0.15". */
export function atomicToUsdc(amount: unknown): string | null {
  if (typeof amount !== "string" && typeof amount !== "number") return null;
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  return (n / 1_000_000).toFixed(2);
}

export interface StepHighlight {
  label: string;
  value: string;
  tone?: "money" | "ok" | "warn" | "plain";
}

/** Key facts shown inline (without expanding) for x402 steps. */
export function stepHighlights(step: TraceStep): StepHighlight[] {
  const http = step.http;
  if (!http) return [];
  const decs = decodedHeaders(http);
  const pr = decs.find((d) => d.header.toUpperCase() === "PAYMENT-REQUIRED")?.value as
    | { accepts?: { amount?: string; network?: string; payTo?: string; asset?: string; scheme?: string }[] }
    | undefined;
  if (http.status === 402 && pr?.accepts?.[0]) {
    const a = pr.accepts[0];
    return [
      { label: "price", value: `${atomicToUsdc(a.amount) ?? "?"} USDC`, tone: "money" },
      { label: "atomic", value: String(a.amount ?? "?") },
      { label: "scheme", value: String(a.scheme ?? "exact") },
      { label: "network", value: String(a.network ?? "?") },
      { label: "payTo", value: shortHex(a.payTo) },
    ];
  }
  const ps = decs.find((d) => d.header.toUpperCase() === "PAYMENT-SIGNATURE")?.value as
    | { payload?: { authorization?: { from?: string; value?: string } } }
    | undefined;
  if (ps?.payload?.authorization) {
    const au = ps.payload.authorization;
    return [
      { label: "PAYMENT-SIGNATURE", value: "attached", tone: "ok" },
      { label: "amount", value: `${atomicToUsdc(au.value) ?? "?"} USDC`, tone: "money" },
      { label: "from", value: shortHex(au.from) },
    ];
  }
  const resp = decs.find((d) => d.header.toUpperCase() === "PAYMENT-RESPONSE")?.value as
    | { success?: boolean; transaction?: string; network?: string }
    | undefined;
  if (resp) {
    return [
      { label: "settled", value: resp.success ? "yes" : "no", tone: resp.success ? "ok" : "warn" },
      { label: "tx", value: shortHex(resp.transaction, 10, 6) },
      { label: "network", value: String(resp.network ?? "?") },
    ];
  }
  return [];
}

/** Index of the step at which the structured result can be revealed (first HTTP 200 on a paid call). */
export function resultRevealIndex(steps: TraceStep[]): number {
  const i = steps.findIndex((s) => s.kind === "http_response" && s.http?.status === 200 && s.http?.method?.toUpperCase() === "POST");
  return i >= 0 ? i : steps.length - 1;
}

/** "2026-11-16T09:41:12Z" → "16 Nov 2026, 09:41 UTC" (deterministic). */
export function utcStamp(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

/** "09:41:12" UTC */
export function utcTime(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(11, 19);
}

/** "0.9 s of agent time", or null when the figure is meaningless (< 0.1 s, e.g. a replay recorded on localhost). */
export function agentTimeLabel(ms: unknown): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 100) return null;
  return `${(ms / 1000).toFixed(1)} s of agent time`;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** "175.20 EUR incl. VAT", or for an invoice that carries no VAT the wording that does not imply one (review m9). */
export function invoiceTotalLabel(res: EntryResponse): string {
  const total = res.invoice?.totals?.total_incl_vat;
  const vat = res.invoice?.totals?.total_vat;
  if (vat === 0) {
    const reverse = String(res.vat?.regime ?? "").startsWith("reverse_charge");
    return reverse ? `${money(total)} EUR total payable to the supplier · reverse charge: VAT self-assessed` : `${money(total)} EUR, no VAT invoiced`;
  }
  return `${money(total)} EUR incl. VAT`;
}

export interface VatRow {
  label: string;
  value: string;
  note?: string;
  tone?: "ok" | "warn";
}

export interface VatSummary {
  /** Is the VAT invoiced recoverable? "partly" when only the VAT legally due was deducted. */
  deductible: "yes" | "partly" | "no";
  invoiced_vat: number;
  /** Deductible VAT actually booked (sum of the 4456x lines of the entry). */
  deductible_booked: number;
  /** VAT due booked on 4452 (reverse charge self-assessment). */
  self_assessed_due: number;
  rows: VatRow[];
}

/**
 * VAT panel figures read from what was actually BOOKED (entry lines on 4456x / 4452), the invoice totals,
 * `vat.breakdown` and the VAT anomalies — so the panel can never contradict the ledger (Phase 5 review m3:
 * fixture 03 showed "Deductible: yes · 29.20 at 20%" next to a 44566 line of 14.60).
 */
export function vatSummary(res: EntryResponse): VatSummary | null {
  if (!res.vat) return null;
  const lines = res.entry?.lines ?? [];
  const net = (prefix: string) => round2(lines.filter((l) => String(l.account).startsWith(prefix)).reduce((s, l) => s + (Number(l.debit) || 0) - (Number(l.credit) || 0), 0));
  const dedNet = net("4456");
  const deductible = Math.abs(dedNet);
  const due = Math.abs(net("4452"));
  const dedAccounts = [...new Set(lines.filter((l) => String(l.account).startsWith("4456")).map((l) => l.account))].join(" + ");
  const breakdown = res.vat.breakdown ?? [];
  const selfAssessed = String(res.vat.regime).startsWith("reverse_charge") || due > 0;
  const invoiced = Math.abs(res.invoice?.totals?.total_vat ?? (selfAssessed ? 0 : breakdown.reduce((s, b) => s + (Number(b.vat) || 0), 0)));
  const reversed = dedNet < 0 ? " (reversed: credit note)" : "";
  const rows: VatRow[] = [];

  if (selfAssessed) {
    rows.push({ label: "VAT invoiced", value: invoiced > 0 ? `${money(invoiced)} EUR` : "none (reverse charge)" });
    for (const b of breakdown) rows.push({ label: "Self-assessed", value: `${money(b.vat)} EUR at ${pct(b.rate)} on ${money(b.base)}` });
    rows.push({ label: "Due (4452)", value: `${money(due)} EUR` });
    rows.push({ label: `Deductible (${dedAccounts || "44566"})`, value: `${money(deductible)} EUR`, tone: deductible > 0 ? "ok" : undefined });
    rows.push({ label: "Net VAT cost", value: `${money(round2(due - deductible))} EUR`, note: due === deductible ? "due and deductible cancel out" : undefined });
    return { deductible: deductible > 0 ? "yes" : "no", invoiced_vat: invoiced, deductible_booked: deductible, self_assessed_due: due, rows };
  }

  for (const b of breakdown) rows.push({ label: "Invoiced", value: `${money(b.base)} + VAT ${money(b.vat)} at ${pct(b.rate)}` });
  const notDeducted = round2(invoiced - deductible);
  const status: VatSummary["deductible"] = deductible < 0.005 ? "no" : notDeducted > 0.005 ? "partly" : "yes";
  rows.push({
    label: `Deductible VAT booked${dedAccounts ? ` (${dedAccounts})` : ""}`,
    value: `${money(deductible)} EUR${reversed}`,
    note: status === "partly" ? `of ${money(invoiced)} EUR invoiced` : status === "yes" ? "all the VAT invoiced" : undefined,
    tone: status === "yes" ? "ok" : status === "partly" ? "warn" : undefined,
  });
  if (notDeducted > 0.005) {
    const expected = [
      ...new Set(
        (res.anomalies ?? [])
          .filter((a) => a.code === "VAT_RATE_MISMATCH")
          .map((a) => /expected rate[^.]*? is (\d+(?:[.,]\d+)?%)/i.exec(a.detail ?? "")?.[1])
          .filter((x): x is string => !!x),
      ),
    ];
    rows.push({
      label: "Not deducted",
      value: `${money(notDeducted)} EUR → added to the expense`,
      note: expected.length ? `VAT legally due at ${expected.join(" / ")}: the excess is not deductible` : "non-deductible VAT",
      tone: "warn",
    });
  }
  return { deductible: status, invoiced_vat: invoiced, deductible_booked: deductible, self_assessed_due: 0, rows };
}

export interface PolicyRefusal {
  endpoint: string;
  price_usdc: string;
  max_per_call_usdc: string;
  spent_today_usdc: string;
  daily_budget_usdc: string;
  code: string;
  reason: string;
  escalation: string;
  /** Every HTTP call the agent made, e.g. "GET /api/v1/catalog". */
  http_calls: string[];
  /** POST calls to a paid endpoint: must be empty for a policy refusal. */
  paid_posts: string[];
  signed: boolean;
}

/** What a "refused_by_policy" trace shows in the result column (Phase 5 review M3). Null for other outcomes. */
export function policyRefusalSummary(steps: TraceStep[], outcome: string | undefined): PolicyRefusal | null {
  if (outcome !== "refused_by_policy") return null;
  const pol = [...steps].reverse().find((s) => s.kind === "policy" && s.data?.decision === "refuse");
  const d = (pol?.data ?? {}) as Record<string, unknown>;
  const str = (v: unknown, dflt = "?") => (typeof v === "string" && v ? v : dflt);
  const review = steps.find((s) => s.kind === "review");
  const calls = steps.filter((s) => s.http && s.kind !== "http_response").map((s) => `${s.http!.method} ${new URL(s.http!.url, "http://x").pathname}`);
  return {
    endpoint: str(d.endpoint),
    price_usdc: str(d.price_usdc),
    max_per_call_usdc: str(d.max_per_call_usdc),
    spent_today_usdc: str(d.spent_today_usdc, "0.00"),
    daily_budget_usdc: str(d.daily_budget_usdc),
    code: str(d.code, "REFUSED"),
    reason: pol?.detail ?? "",
    escalation: review?.detail ?? "",
    http_calls: calls,
    paid_posts: calls.filter((c) => c.startsWith("POST ")),
    signed: steps.some((s) => s.kind === "payment"),
  };
}
