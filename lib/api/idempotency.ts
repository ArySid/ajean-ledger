/**
 * Idempotency-Key handling (Stripe-style).
 * - Same key + same endpoint + same body → stored result replayed, NOT charged again,
 *   checked BEFORE any payment verification (a PAYMENT-SIGNATURE, if present, is ignored).
 * - Same key + different body or endpoint → 409 IDEMPOTENCY_CONFLICT.
 * - Only successful (200 + settled) calls are stored; failed calls can be retried with the same key.
 */
import { ApiError } from "./errors";
import { canonicalJson, sha256Hex } from "./canonical";

export const IDEMPOTENCY_HEADER = "Idempotency-Key";
export const IDEMPOTENT_REPLAY_HEADER = "Idempotent-Replay";
export const IDEMPOTENCY_KEY_MAX = 128;

/** Returns the key, null when absent, or throws INVALID_IDEMPOTENCY_KEY. */
export function readIdempotencyKey(headers: Headers): string | null {
  const raw = headers.get(IDEMPOTENCY_HEADER);
  if (raw === null) return null;
  const key = raw.trim();
  if (key.length === 0 || key.length > IDEMPOTENCY_KEY_MAX || !/^[\x21-\x7e]+$/.test(key)) {
    throw new ApiError(
      "INVALID_IDEMPOTENCY_KEY",
      `Idempotency-Key must be 1..${IDEMPOTENCY_KEY_MAX} visible ASCII characters (a UUID is recommended).`,
    );
  }
  return key;
}

/** Hash of endpoint + canonical body (key order and whitespace do not matter). */
export function requestHash(endpointId: string, parsedBody: unknown, rawBody: string): string {
  const body = parsedBody === undefined ? rawBody : canonicalJson(parsedBody);
  return sha256Hex(`${endpointId}\n${body}`);
}

type Global = typeof globalThis & { __ajeanInflight?: Set<string> };
function inflight(): Set<string> {
  const g = globalThis as Global;
  return (g.__ajeanInflight ??= new Set());
}

/** In-process guard against two concurrent paid calls with the same key (double charge). */
export function acquireKey(key: string): boolean {
  const s = inflight();
  if (s.has(key)) return false;
  s.add(key);
  return true;
}

export function releaseKey(key: string): void {
  inflight().delete(key);
}
