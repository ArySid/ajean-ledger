/**
 * Recorded replays (demo/replays/NN.json), bundled statically so the serverless routes need no
 * filesystem access. Written by `npm run record:replays` from real runs of the agent.
 */
import r01 from "../demo/replays/01.json";
import r03 from "../demo/replays/03.json";
import r04 from "../demo/replays/04.json";
import r06 from "../demo/replays/06.json";
import type { AgentTrace } from "../lib/trace/types";
import type { DemoScenarioId } from "./scenarios";

const REPLAYS: Record<DemoScenarioId, AgentTrace> = {
  "01": r01 as unknown as AgentTrace,
  "03": r03 as unknown as AgentTrace,
  "04": r04 as unknown as AgentTrace,
  "06": r06 as unknown as AgentTrace,
};

/** Deep copy with mode forced to REPLAY. */
export function getReplay(id: DemoScenarioId): AgentTrace {
  const t = JSON.parse(JSON.stringify(REPLAYS[id])) as AgentTrace;
  return { ...t, mode: "REPLAY" };
}

export function allReplays(): AgentTrace[] {
  return (Object.keys(REPLAYS) as DemoScenarioId[]).map(getReplay);
}
