/**
 * npm run agent: the "SME purchasing agent" of Atelier Lumenor SAS (fictional) processes its inbox.
 *
 *   npm run agent                          # every inbox/*.json once, sorted, against AJEAN_LEDGER_URL
 *   npm run agent -- --only 03             # one item (comma-separated ids)
 *   npm run agent -- --max-per-call 1.00   # let the 1.00 USDC audit request through the policy
 *   npm run agent -- --llm                 # Claude decides the order of actions (needs ANTHROPIC_API_KEY)
 *   npm run agent -- --watch               # keep watching inbox/ for new files
 *   flags: --url <base> --daily-budget <usdc> --keep-erp --reset-budget --json
 *
 * Mock ERP: data/erp.local.json (reset at each run unless --keep-erp).
 * Daily spend: data/agent-spend.local.json (kept across runs, per UTC day; --reset-budget clears it).
 * Never prints private keys.
 */
import { existsSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { atomicToUsdc } from "../lib/payments/pricing";
import type { TraceStep } from "../lib/trace/types";
import { runAgent } from "./core";
import { FileErp } from "./erp";
import { loadInbox } from "./inbox";
import { FileSpendLedger, policyFromEnv } from "./policy";
import type { AgentTrace, InboxItem } from "./types";

// ---------------------------------------------------------------------------
// args / env
// ---------------------------------------------------------------------------

for (const f of [".env.local", ".env"]) {
  try {
    if (existsSync(f)) process.loadEnvFile(f); // does not override variables already set
  } catch {
    /* ignore */
  }
}
const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const arg = (n: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = c("1");
const dim = c("2");
const red = c("31");
const green = c("32");
const yellow = c("33");
const blue = c("34");
const magenta = c("35");
const cyan = c("36");

const KIND_TAG: Record<TraceStep["kind"], string> = {
  reasoning: magenta("THINK   "),
  discovery: cyan("DISCOVER"),
  policy: yellow("POLICY  "),
  http_request: blue("HTTP  ->"),
  http_response: blue("HTTP <- "),
  payment: green("PAY     "),
  settlement: green("SETTLE  "),
  erp: cyan("ERP     "),
  review: yellow("REVIEW  "),
  error: red("ERROR   "),
};

function wrap(text: string, indent: string, width = 100): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > width - indent.length) {
      lines.push(cur.trim());
      cur = w;
    } else cur += ` ${w}`;
  }
  if (cur.trim()) lines.push(cur.trim());
  return lines.map((l) => indent + l).join("\n");
}

const short = (h: unknown, n = 10) => (typeof h === "string" && h.length > n + 6 ? `${h.slice(0, n)}…${h.slice(-4)}` : String(h ?? "?"));

