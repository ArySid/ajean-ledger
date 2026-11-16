/**
 * Retry rule of /api/demo/run (Phase 7 review M3). Kept out of the route file: Next.js route
 * modules may only export HTTP handlers and route config.
 */
import type { AgentTrace } from "./types";

/**
 * Retry only failures that happened before the payment was signed: nothing can have been paid.
 * A policy refusal or a missing wallet is not transient and is never retried.
 */
export function isRetryableBeforePayment(trace: AgentTrace): boolean {
  if (trace.outcome !== "error") return false;
  return !trace.steps.some((s) => s.kind === "payment" || s.kind === "settlement");
}

/** The failing step of an error trace, for the console's fallback notice and the logs. */
export function lastErrorOf(trace: AgentTrace): { title: string; detail: string } | null {
  const e = [...trace.steps].reverse().find((s) => s.kind === "error");
  return e ? { title: e.title, detail: e.detail ?? "" } : null;
}
