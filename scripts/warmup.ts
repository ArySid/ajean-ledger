/**
 * npm run warmup [-- --url <base>] [--pay] [--expect-mode testnet|simulated] [--timeout 45000]
 *
 * Day-J check of the PUBLIC deployment. Default URL: --url, else env PUBLIC_URL, else the public
 * Cloudflare Workers demo https://ajean-ledger.ary-sidoun.workers.dev. Run it the evening before and
 * ~1 h before presenting (deliverables/DEMO_SCRIPT.md). Hits every page/endpoint the demo needs, warms
 * the Worker isolates, prints a green/red table with latencies and a final "READY FOR DEMO" or
 * "NOT READY" banner. Exits non-zero if any check fails.
 *
 * Paid endpoint (POST /api/v1/entry):
 *  - always: unpaid call → expect 402 + PAYMENT-REQUIRED (x402 v2).
 *  - deployment in SIMULATED mode: pay with a fresh EPHEMERAL key (generated in memory, never printed,
 *    no funds needed) via @x402/fetch + ExactEvmScheme → expect 200 + receipt; then the free receipt lookup.
 *  - deployment in TESTNET mode: stops at the 402 unless `--pay` is given AND AGENT_PRIVATE_KEY is set
 *    (env or .env.local) — that spends 0.15 test USDC on Base Sepolia.
 * Demo run (POST /api/demo/run, scenario 03 = the live demo): always in SIMULATED; in TESTNET only with
 * `--pay`, because the server-side agent then pays 0.15 test USDC from the Worker's AGENT_PRIVATE_KEY.
 * The recorded REPLAY of 03 (the console's fallback) is always checked.
 * --expect-mode fails the run if the deployment is not in that payment mode (e.g. testnet on Day J).
 * Never prints private keys. Stays far below the rate limits (see lib/api/rate-limit.ts).
 */
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { NETWORK_CAIP2, PAID_ENDPOINTS } from "../lib/payments/pricing";

for (const f of [".env.local", ".env"]) {
  try {
    if (existsSync(f)) process.loadEnvFile(f); // never overrides variables already set
  } catch {
    /* ignore */
  }
}

const argv = process.argv.slice(2);
const arg = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
export const DEFAULT_PUBLIC_URL = "https://ajean-ledger.ary-sidoun.workers.dev";
const BASE = (arg("url") ?? (process.env.PUBLIC_URL?.trim() || DEFAULT_PUBLIC_URL)).replace(/\/$/, "");
const PAY = argv.includes("--pay");
const EXPECT_MODE = arg("expect-mode");
const TIMEOUT = Number(arg("timeout") ?? 45_000);
const tty = process.stdout.isTTY;
const green = (s: string) => (tty ? `\x1b[32m${s}\x1b[0m` : s);
const red = (s: string) => (tty ? `\x1b[31m${s}\x1b[0m` : s);
const grey = (s: string) => (tty ? `\x1b[90m${s}\x1b[0m` : s);

type Row = { name: string; ok: boolean | null; status: string; ms: number; note: string };
const rows: Row[] = [];

async function timed<T>(fn: () => Promise<T>): Promise<{ v?: T; err?: Error; ms: number }> {
  const t0 = performance.now();
  try {
    const v = await fn();
    return { v, ms: Math.round(performance.now() - t0) };
  } catch (e) {
    return { err: e instanceof Error ? e : new Error(String(e)), ms: Math.round(performance.now() - t0) };
  }
}

const sig = () => AbortSignal.timeout(TIMEOUT);

async function check(
  name: string,
  path: string,
  init: RequestInit & { expect?: number; validate?: (res: Response, text: string) => string | true } = {},
): Promise<{ res?: Response; text?: string }> {
  const { expect = 200, validate, ...req } = init;
  const r = await timed(async () => {
    const res = await fetch(`${BASE}${path}`, { redirect: "follow", ...req, signal: sig() });
    return { res, text: await res.text() };
  });
  if (r.err || !r.v) {
    rows.push({ name, ok: false, status: "ERR", ms: r.ms, note: r.err?.message ?? "no response" });
    return {};
  }
  const { res, text } = r.v;
  let ok = res.status === expect;
  let note = ok ? "" : `expected ${expect}: ${text.slice(0, 120).replace(/\s+/g, " ")}`;
  if (ok && validate) {
    const v = validate(res, text);
    if (v !== true) {
      ok = false;
      note = v;
    }
  }
  rows.push({ name, ok, status: String(res.status), ms: r.ms, note });
  return { res, text };
}

const json = (text: string): Record<string, unknown> | null => {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
};
const isJson = (_r: Response, t: string): string | true => (json(t) ? true : "body is not JSON");

