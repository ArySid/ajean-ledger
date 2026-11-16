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
 *          --public-url [base]  rewrite the recorded base URL (e.g. http://localhost:3600) to the public
 *                               service URL in every string of the traces, including base64 x402 headers.
 *                               Value: the flag argument, else env PUBLIC_URL, else DEFAULT_PUBLIC_URL.
 *                               Also applied when PUBLIC_URL is set without the flag.
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

export const DEFAULT_PUBLIC_URL = "https://ajean-ledger.ary-sidoun.workers.dev";

/** Public URL to show in the replays, or null to keep the recorded one. */
function publicUrlOption(): string | null {
  const i = argv.indexOf("--public-url");
  if (i >= 0) {
    const v = argv[i + 1];
    return (v && !v.startsWith("--") ? v : process.env.PUBLIC_URL?.trim() || DEFAULT_PUBLIC_URL).replace(/\/$/, "");
  }
  return process.env.PUBLIC_URL?.trim() ? process.env.PUBLIC_URL.trim().replace(/\/$/, "") : null;
}

const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Replace `from` by `to` in every string of a JSON value, including base64-encoded JSON (x402 headers). */
export function rewriteBaseUrl<T>(value: T, from: string, to: string): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      if (v.includes(from)) return v.split(from).join(to);
      if (v.length >= 24 && v.length % 4 === 0 && B64.test(v)) {
        try {
          const decoded = Buffer.from(v, "base64").toString("utf8");
          if (decoded.includes(from) && Buffer.from(decoded, "utf8").toString("base64") === v) {
            return Buffer.from(decoded.split(from).join(to), "utf8").toString("base64");
          }
        } catch {
          /* not base64 text */
        }
      }
      return v;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}

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
  const publicUrl = publicUrlOption();
  if (publicUrl && publicUrl !== url) console.log(`  rewriting ${url} -> ${publicUrl} in the traces`);
  for (const t of traces) {
    const rec: AgentTrace = { ...t, mode: "REPLAY", recorded_from: mode, recorded_at: t.recorded_at };
    const out = publicUrl && publicUrl !== url ? rewriteBaseUrl(rec, url, publicUrl) : rec;
    writeFileSync(`demo/replays/${t.scenario}.json`, JSON.stringify(out, null, 2) + "\n");
    console.log(`  wrote demo/replays/${t.scenario}.json`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
