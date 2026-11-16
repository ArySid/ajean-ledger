/** Demo scenarios exposed in the /live console (fixture ids from master prompt §5.6, plus inbox item 90). */

export type ScenarioId = "01" | "03" | "04" | "06" | "90";

export interface Scenario {
  id: ScenarioId;
  label: string;
  /** What the jury should notice. */
  takeaway: string;
  /** "entry": the agent pays 0.15 USDC and books an entry. "policy_refusal": the agent refuses to pay. */
  kind: "entry" | "policy_refusal";
}

export const SCENARIOS: Scenario[] = [
  { id: "01", kind: "entry", label: "01 · Office supplies, compliant", takeaway: "Clean invoice → posted with no human in the loop." },
  { id: "03", kind: "entry", label: "03 · Restaurant VAT anomaly", takeaway: "Invoiced at 20% instead of 10% → only the VAT legally due is deducted, excess to expense, review flag." },
  { id: "04", kind: "entry", label: "04 · EU consulting, reverse charge", takeaway: "German consultant, no VAT invoiced → VAT self-assessed (due and deductible, 4452 / 44566), net VAT cost zero." },
  { id: "06", kind: "entry", label: "06 · Duplicate of invoice 01", takeaway: "Same invoice sent twice → DUPLICATE_SUSPECTED, not posted." },
  {
    id: "90",
    kind: "policy_refusal",
    label: "90 · Audit request 1.00 USDC > max_per_call 0.20 → REFUSED by policy",
    takeaway: "The CFO asks for a batch audit. The catalog says /api/v1/audit costs 1.00 USDC, above the agent's 0.20 per-call limit → refused before any payment, escalated to a human.",
  },
];

export const DEFAULT_SCENARIO: ScenarioId = "03";

export function isScenarioId(v: unknown): v is ScenarioId {
  return v === "01" || v === "03" || v === "04" || v === "06" || v === "90";
}

export function isPolicyRefusalScenario(id: ScenarioId): boolean {
  return SCENARIOS.find((s) => s.id === id)?.kind === "policy_refusal";
}
