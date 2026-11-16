/**
 * Bundled replays: imported statically so /live and /operator work with no backend at all.
 * The JSON files are sample traces until real recorded runs overwrite them.
 */
import type { AgentTrace } from "@/lib/trace/types";
import { SCENARIOS, type ScenarioId } from "./scenarios";
import r01 from "@/demo/replays/01.json";
import r03 from "@/demo/replays/03.json";
import r04 from "@/demo/replays/04.json";
import r06 from "@/demo/replays/06.json";
import r90 from "@/demo/replays/90.json";

/** AgentTrace plus the optional `sample` marker used by the bundled sample files. */
export type ConsoleTrace = AgentTrace & { sample?: boolean };

export const BUNDLED_REPLAYS: Record<ScenarioId, ConsoleTrace> = {
  "01": r01 as unknown as ConsoleTrace,
  "03": r03 as unknown as ConsoleTrace,
  "04": r04 as unknown as ConsoleTrace,
  "06": r06 as unknown as ConsoleTrace,
  "90": r90 as unknown as ConsoleTrace,
};

export function bundledReplay(scenario: ScenarioId): ConsoleTrace {
  // Deep copy so callers can never mutate the module-level object.
  return JSON.parse(JSON.stringify(BUNDLED_REPLAYS[scenario])) as ConsoleTrace;
}

export function allBundledReplays(): ConsoleTrace[] {
  // Explicit order: Object.keys would put the integer-like key "90" before "01".
  return SCENARIOS.map((s) => bundledReplay(s.id));
}
