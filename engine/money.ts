/**
 * Integer-cents arithmetic. All internal amounts are integer cents so that
 * debits == credits holds to the cent; outputs are converted back to numbers
 * with 2 decimals.
 */

export function toCents(amount: number): number {
  // EPSILON nudge avoids 1.005 -> 100.49999 style float artefacts.
  const sign = amount < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(amount) * 100 + 1e-7);
}

export function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}

/** Round a number to 2 decimals (half away from zero). */
export function round2(amount: number): number {
  return fromCents(toCents(amount));
}

/** VAT amount in cents for a base in cents and a rate (e.g. 0.2), rounded half away from zero. */
export function vatCents(baseCents: number, rate: number): number {
  const sign = baseCents < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(baseCents) * rate + 1e-7);
}

/**
 * Split `totalCents` across weights proportionally, so that the parts sum
 * exactly to the total (largest-remainder method, deterministic order).
 */
export function allocate(totalCents: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const sumW = weights.reduce((a, b) => a + Math.abs(b), 0);
  if (sumW === 0) {
    const parts = weights.map(() => 0);
    parts[0] = totalCents;
    return parts;
  }
  const raw = weights.map((w) => (totalCents * Math.abs(w)) / sumW);
  const parts = raw.map((r) => Math.trunc(r));
  let rest = totalCents - parts.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: Math.abs(r - Math.trunc(r)) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  const step = rest >= 0 ? 1 : -1;
  for (let k = 0; rest !== 0 && order.length > 0; k = (k + 1) % order.length) {
    parts[order[k].i] += step;
    rest -= step;
  }
  return parts;
}

export function formatEur(cents: number): string {
  return `${fromCents(cents).toFixed(2)} EUR`;
}