function printStep(s: TraceStep, i: number) {
  const ind = "              ";
  const num = String(i + 1).padStart(2, " ");
  const t = dim(`${(s.t_ms / 1000).toFixed(2)}s`.padStart(6));
  const title = s.kind === "error" ? red(s.title) : s.kind === "review" ? yellow(s.title) : bold(s.title);
  console.log(` ${num}. ${KIND_TAG[s.kind]} ${title} ${t}`);
  const h = s.http;
  if (h) {
    const status = h.status ? (h.status >= 400 && h.status !== 402 ? red(String(h.status)) : h.status === 402 ? yellow("402") : green(String(h.status))) : "";
    console.log(dim(`${ind}${h.method} ${h.url}`) + (status ? `  -> ${status}` : ""));
    for (const [k, v] of Object.entries(h.headers)) {
      if (k === "content-type" || k === "accept") continue;
      console.log(dim(`${ind}  ${k}: ${v.length > 70 ? `${v.slice(0, 70)}…` : v}`));
    }
    const dec = h.decoded?.value as Record<string, unknown> | undefined;
    if (h.decoded?.header === "PAYMENT-REQUIRED" && dec) {
      const a = ((dec.accepts as Record<string, unknown>[] | undefined) ?? [])[0] ?? {};
      console.log(
        `${ind}${yellow("requirements")}: ${a.scheme} | ${a.network} | amount ${a.amount} (= ${typeof a.amount === "string" ? atomicToUsdc(a.amount) : "?"} USDC) | asset ${short(a.asset)} | payTo ${short(a.payTo)} | timeout ${a.maxTimeoutSeconds}s`,
      );
    }
    if (h.decoded?.header === "PAYMENT-RESPONSE" && dec) {
      console.log(`${ind}${green("settlement")}: success=${dec.success} tx=${short(dec.transaction, 14)} payer=${short(dec.payer)}`);
    }
  }
  if (s.detail) console.log(dim(wrap(s.detail, ind)));
  const d = s.data ?? {};
  if (s.kind === "http_response" && Array.isArray(d.requirements_check)) {
    const checks = d.requirements_check as { check: string; ok: boolean }[];
    console.log(`${ind}checked vs discovery: ${checks.map((x) => (x.ok ? green(`${x.check} ok`) : red(`${x.check} MISMATCH`))).join(", ")}`);
  }
  if (s.kind === "payment") console.log(`${ind}from ${short(d.from)} to ${short(d.to)} value ${d.value} nonce ${short(d.nonce, 12)}`);
  if (s.kind === "settlement") {
    console.log(`${ind}tx ${green(String(d.tx_hash))}`);
    console.log(`${ind}${d.explorer_url ? `explorer ${cyan(String(d.explorer_url))}` : dim("explorer: n/a (SIMULATED, no on-chain transaction)")}`);
  }
  if (s.kind === "erp" && Array.isArray(d.lines)) {
    for (const l of d.lines as { account: string; label: string; debit: number; credit: number }[]) {
      console.log(`${ind}${l.account.padEnd(11)} ${l.label.slice(0, 42).padEnd(42)} ${l.debit ? l.debit.toFixed(2).padStart(10) : "".padStart(10)} ${l.credit ? l.credit.toFixed(2).padStart(10) : "".padStart(10)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function serverMode(url: string): Promise<"testnet" | "simulated" | null> {
  try {
    const r = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(5000) });
    const j = (await r.json()) as { payment?: { mode?: string } };
    return j.payment?.mode === "testnet" ? "testnet" : j.payment?.mode === "simulated" ? "simulated" : null;
  } catch {
    return null;
  }
}

async function main() {
  const url = (arg("url") ?? process.env.AJEAN_LEDGER_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const policy = policyFromEnv({ max_per_call_usdc: arg("max-per-call"), daily_budget_usdc: arg("daily-budget") });
  const reasoning = flag("llm") ? "llm" : "scripted";
  const only = arg("only")?.split(",").map((s) => s.trim());

  const mode = await serverMode(url);
  if (!mode) {
    console.error(red(`\nCannot reach Ajean Ledger at ${url} (GET /api/health). Start it (npm run dev) or pass --url / AJEAN_LEDGER_URL.`));
    process.exit(1);
  }

  let wallet: PrivateKeyAccount;
  let walletNote: string | undefined;
  const key = process.env.AGENT_PRIVATE_KEY?.trim();
  if (key && /^0x[0-9a-fA-F]{64}$/.test(key)) wallet = privateKeyToAccount(key as `0x${string}`);
  else if (mode === "simulated") {
    wallet = privateKeyToAccount(generatePrivateKey());
    walletNote = "AGENT_PRIVATE_KEY not set: ephemeral wallet generated for this run (SIMULATED only)";
  } else {
    console.error(red("\nAGENT_PRIVATE_KEY is missing in .env.local (needed for TESTNET payments). Generate wallets: npx tsx scripts/gen-wallets.ts"));
    process.exit(1);
  }

  const erp = new FileErp();
  if (!flag("keep-erp")) erp.reset();
  const ledger = new FileSpendLedger();
  if (flag("reset-budget")) ledger.reset();

  console.log(bold(`\nAtelier Lumenor purchasing agent (fictional SME)  ->  Ajean Ledger`));
  console.log(
    dim(
      `service ${url}  mode ${mode === "testnet" ? "TESTNET" : "SIMULATED"}  wallet ${wallet.address}${walletNote ? " (ephemeral)" : ""}\n` +
        `policy: max ${policy.max_per_call_usdc} USDC/call, daily budget ${policy.daily_budget_usdc} USDC  reasoning: ${reasoning}${reasoning === "llm" && !process.env.ANTHROPIC_API_KEY ? " (no ANTHROPIC_API_KEY -> scripted)" : ""}\n` +
        `ERP ${erp.label}${flag("keep-erp") ? "" : " (reset)"}  spend ledger ${ledger.label}`,
    ),
  );

  const traces: AgentTrace[] = [];
  const done = new Set<string>();
  const process1 = async (item: InboxItem, i: number, n: number) => {
    done.add(item.file);
    console.log(`\n${bold(cyan(`━━ [${i}/${n}] ${item.file}`))} ${dim(`${item.subject ?? ""}`)}`);
    const trace = await runAgent({ serviceUrl: url, item, mode, wallet, walletNote, policy, ledger, erp, reasoning, onStep: printStep });
    traces.push(trace);
    const col = trace.outcome === "posted" ? green : trace.outcome === "error" ? red : yellow;
    console.log(`    ${dim("outcome")} ${col(trace.outcome.toUpperCase())} ${dim(`in ${trace.duration_ms} ms`)}`);
  };

  const pick = (items: InboxItem[]) => items.filter((it) => !done.has(it.file) && (!only || only.includes(it.id)));
  const items = pick(loadInbox());
  if (!items.length) console.log(yellow("\nInbox is empty (inbox/*.json)."));
  let k = 0;
  for (const it of items) await process1(it, ++k, items.length);

  await summary(traces, ledger, erp);
  if (flag("json")) console.log(JSON.stringify(traces, null, 2));

  if (flag("watch")) {
    console.log(dim("\nWatching inbox/ for new files (Ctrl+C to stop)…"));
    for (;;) {
      await new Promise((r) => setTimeout(r, 2000));
      const fresh = pick(loadInbox());
      let j = 0;
      for (const it of fresh) await process1(it, ++j, fresh.length);
      if (fresh.length) await summary(traces, ledger, erp);
    }
  }
}

async function summary(traces: AgentTrace[], ledger: FileSpendLedger, erp: FileErp) {
  const spentRun = traces.reduce((s, t) => {
    const st = t.steps.find((x) => x.kind === "settlement");
    return s + (st?.data?.amount_usdc ? Number(st.data.amount_usdc) : 0);
  }, 0);
  const entries = await erp.list();
  const posted = entries.filter((e) => e.status !== "draft").length;
  const drafts = entries.filter((e) => e.status === "draft").length;
  const review = traces.filter((t) => t.outcome === "posted_with_review" || t.outcome === "refused_by_policy");
  const refused = traces.filter((t) => t.outcome === "refused_by_policy").length;
  const errors = traces.filter((t) => t.outcome === "error").length;
  console.log(`\n${bold("━━ Summary")}`);
  console.log(`  items processed      ${traces.length}`);
  console.log(`  USDC spent (run)     ${spentRun.toFixed(2)}   spent today ${atomicToUsdc(await ledger.spentTodayAtomic())}`);
  console.log(`  entries in ERP       ${posted} posted${drafts ? `, ${drafts} draft` : ""}  (${erp.label})`);
  console.log(`  refused by policy    ${refused}`);
  if (errors) console.log(red(`  errors               ${errors}`));
  console.log(`  human review         ${review.length}`);
  for (const t of review) {
    const r = [...t.steps].reverse().find((s) => s.kind === "review");
    console.log(yellow(`    - ${t.scenario}: ${r?.title ?? t.outcome}`));
  }
}

main().catch((e) => {
  console.error(red(`\nagent crashed: ${e instanceof Error ? e.message : String(e)}`));
  process.exit(1);
});
