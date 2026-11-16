/**
 * The 4 demo scenarios of the /live console, statically bundled (no fs at runtime, so the
 * serverless route /api/demo/run works on Vercel). Same inbox envelopes and fixtures as the CLI.
 */
import fx01 from "../fixtures/01.json";
import fx03 from "../fixtures/03.json";
import fx04 from "../fixtures/04.json";
import fx06 from "../fixtures/06.json";
import in01 from "../inbox/01-buro-velours-office-supplies.json";
import in03 from "../inbox/03-le-bouchon-lumiere-restaurant.json";
import in04 from "../inbox/04-kranich-beratung-consulting.json";
import in06 from "../inbox/06-buro-velours-resent.json";
import { buildInboxItem, type FixtureJson, type InboxMeta } from "./inbox";
import type { InboxItem } from "./types";

export type DemoScenarioId = "01" | "03" | "04" | "06";
export const DEMO_SCENARIO_IDS: DemoScenarioId[] = ["01", "03", "04", "06"];

const FIXTURES: Record<string, FixtureJson> = {
  "01": fx01 as unknown as FixtureJson,
  "03": fx03 as unknown as FixtureJson,
  "04": fx04 as unknown as FixtureJson,
  "06": fx06 as unknown as FixtureJson,
};

const INBOX: Record<DemoScenarioId, { meta: InboxMeta; file: string }> = {
  "01": { meta: in01 as InboxMeta, file: "inbox/01-buro-velours-office-supplies.json" },
  "03": { meta: in03 as InboxMeta, file: "inbox/03-le-bouchon-lumiere-restaurant.json" },
  "04": { meta: in04 as InboxMeta, file: "inbox/04-kranich-beratung-consulting.json" },
  "06": { meta: in06 as InboxMeta, file: "inbox/06-buro-velours-resent.json" },
};

/** Same labels as lib/console/scenarios.ts (kept local: the agent does not import console code). */
export const DEMO_SCENARIO_LABELS: Record<DemoScenarioId, string> = {
  "01": "01 · Office supplies (compliant)",
  "03": "03 · Restaurant: 20% vs 10% VAT",
  "04": "04 · EU consulting: reverse charge",
  "06": "06 · Duplicate of invoice 01",
};

export function isDemoScenarioId(v: unknown): v is DemoScenarioId {
  return typeof v === "string" && (DEMO_SCENARIO_IDS as string[]).includes(v);
}

export function scenarioItem(id: DemoScenarioId): InboxItem {
  const { meta, file } = INBOX[id];
  // Deep copy so a run can never mutate the bundled JSON.
  return JSON.parse(
    JSON.stringify(
      buildInboxItem(meta, file, (fid) => {
        const fx = FIXTURES[fid];
        if (!fx) throw new Error(`fixture ${fid} is not bundled`);
        return fx;
      }),
    ),
  ) as InboxItem;
}
