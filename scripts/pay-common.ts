/**
 * Shared code for scripts/pay-simulated.ts and scripts/pay-testnet.ts.
 * Plays the role of a paying AI agent: unpaid call → 402 → x402 payment → 200.
 * Never prints private keys.
 */
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import { x402Client, wrapFetchWithPayment, decodePaymentResponseHeader } from "@x402/fetch";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { NETWORK_CAIP2, PAID_ENDPOINTS, type PaidEndpointId } from "../lib/payments/pricing";

export function loadEnv(): void {
  for (const f of [".env.local", ".env"]) {
    try {
      if (existsSync(f)) process.loadEnvFile(f); // does not override variables already set
    } catch {
      /* ignore */
    }
  }
}

export function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

export function baseUrl(): string {
  return (arg("url") ?? process.env.AJEAN_LEDGER_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export function endpointFromArgs(): PaidEndpointId {
  const e = arg("endpoint", "entry")!;
  const map: Record<string, PaidEndpointId> = { entry: "entry", check: "invoice_check", invoice_check: "invoice_check", audit: "audit" };
  if (!map[e]) die(`Unknown --endpoint ${e} (entry | check | audit)`);
  return map[e];
}

export function die(msg: string, code = 1): never {
  console.error(`\n✖ ${msg}`);
  process.exit(code);
}

export function agentAccount() {
  const key = process.env.AGENT_PRIVATE_KEY?.trim();
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
    die("AGENT_PRIVATE_KEY is missing in .env.local. Generate throwaway wallets with: npx tsx scripts/gen-wallets.ts");
  }
  return privateKeyToAccount(key as `0x${string}`);
}

/** Minimal synthetic invoice (fictional companies) used when fixtures/01.json is absent. */
const INLINE_INVOICE = {
  document_type: "invoice",
  number: "FAC-2026-0001",
  issue_date: "2026-11-02",
  due_date: "2026-12-02",
  currency: "EUR",
  supplier: { name: "Bureau Plus SARL (fictional)", siren: "111222337", vat_id: "FR21111222337", country: "FR", address: "1 rue de l'Exemple, 75001 Paris" },
  // = engine DEMO_PROFILE (fictional demo SME whose books are kept)
  customer: { name: "Atelier Lumen SAS (fictional)", siren: "902417351", vat_id: "FR10902417351", country: "FR", address: "2 avenue Fictive, 69001 Lyon" },
  operation_nature: "goods",
  vat_on_debits_option: false,
  lines: [{ description: "Ramettes papier A4 et fournitures de bureau", quantity: 10, unit_price_excl_vat: 10, vat_rate: 0.2, total_excl_vat: 100, kind: "goods" }],
  totals: { total_excl_vat: 100, total_vat: 20, total_incl_vat: 120 },
  payment_terms: "30 jours fin de mois",
  late_payment_penalties: "3 fois le taux d'intérêt légal",
  fixed_recovery_indemnity_mention: true,
};

export function requestBody(endpoint: PaidEndpointId): { body: unknown; source: string } {
  let input: Record<string, unknown> = { format: "json", invoice: INLINE_INVOICE };
  let source = "inline minimal invoice";
  if (existsSync("fixtures/01.json")) {
    try {
      const fx = JSON.parse(readFileSync("fixtures/01.json", "utf8")) as { input?: Record<string, unknown> };
      if (fx.input) {
        input = fx.input;
        source = "fixtures/01.json .input";
      }
    } catch {
      /* fall back to inline */
    }
  }
  if (endpoint === "audit") {
    const invoice = (input as { invoice?: unknown }).invoice ?? INLINE_INVOICE;
    return { body: { items: [{ invoice }] }, source };
  }
  return { body: { input }, source };
}

function h(title: string) {
  console.log(`\n── ${title} ${"─".repeat(Math.max(0, 70 - title.length))}`);
}

export async function health(url: string): Promise<{ mode: string; pay_to: string | null; engine_ready: boolean }> {
  let res: Response;
  try {
    res = await fetch(`${url}/api/health`);
  } catch (e) {
    die(`Cannot reach ${url} (${(e as Error).message}). Start the server first: npm run dev`);
  }
  if (!res.ok) die(`GET /api/health → ${res.status}`);
  const j = (await res.json()) as { payment: { mode: string; pay_to: string | null }; engine_ready: boolean };
  return { mode: j.payment.mode, pay_to: j.payment.pay_to, engine_ready: j.engine_ready };
}

function summarize(body: Record<string, unknown>) {
  const pick: Record<string, unknown> = {};
  for (const k of ["request_id", "receipt", "human_review_required", "confidence", "explanation", "entries_audited"]) {
    if (k in body) pick[k] = body[k];
  }
  const compliance = body.compliance as { status?: string } | undefined;
  if (compliance) pick.compliance_status = compliance.status;
  const entry = body.entry as { journal?: string; lines?: unknown[]; balanced?: boolean } | undefined;
  if (entry) pick.entry = { journal: entry.journal, balanced: entry.balanced, lines: entry.lines };
  const anomalies = body.anomalies as { code: string }[] | undefined;
  if (anomalies) pick.anomalies = anomalies.map((a) => a.code);
  return pick;
}

/** Runs: health → unpaid 402 → paid 200 → idempotent replay → receipt lookup. */
export async function runPaymentDemo(expectedMode: "simulated" | "testnet"): Promise<void> {
  const url = baseUrl();
  const endpointId = endpointFromArgs();
  const endpoint = PAID_ENDPOINTS[endpointId];
  const target = `${url}${endpoint.path}`;
  const { body, source } = requestBody(endpointId);
  const account = agentAccount();

  h("0. Service health");
  const hs = await health(url);
  console.log(`server ${url}  mode=${hs.mode}  payTo=${hs.pay_to}  engine_ready=${hs.engine_ready}`);
  if (hs.mode !== expectedMode) {
    die(
      expectedMode === "testnet"
        ? "The server runs in SIMULATED mode. Restart it with: PAYMENT_MODE=testnet npm run dev"
        : "The server runs in TESTNET mode (real test-USDC payments). Use `npm run pay:testnet`, or restart with PAYMENT_MODE=simulated npm run dev",
      2,
    );
  }
  console.log(`agent wallet ${account.address}  →  ${endpoint.method} ${endpoint.path}  (${endpoint.price_usdc} USDC)  body: ${source}`);

  h("1. Unpaid request");
  const unpaid = await fetch(target, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  console.log(`HTTP ${unpaid.status}`);
  const prHeader = unpaid.headers.get("PAYMENT-REQUIRED");
  if (unpaid.status !== 402 || !prHeader) die(`Expected 402 with a PAYMENT-REQUIRED header, got ${unpaid.status}`);
  console.log("PAYMENT-REQUIRED (decoded):");
  console.log(JSON.stringify(decodePaymentRequiredHeader(prHeader), null, 2));

  h("2. Paid request (x402: sign EIP-3009 authorization, retry with PAYMENT-SIGNATURE)");
  const idemKey = randomUUID();
  const payFetch = wrapFetchWithPayment(fetch, new x402Client().register(NETWORK_CAIP2, new ExactEvmScheme(account)));
  const t0 = Date.now();
  const paid = await payFetch(target, {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": idemKey },
    body: JSON.stringify(body),
  });
  const paidBody = (await paid.json()) as Record<string, unknown>;
  console.log(`HTTP ${paid.status}  (${Date.now() - t0} ms)  Idempotency-Key: ${idemKey}`);
  const prResp = paid.headers.get("PAYMENT-RESPONSE");
  if (prResp) {
    console.log("PAYMENT-RESPONSE (decoded):");
    console.log(JSON.stringify(decodePaymentResponseHeader(prResp), null, 2));
  }
  if (paid.status !== 200) {
    console.log(JSON.stringify(paidBody, null, 2));
    die(`Paid call failed with ${paid.status}. You were NOT charged (settlement only happens on success).`);
  }
  console.log("Result summary:");
  console.log(JSON.stringify(summarize(paidBody), null, 2));
  const receipt = paidBody.receipt as { tx_hash: string; explorer_url: string | null; mode: string };

  h("3. Idempotent replay (same key + body, no payment → not charged again)");
  const replay = await fetch(target, {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": idemKey },
    body: JSON.stringify(body),
  });
  const replayBody = (await replay.json()) as { request_id?: string };
  console.log(`HTTP ${replay.status}  Idempotent-Replay: ${replay.headers.get("Idempotent-Replay")}  same request_id: ${replayBody.request_id === paidBody.request_id}`);

  h("4. Free receipt lookup");
  const rec = await fetch(`${url}/api/v1/receipts/${paidBody.request_id}`);
  console.log(`GET /api/v1/receipts/${paidBody.request_id} → HTTP ${rec.status}`);

  h("Done");
  console.log(`mode: ${receipt.mode.toUpperCase()}   tx: ${receipt.tx_hash}`);
  console.log(receipt.explorer_url ? `explorer: ${receipt.explorer_url}` : "explorer: n/a (SIMULATED — no on-chain transaction)");
}
