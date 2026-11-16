/** Demo scenarios exposed in the /live console (fixture ids from master prompt §5.6). */

export type ScenarioId = "01" | "03" | "04" | "06";

export interface Scenario {
  id: ScenarioId;
  label: string;
  /** What the jury should notice. */
  takeaway: string;
}

export const SCENARIOS: Scenario[] = [
  { id: "01", label: "01 · Office supplies (compliant)", takeaway: "Clean invoice → posted with no human in the loop." },
  { id: "03", label: "03 · Restaurant: 20% vs 10% VAT", takeaway: "The VAT mistake a human would have missed → review flag." },
  { id: "04", label: "04 · EU SaaS: reverse charge", takeaway: "German supplier, no VAT invoiced → self-assessed VAT, net cost zero." },
  { id: "06", label: "06 · Duplicate of invoice 01", takeaway: "Same invoice sent twice → DUPLICATE_SUSPECTED, not posted." },
];

export const DEFAULT_SCENARIO: ScenarioId = "03";

export function isScenarioId(v: unknown): v is ScenarioId {
  return v === "01" || v === "03" || v === "04" || v === "06";
}