/** Minimal synthetic invoice (fictional companies), same as scripts/pay-common.ts. */
const INVOICE = {
  document_type: "invoice",
  number: "FAC-2026-WARMUP",
  issue_date: "2026-11-02",
  due_date: "2026-12-02",
  currency: "EUR",
  supplier: { name: "Buro Velours SARL (fictional)", siren: "000001016", vat_id: "FR53000001016", country: "FR", address: "1 rue de l'Exemple, 75001 Paris" },
  customer: { name: "Atelier Lumenor SAS (fictional)", siren: "000001008", vat_id: "FR29000001008", country: "FR", address: "2 avenue Fictive, 69001 Lyon" },
  operation_nature: "goods",
  vat_on_debits_option: false,
  lines: [{ description: "Ramettes papier A4 et fournitures de bureau", quantity: 10, unit_price_excl_vat: 10, vat_rate: 0.2, total_excl_vat: 100, kind: "goods" }],
  totals: { total_excl_vat: 100, total_vat: 20, total_incl_vat: 120 },
  payment_terms: "30 jours fin de mois",
  late_payment_penalties: "3 fois le taux d'intérêt légal",
  fixed_recovery_indemnity_mention: true,
};

async function main() {
  console.log(`Ajean Ledger warmup → ${BASE}\n`);

  // Free pages and discovery
  const health = await check("GET /api/health", "/api/health", { validate: isJson });
  const h = health.text ? json(health.text) : null;
  const payment = (h?.payment ?? {}) as { mode?: string; pay_to?: string };
  const mode = payment.mode ?? "unknown";
  if (h) rows[rows.length - 1].note = `mode=${mode} store=${(h.store as { kind?: string })?.kind ?? "?"} engine_ready=${h.engine_ready}`;
  if (EXPECT_MODE) {
    rows.push({
      name: `payment mode = ${EXPECT_MODE}`,
      ok: mode === EXPECT_MODE,
      status: "-",
      ms: 0,
      note: mode === EXPECT_MODE ? "" : `deployment runs ${mode} (vars.PAYMENT_MODE in wrangler.embedded.jsonc, then redeploy)`,
    });
  }

  await check("GET /", "/", { validate: (_r, t) => (t.includes("Ajean") ? true : "page does not mention Ajean") });
  await check("GET /live", "/live");
  await check("GET /operator", "/operator");
  await check("GET /api/v1/catalog", "/api/v1/catalog", { validate: isJson });
  await check("GET /llms.txt", "/llms.txt", { validate: (_r, t) => (t.length > 50 ? true : "empty") });
  await check("GET /openapi.json", "/openapi.json", { validate: isJson });
  await check("GET /.well-known/agent.json", "/.well-known/agent.json", { validate: isJson });
  const stats = await check("GET /api/v1/operator/stats", "/api/v1/operator/stats", { validate: isJson });
  const st = stats.text ? json(stats.text) : null;
  if (st && rows[rows.length - 1].ok) rows[rows.length - 1].note = `store=${st.store ?? st.source ?? "?"} calls=${st.calls_served ?? st.calls ?? "?"}`;

  // Paid endpoint: unpaid → 402
  const entry = PAID_ENDPOINTS.entry;
  const body = JSON.stringify({ input: { format: "json", invoice: INVOICE } });
  await check(`POST ${entry.path} (unpaid)`, entry.path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    expect: 402,
    validate: (res) => {
      const hdr = res.headers.get("PAYMENT-REQUIRED");
      if (!hdr) return "no PAYMENT-REQUIRED header";
      const a = decodePaymentRequiredHeader(hdr).accepts[0];
      if (a?.amount !== entry.price_atomic || a?.network !== NETWORK_CAIP2) return `unexpected accepts[0] ${JSON.stringify(a)}`;
      return true;
    },
  });
  rows[rows.length - 1].note ||= `${entry.price_usdc} USDC, ${NETWORK_CAIP2}`;
  // Warm the other paid routes too (unpaid → 402, never charged)
  for (const e of [PAID_ENDPOINTS.invoice_check, PAID_ENDPOINTS.audit]) {
    await check(`POST ${e.path} (unpaid)`, e.path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      expect: 402,
      validate: (res) => (res.headers.get("PAYMENT-REQUIRED") ? true : "no PAYMENT-REQUIRED header"),
    });
  }

  // Paid endpoint: pay
  let key: `0x${string}` | null = null;
  let keyLabel = "";
  if (mode === "simulated") {
    key = generatePrivateKey();
    keyLabel = "ephemeral key (simulated)";
  } else if (mode === "testnet" && PAY) {
    const k = process.env.AGENT_PRIVATE_KEY?.trim();
    if (k && /^0x[0-9a-fA-F]{64}$/.test(k)) {
      key = k as `0x${string}`;
      keyLabel = "AGENT_PRIVATE_KEY (testnet, 0.15 test USDC)";
    } else rows.push({ name: `POST ${entry.path} (paid)`, ok: false, status: "-", ms: 0, note: "--pay given but AGENT_PRIVATE_KEY missing/invalid" });
  } else {
    rows.push({ name: `POST ${entry.path} (paid)`, ok: null, status: "skip", ms: 0, note: `mode=${mode}: add --pay to spend 0.15 test USDC` });
  }
  if (key) {
    const account = privateKeyToAccount(key);
    const payFetch = wrapFetchWithPayment(fetch, new x402Client().register(NETWORK_CAIP2, new ExactEvmScheme(account)));
    const r = await timed(async () => {
      const res = await payFetch(`${BASE}${entry.path}`, {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": randomUUID() },
        body,
        signal: sig(),
      });
      return { res, text: await res.text() };
    });
    let requestId: string | undefined;
    if (r.v) {
      const j = json(r.v.text);
      const receipt = j?.receipt as { tx_hash?: string; mode?: string } | undefined;
      const ok = r.v.res.status === 200 && !!receipt?.tx_hash && !!r.v.res.headers.get("PAYMENT-RESPONSE");
      requestId = j?.request_id as string | undefined;
      rows.push({
        name: `POST ${entry.path} (paid)`,
        ok,
        status: String(r.v.res.status),
        ms: r.ms,
        note: ok ? `${keyLabel}; tx ${receipt!.tx_hash!.slice(0, 12)}… mode=${receipt!.mode}` : r.v.text.slice(0, 140).replace(/\s+/g, " "),
      });
    } else rows.push({ name: `POST ${entry.path} (paid)`, ok: false, status: "ERR", ms: r.ms, note: r.err?.message ?? "" });
    if (requestId) await check("GET /api/v1/receipts/{id}", `/api/v1/receipts/${requestId}`, { validate: isJson });
  }

  // Demo agent run (scenario 03 = the live demo). In TESTNET the server-side agent spends real test USDC.
  if (mode === "simulated" || (mode === "testnet" && PAY)) {
    let summary = "";
    await check("POST /api/demo/run (03)", "/api/demo/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenario: "03", mode }),
      validate: (_r, t) => {
        const j = json(t);
        const trace = (j?.trace ?? j) as { outcome?: string; mode?: string; steps?: { kind?: string; title?: string; detail?: string }[]; result?: { receipt?: { tx_hash?: string } } } | null;
        if (!trace || !Array.isArray(trace.steps)) return "not an AgentTrace";
        if (trace.outcome === "error") {
          const e = trace.steps.find((s) => s.kind === "error");
          return `trace outcome=error${e ? `: ${e.title}${e.detail ? ` (${e.detail.slice(0, 100)})` : ""}` : ""} → the console would fall back to REPLAY`;
        }
        if (trace.outcome !== "posted_with_review") return `unexpected outcome ${trace.outcome} (expected posted_with_review)`;
        summary = `outcome=${trace.outcome} mode=${trace.mode}${trace.result?.receipt?.tx_hash ? ` tx ${trace.result.receipt.tx_hash.slice(0, 12)}…` : ""}`;
        return true;
      },
    });
    if (summary) rows[rows.length - 1].note = summary;
  } else {
    rows.push({ name: "POST /api/demo/run (03)", ok: null, status: "skip", ms: 0, note: `mode=${mode}: add --pay (the agent pays 0.15 test USDC from the Worker's wallet)` });
  }
  // The console's fallback: the recorded run of scenario 03.
  await check("GET /api/demo/replays?scenario=03", "/api/demo/replays?scenario=03", {
    validate: (_r, t) => {
      const j = json(t);
      const trace = (j?.trace ?? j) as { steps?: unknown[]; recorded_from?: string } | null;
      return trace && Array.isArray(trace.steps) && trace.steps.length > 0 ? true : "no recorded trace";
    },
  });

  // Report
  const w = Math.max(...rows.map((r) => r.name.length));
  console.log(`${"check".padEnd(w)}  result  http   ms     note`);
  console.log("-".repeat(w + 40));
  for (const r of rows) {
    const res = r.ok === null ? grey("SKIP  ") : r.ok ? green("OK    ") : red("FAIL  ");
    console.log(`${r.name.padEnd(w)}  ${res}  ${r.status.padEnd(5)}  ${String(r.ms).padStart(5)}  ${r.note}`);
  }
  const failed = rows.filter((r) => r.ok === false).length;
  const passed = rows.filter((r) => r.ok === true).length;
  const skipped = rows.filter((r) => r.ok === null).length;
  const bar = "═".repeat(72);
  console.log("");
  if (failed) {
    console.log(red(bar));
    console.log(red(`  ✖ NOT READY — ${failed} check(s) failed  (${passed} passed${skipped ? `, ${skipped} skipped` : ""}; mode=${mode}; ${BASE})`));
    console.log(red("  Fix it now, or start the demo on REPLAY (/live → \"Replay recorded run\") and tell the narrator."));
    console.log(red(bar));
  } else {
    console.log(green(bar));
    console.log(green(`  ✔ READY FOR DEMO — ${passed} checks passed${skipped ? `, ${skipped} skipped` : ""}  (mode=${mode.toUpperCase()}; ${BASE})`));
    if (skipped) console.log(grey("  Skipped checks need --pay (spends test USDC in TESTNET mode)."));
    console.log(green(bar));
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(red(e instanceof Error ? e.message : String(e)));
  process.exit(1);
});
