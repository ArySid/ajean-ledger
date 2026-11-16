/**
 * Simple rate limiter (Phase 6): fixed 60 s window, per client IP, in-process only
 * (per server instance / Cloudflare isolate — no shared state, by design for a PoC).
 *
 * Applied to: the three paid endpoints and /mcp (RATE_LIMIT_PER_MINUTE, default 120) and the
 * console's POST /api/demo/run (DEMO_RUN_RATE_LIMIT_PER_MINUTE, default 30, separate bucket).
 * 0 disables a limit. Client IP: CF-Connecting-IP (set by Cloudflare, not spoofable behind it),
 * else X-Real-IP, else the first X-Forwarded-For hop, else "local".
 *
 * Budget check for the presentation (verified on a local server): two warmups + two full demos of the
 * four scenarios within one minute = 10 demo runs and ~30 paid-route hits, i.e. a third of each limit.
 * Note: the demo agent's self-calls to the paid endpoints come from the Worker itself and share one
 * bucket (~2 hits per demo run → ~60 demo runs/min before a 429, which the console turns into REPLAY).
 */
const WINDOW_MS = 60_000;
export const DEFAULT_LIMIT = 120;
export const DEFAULT_DEMO_RUN_LIMIT = 30;

type Global = typeof globalThis & { __ajeanRate?: Map<string, { start: number; count: number }> };
function buckets() {
  const g = globalThis as Global;
  return (g.__ajeanRate ??= new Map());
}

function readLimit(raw: string | undefined, fallback: number): number {
  const n = raw === undefined || raw === "" ? fallback : Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

/** Requests per client IP and minute on the paid endpoints and /mcp. */
export function rateLimitPerMinute(): number {
  return readLimit(process.env.RATE_LIMIT_PER_MINUTE, DEFAULT_LIMIT);
}

/** Demo runs (POST /api/demo/run) per client IP and minute. */
export function demoRunRateLimitPerMinute(): number {
  return readLimit(process.env.DEMO_RUN_RATE_LIMIT_PER_MINUTE, DEFAULT_DEMO_RUN_LIMIT);
}

export function clientKey(headers: Headers): string {
  return (
    headers.get("cf-connecting-ip")?.trim() ||
    headers.get("x-real-ip")?.trim() ||
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "local"
  );
}

/** Returns null if allowed, or the number of seconds to wait. */
export function checkRateLimit(key: string, now: number = Date.now(), limit: number = rateLimitPerMinute()): number | null {
  if (limit === 0) return null;
  const b = buckets();
  const cur = b.get(key);
  if (!cur || now - cur.start >= WINDOW_MS) {
    b.set(key, { start: now, count: 1 });
    if (b.size > 10_000) b.clear();
    return null;
  }
  cur.count += 1;
  if (cur.count > limit) return Math.max(1, Math.ceil((cur.start + WINDOW_MS - now) / 1000));
  return null;
}

export function resetRateLimit(): void {
  buckets().clear();
}
