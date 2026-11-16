/**
 * Traced HTTP helpers: every exchange the agent makes is captured as an HttpExchange for the
 * trace (method, URL, status, protocol headers only, body truncated, x402 headers decoded).
 * Never captures secrets: only an allowlist of headers is recorded.
 */
import type { HttpExchange } from "../lib/trace/types";

const REQUEST_HEADERS = ["content-type", "idempotency-key", "payment-signature", "accept"];
const RESPONSE_HEADERS = ["content-type", "payment-required", "payment-response", "x-request-id", "idempotent-replay", "retry-after"];
/** Canonical spelling for display. */
const CANON: Record<string, string> = {
  "content-type": "content-type",
  accept: "accept",
  "idempotency-key": "Idempotency-Key",
  "payment-signature": "PAYMENT-SIGNATURE",
  "payment-required": "PAYMENT-REQUIRED",
  "payment-response": "PAYMENT-RESPONSE",
  "x-request-id": "X-Request-Id",
  "idempotent-replay": "Idempotent-Replay",
  "retry-after": "Retry-After",
};
const MAX_HEADER_CHARS = 160;

function shortHeader(name: string, v: string): string {
  // PAYMENT-REQUIRED / PAYMENT-RESPONSE are public and kept whole (decodable by any viewer).
  // PAYMENT-SIGNATURE carries a signed transfer authorisation: only its head is kept, the
  // decoded form (signature redacted) is attached separately in http.decoded.
  if (name === "payment-signature" && v.length > MAX_HEADER_CHARS) return `${v.slice(0, MAX_HEADER_CHARS)}… (${v.length} chars, decoded below)`;
  return v;
}

export function pickHeaders(h: Headers | Record<string, string>, allow: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const get = (k: string) => (h instanceof Headers ? h.get(k) : Object.entries(h).find(([n]) => n.toLowerCase() === k)?.[1] ?? null);
  for (const k of allow) {
    const v = get(k);
    if (v) out[CANON[k] ?? k] = shortHeader(k, v);
  }
  return out;
}

export const pickRequestHeaders = (h: Record<string, string>) => pickHeaders(h, REQUEST_HEADERS);
export const pickResponseHeaders = (h: Headers) => pickHeaders(h, RESPONSE_HEADERS);

/** base64 JSON → object (x402 v2 headers). Null on failure. */
export function decodeB64Json(v: string | null | undefined): unknown {
  if (!v) return null;
  try {
    return JSON.parse(Buffer.from(v, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

/** Shortens a 0x signature so the trace never carries a full, reusable authorisation signature. */
export function shortSig(s: unknown): unknown {
  return typeof s === "string" && s.length > 24 ? `${s.slice(0, 12)}…${s.slice(-8)} (redacted)` : s;
}

/** Decoded PAYMENT-SIGNATURE with the signature itself shortened. */
export function redactPaymentPayload(p: unknown): unknown {
  if (!p || typeof p !== "object") return p;
  const o = JSON.parse(JSON.stringify(p)) as { payload?: { signature?: unknown } };
  if (o.payload && typeof o.payload === "object" && "signature" in o.payload) o.payload.signature = shortSig(o.payload.signature);
  return o;
}

/** Deep truncation for display: long strings, long arrays, deep objects. */
export function truncateForTrace(v: unknown, maxString = 1500, maxArray = 40, depth = 0): unknown {
  if (typeof v === "string") return v.length > maxString ? `${v.slice(0, maxString)}… (${v.length} chars)` : v;
  if (Array.isArray(v)) {
    const head = v.slice(0, maxArray).map((x) => truncateForTrace(x, maxString, maxArray, depth + 1));
    if (v.length > maxArray) head.push(`… ${v.length - maxArray} more`);
    return head;
  }
  if (v && typeof v === "object") {
    if (depth > 8) return "[…]";
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = truncateForTrace(x, maxString, maxArray, depth + 1);
    return out;
  }
  return v;
}

export interface TracedResponse {
  res: Response;
  body: unknown;
  exchange: HttpExchange;
  ms: number;
}

/**
 * Performs one HTTP call and returns the parsed body plus the request/response exchanges.
 * `requestExchange` has no status (what the agent sent); `exchange` has the response.
 */
export async function tracedFetch(
  fetchImpl: typeof fetch,
  url: string,
  init: { method: string; headers?: Record<string, string>; body?: unknown },
  signal?: AbortSignal,
): Promise<TracedResponse & { requestExchange: HttpExchange }> {
  const headers = init.headers ?? {};
  const bodyText = init.body === undefined ? undefined : JSON.stringify(init.body);
  const requestExchange: HttpExchange = {
    method: init.method,
    url,
    headers: pickRequestHeaders(headers),
    ...(init.body !== undefined ? { body: truncateForTrace(init.body) } : {}),
  };
  const t0 = Date.now();
  const res = await fetchImpl(url, { method: init.method, headers, body: bodyText, signal, cache: "no-store" } as RequestInit);
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* keep text */
  }
  const exchange: HttpExchange = {
    method: init.method,
    url,
    status: res.status,
    headers: pickResponseHeaders(res.headers),
    body: truncateForTrace(body),
  };
  return { res, body, exchange, requestExchange, ms: Date.now() - t0 };
}
