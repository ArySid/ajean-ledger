/**
 * Agent trace — the shared format between the demo agent (agent/), the live
 * console (/live), the recorded replays (demo/replays/*.json) and the operator view.
 *
 * A trace is the step-by-step record of ONE agent processing ONE document:
 * reasoning → discovery → policy check → unpaid request → 402 → payment →
 * paid request → 200 → ERP posting → human-review flag.
 */

export type PaymentModeLabel = "TESTNET" | "SIMULATED" | "REPLAY";

export interface HttpExchange {
  method: string;
  url: string;
  status?: number;
  /** Only protocol-relevant headers (content-type, PAYMENT-*, Idempotency-Key…). Never secrets. */
  headers: Record<string, string>;
  /** Parsed JSON body (truncated if huge) or text. */
  body?: unknown;
  /** Decoded x402 header (base64 JSON → object) when relevant, for display. */
  decoded?: { header: string; value: unknown };
}

export type TraceStepKind =
  | "reasoning" // the agent's own thinking (scripted or LLM)
  | "discovery" // GET catalog / llms.txt
  | "policy" // spending-policy decision (allow / refuse + why)
  | "http_request"
  | "http_response"
  | "payment" // signing the x402 payment (EIP-3009 authorisation)
  | "settlement" // tx hash returned by the service
  | "erp" // posting into the mock ERP
  | "review" // human review flag raised
  | "error";

export interface TraceStep {
  /** Milliseconds since trace start. */
  t_ms: number;
  kind: TraceStepKind;
  title: string;
  detail?: string;
  http?: HttpExchange;
  /** Free structured payload (policy numbers, ERP line, etc.). */
  data?: Record<string, unknown>;
}

export interface AgentTrace {
  id: string;
  /** Fixture / scenario id, e.g. "01", "03". */
  scenario: string;
  scenario_label: string;
  mode: PaymentModeLabel;
  /** Was this trace recorded from a real testnet run? */
  recorded_from?: "testnet" | "simulated";
  recorded_at: string; // ISO
  agent: { name: string; wallet: string; policy: { max_per_call_usdc: string; daily_budget_usdc: string } };
  service_url: string;
  steps: TraceStep[];
  /** Final EntryResult (or CheckResult) returned by the service, with request_id and receipt. */
  result?: unknown;
  /** Total wall time. */
  duration_ms: number;
  outcome: "posted" | "posted_with_review" | "refused_by_policy" | "error";
}
