/**
 * Rate limit placeholder (hardened in Phase 6): fixed 60 s window, per client IP,
 * in-process only (per serverless instance). RATE_LIMIT_PER_MINUTE=0 disables it.
 */
const WINDOW_MS = 60_000;
const DEFAULT_LIMIT = 120;

type Global = typeof globalThis & { __ajeanRate?: Map<string, { start: number; count: number }> };
function buckets() {
  const g = globalThis as Global;
  return (g.__ajeanRate ??= new Map());
}

export function rateLimitPerMinute(): number {
  const raw = process.env.RATE_LIMIT_PER_MINUTE;
  const n = raw === undefined || raw === "" ? DEFAULT_LIMIT : Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_LIMIT;
}

export function clientKey(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "local";
}

/** Returns null if allowed, or the number of seconds to wait. */
export function checkRateLimit(key: string, now: number = Date.now()): number | null {
  const limit = rateLimitPerMinute();
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
