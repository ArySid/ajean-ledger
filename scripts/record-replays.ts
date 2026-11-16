/**
 * npm run record:replays — records the demo replays from REAL runs of the agent.
 *
 * Runs the purchasing agent on scenarios 01, 03, 04, 06 (one shared mock ERP and spend ledger,
 * like a working day) against AJEAN_LEDGER_URL (or --url), then writes demo/replays/NN.json
 * with mode "REPLAY", recorded_from = the server's payment mode, recorded_at = now.
 * Files are only overwritten when ALL four runs succeeded with the expected outcome.
 *
 *   PAYMENT_MODE=simulated npx next start -p 3500   (or npm run dev)
 *   AJEAN_LEDGER_URL=http://localhost:3500 npm run record:replays
 *   flags: --url <base>  --dry-run (print a summary, write nothing)
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { runAgent } from "../agent/core";
import { MemoryErp } from "../agent/erp";
import { MemorySpendLedger, policyFromEnv } from "../agent/policy";
import { DEMO_SCENARIO_IDS, DEMO_SCENARIO_LABELS, scenarioItem, type DemoScenarioId } from "../agent/scenarios";
import type { AgentTrace } from "../agent/types";

for (const f of [".env.local", ".env"]) {
  try {
    if (existsSync(f)) process.loadEnvFile(f);
  } catch {
    /* ignore */
  }
}
const argv = process.argv.slice(2);
const argVal = (n: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const EXPECTED: Record<DemoScenarioId, AgentTrace["outcome"]> = {
  "01": "posted",
  "03": "posted_with_review",
  "04": "posted",
  "06": "posted_with_review",
};

async function main() {
  const url = (argVal("url") ?? process.env.AJEAN_LEDGER_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const health = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(5000) })
    .then((r) => r.json() as Promise<{ payment?: { mode?: string } }>)
    .catch(() => null);
  const mode = health?.payment?.mode === "testnet" ? "testnet" : health?.payment?.mode === "simulated" ? "simulated" : null;
  if (!mode) {
    console.error(`Cannot reach ${url}/api/health. Start a server first (PAYMENT_MODE=simulated npm run dev).`);
    process.exit(1);
  }
  const key = process.env.AGENT_PRIVATE_KEY?.trim();
  let wallet;
  let walletNote: string | undefined;
  if (key && /^0x[0-9a-fA-F]{64}$/.test(key)) wallet = privateKeyToAccount(key as `0x${string}`);
  else if (mode === "simulated") {
    wallet = privateKeyToAccount(generatePrivateKey());
    walletNote = "AGENT_PRIVATE_KEY not set: ephemeral wallet generated for this run (SIMULATED only)";
  } else {
    console.error("AGENT_PRIVATE_KEY is required to record TESTNET replays.");
    process.exit(1);
  }

  console.log(`Recording replays against ${url} (${mode.toUpperCase()}), agent wallet ${wallet.address}`);
  const erp = new MemoryErp();
  const ledger = new MemorySpendLedger();
  const traces: AgentTrace[] = [];
  const failures: string[] = [];
  for (const id of DEMO_SCENARIO_IDS) {
    const trace = await runAgent({
      serviceUrl: url,
      item: scenarioItem(id),
      mode,
      wallet,
      walletNote,
      policy: policyFromEnv(),
      ledger,
      erp,
      reasoning: "scripted",
      scenarioLabel: DEMO_SCENARIO_LABELS[id],
    });
    const ok = trace.outcome === EXPECTED[id];
    console.log(`  ${id}  ${trace.outcome.padEnd(20)} ${trace.steps.length} steps  ${trace.duration_ms} ms  ${ok ? "OK" : `EXPECTED ${EXPECTED[id]}`}`);
    if (!ok) {
      failures.push(id);
      const err = trace.steps.filter((s) => s.kind === "error").map((s) => `${s.title}: ${s.detail ?? ""}`);
      if (err.length) console.log(`      ${err.join("\n      ")}`);
    }
    traces.push(trace);
  }
  if (failures.length) {
    console.error(`\nNot writing anything: scenario(s) ${failures.join(", ")} did not end as expected. Existing replays are untouched.`);
    process.exit(2);
  }
  if (argv.includes("--dry-run")) {
    console.log("\n--dry-run: nothing written.");
    return;
  }
  mkdirSync("demo/replays", { recursive: true });
  for (const t of traces) {
    const out: AgentTrace = { ...t, mode: "REPLAY", recorded_from: mode, recorded_at: t.recorded_at };
    writeFileSync(`demo/replays/${t.scenario}.json`, JSON.stringify(out, null, 2) + "\n");
    console.log(`  wrote demo/replays/${t.scenario}.json`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
