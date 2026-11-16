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
