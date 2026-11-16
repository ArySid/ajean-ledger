/**
 * Phase 6 bonuses: EURC as a second accepted stablecoin (ADR-024) and prepaid credit packs (ADR-025).
 * End to end through the real route handlers, x402 SDK on both sides, simulated facilitator, mocked engine.
 */
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { x402Client } from "@x402/core/client";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment } from "@x402/fetch";

const engine = vi.hoisted(() => {
  class EngineError extends Error {
    constructor(
      public code: string,
      message: string,
      public details?: unknown,
    ) {
      super(message);
      this.name = "EngineError";
    }
  }
  const entryResult = {
    invoice: { document_type: "invoice", number: "F-2026-001", date: "2026-11-02", supplier: { name: "Bureau Plus (fictional)", siren: "000001016", country: "FR" }, totals: { total_excl_vat: 100, total_vat: 20, total_incl_vat: 120 } },
    compliance: { status: "compliant", checks: [] },
    entry: { journal: "HA", lines: [{ account: "6064", debit: 100, credit: 0 }, { account: "44566", debit: 20, credit: 0 }, { account: "401BURO", debit: 0, credit: 120 }], balanced: true },
    anomalies: [],
    human_review_required: false,
    explanation: "mock",
  };
  return {
    EngineError,
    entryResult,
    createEntry: vi.fn(async (..._args: unknown[]) => entryResult),
    checkInvoice: vi.fn(async (..._args: unknown[]) => ({ ...entryResult, kind: "check" })),
    auditEntries: vi.fn(async (items: unknown[]) => ({ entries_audited: items.length, kind: "audit" })),
  };
});

vi.mock("@x402/next", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(import.meta.url)("@x402/next");
});

vi.mock("@/engine", () => ({
  EngineError: engine.EngineError,
  createEntry: engine.createEntry,
  checkInvoice: engine.checkInvoice,
  auditEntries: engine.auditEntries,
  DEMO_PROFILE: { name: "Atelier Lumenor SAS (fictional)", siren: "000001008", activity: "commercial", accounting_basis: "accrual", vat_regime: "standard" },
}));

import { POST as entryPOST } from "@/app/api/v1/entry/route";
import { POST as checkPOST } from "@/app/api/v1/invoice/check/route";
import { POST as auditPOST } from "@/app/api/v1/audit/route";
import { POST as creditsPOST } from "@/app/api/v1/credits/route";
import { GET as balanceGET } from "@/app/api/v1/credits/balance/route";
import { GET as receiptGET } from "@/app/api/v1/receipts/[id]/route";
import { GET as operatorStatsGET } from "@/app/api/v1/operator/stats/route";
import { GET as healthGET } from "@/app/api/health/route";
import { resetRateLimit } from "@/lib/api/rate-limit";
import { CREDIT_TOKEN_RE, hashCreditToken, deriveCreditToken, withCreditLock } from "@/lib/payments/credits";
import {
  CREDIT_PACKS,
  EURC,
  FX_DEMO,
  PAID_ENDPOINT_LIST,
  USDC,
  assetByAddress,
  assetPrices,
  usdcAtomicToEurcAtomic,
  usdcEquivalentAtomic,
} from "@/lib/payments/pricing";
import { buildCreditReceipt, buildReceipt } from "@/lib/payments/receipt";
import { resetSimulatedFacilitator } from "@/lib/payments/simulated-facilitator";
import { buildCatalog } from "@/lib/discovery/catalog";
import { buildOpenApi } from "@/lib/discovery/openapi";
import { buildLlmsTxt } from "@/lib/discovery/llms";
import { buildAgentCard } from "@/lib/discovery/agent-card";
import { PaymentRequiredSchema, ReceiptSchema, CreditPurchaseResponseSchema, CreditBalanceSchema } from "@/lib/discovery/schemas";
import { getStore, setStoreForTests, MemoryStore, type CreditAccount, type ReceiptRecord } from "@/lib/store";
import { CloudflareKVStore, type KVNamespaceLike } from "@/lib/store/cloudflare-kv";
import { FileStore } from "@/lib/store/file";
import { countersFromRecords, parseCounterKey } from "@/lib/store/stats";
import { SpendingPolicy } from "@/mcp/policy";

const BASE = "http://localhost:3000";
const PAY_TO = privateKeyToAccount(generatePrivateKey()).address;
const agent = privateKeyToAccount(generatePrivateKey());
const invoiceBody = { input: { format: "json", invoice: { number: "F-2026-001", lines: [] } } };
const NET = "eip155:84532";

type Handler = (req: NextRequest) => Promise<Response>;
const routes: Record<string, Handler> = {
  "/api/v1/entry": entryPOST,
  "/api/v1/invoice/check": checkPOST,
  "/api/v1/audit": auditPOST,
  "/api/v1/credits": creditsPOST,
  "/api/v1/credits/balance": balanceGET,
};
const inProcessFetch: typeof fetch = async (input, init) => {
  const req = new NextRequest(input instanceof Request ? input : new Request(input, init));
  return routes[req.nextUrl.pathname](req);
};

/** Default SDK client: pays accepts[0] = USDC, $1 cap. */
const usdcFetch = wrapFetchWithPayment(inProcessFetch, new x402Client().register(NET, new ExactEvmScheme(agent)));
/** Client preferring EURC: allow the (non-default) asset and select its requirement. */
const eurcFetch = wrapFetchWithPayment(
  inProcessFetch,
  x402Client.fromConfig({
    schemes: [{ network: NET, client: new ExactEvmScheme(agent) }],
    spendControls: { allowedAssets: [{ network: NET, asset: EURC.address, maxAmountPerPayment: "20000000" }], maxAmountPerPayment: "$10" },
    paymentRequirementsSelector: (_v, reqs) => reqs.find((r) => r.asset.toLowerCase() === EURC.address.toLowerCase()) ?? reqs[0],
  }),
);
/** USDC client allowed to pay the 10 USDC pro pack. */
const usdcFetch10 = wrapFetchWithPayment(inProcessFetch, x402Client.fromConfig({ schemes: [{ network: NET, client: new ExactEvmScheme(agent) }], spendControls: { maxAmountPerPayment: "$10" } }));

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return inProcessFetch(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}
function balance(token: string) {
  return inProcessFetch(`${BASE}/api/v1/credits/balance`, { headers: { "X-Credit-Token": token } });
}
async function buyPack(pack: "starter" | "pro" = "starter", fetchImpl: typeof fetch = usdcFetch, idemKey?: string) {
  const res = await fetchImpl(`${BASE}/api/v1/credits`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(idemKey ? { "Idempotency-Key": idemKey } : {}) },
    body: JSON.stringify({ pack }),
  });
  return { res, body: await res.json() };
}

const savedEnv = { ...process.env };
beforeAll(() => {
  process.env.PAYMENT_MODE = "simulated";
  process.env.SERVICE_PAY_TO_ADDRESS = PAY_TO;
  process.env.STORE_KIND = "memory";
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.CREDIT_TOKEN_SECRET;
});
afterAll(() => {
  process.env = { ...savedEnv };
});
beforeEach(() => {
  setStoreForTests(new MemoryStore());
  resetSimulatedFacilitator();
  resetRateLimit();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// EURC (ADR-024)
// ---------------------------------------------------------------------------

describe("EURC pricing (single config, fixed demo rate)", () => {
  it("derives EURC prices from the USDC prices at 1 EURC = 1.08 USDC, half-up to the cent", () => {
    expect(FX_DEMO.usdc_per_eurc).toBe("1.08");
    expect(usdcAtomicToEurcAtomic("150000")).toBe("140000"); // 0.1389 → 0.14
    expect(usdcAtomicToEurcAtomic("50000")).toBe("50000"); // 0.0463 → 0.05
    expect(usdcAtomicToEurcAtomic("1000000")).toBe("930000"); // 0.9259 → 0.93
    expect(usdcAtomicToEurcAtomic("10000000")).toBe("9260000"); // 9.259 → 9.26
    expect(assetPrices("150000")).toEqual([
      { asset: "USDC", amount: "0.15", amount_atomic: "150000", address: USDC.address },
      { asset: "EURC", amount: "0.14", amount_atomic: "140000", address: EURC.address },
    ]);
    expect(usdcEquivalentAtomic("EURC", "140000")).toBe(151200n);
    expect(usdcEquivalentAtomic("USDC", "150000")).toBe(150000n);
    expect(assetByAddress(EURC.address.toLowerCase())?.symbol).toBe("EURC");
    expect(assetByAddress("0x0000000000000000000000000000000000000001")).toBeNull();
    expect(EURC.eip712).toEqual({ name: "EURC", version: "2" });
  });

  it("receipts carry the asset actually paid", () => {
    const settle = { success: true, transaction: "0x5151" + "a".repeat(60), network: NET as `${string}:${string}`, amount: "140000" };
    expect(buildReceipt({ endpoint: "entry", settle, payTo: PAY_TO, mode: "simulated", assetAddress: EURC.address })).toMatchObject({
      method: "x402",
      amount: "0.14",
      amount_atomic: "140000",
      asset: "EURC",
      asset_address: EURC.address,
    });
    const noAmount = { ...settle, amount: undefined };
    expect(buildReceipt({ endpoint: "audit", settle: noAmount, payTo: PAY_TO, mode: "simulated", assetAddress: EURC.address }).amount).toBe("0.93");
    expect(buildReceipt({ endpoint: "entry", settle: noAmount, payTo: PAY_TO, mode: "simulated" })).toMatchObject({ asset: "USDC", amount: "0.15" });
  });
});

describe("EURC payments (simulated facilitator)", () => {
  it("every paid endpoint's 402 lists USDC first and EURC second, valid against the PaymentRequired schema", async () => {
    for (const e of PAID_ENDPOINT_LIST) {
      const res = await post(e.path, {});
      expect(res.status).toBe(402);
      const pr = decodePaymentRequiredHeader(res.headers.get("PAYMENT-REQUIRED")!);
      expect(PaymentRequiredSchema.safeParse(pr).success).toBe(true);
      expect(pr.accepts.map((a) => a.asset)).toEqual([USDC.address, EURC.address]);
      expect(pr.accepts[1].amount).toBe(usdcAtomicToEurcAtomic(e.price_atomic));
      const body = await res.json();
      expect(body.error.details.accepted_assets.map((a: { asset: string }) => a.asset)).toEqual(["USDC", "EURC"]);
    }
  });

  it("a client preferring EURC pays 0.14 EURC and gets 200 with receipt.asset EURC", async () => {
    const res = await eurcFetch(`${BASE}/api/v1/entry`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(invoiceBody) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.receipt).toMatchObject({ method: "x402", asset: "EURC", amount: "0.14", amount_atomic: "140000", asset_address: EURC.address, mode: "simulated" });
    expect(ReceiptSchema.safeParse(body.receipt).success).toBe(true);
    expect(body.receipt.tx_hash).toMatch(/^0x5151/);
    const stats = await getStore().stats();
    expect(stats.revenue_by_asset.simulated.EURC).toEqual({ payments: 1, amount: "0.14", amount_atomic: "140000" });
    expect(stats.revenue_by_asset.simulated.USDC.payments).toBe(0);
    expect(stats.usdc_earned).toBe("0.00");
    expect(stats.revenue_per_endpoint.entry).toMatchObject({ calls: 1, usdc: "0.00", eurc: "0.14" });
  });

  it("the default SDK client still pays USDC (unchanged flow)", async () => {
    const res = await usdcFetch(`${BASE}/api/v1/entry`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(invoiceBody) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.receipt).toMatchObject({ method: "x402", asset: "USDC", amount: "0.15", asset_address: USDC.address });
    expect((await getStore().stats()).usdc_earned).toBe("0.15");
  });

  it("an EURC signature cannot be replayed against the USDC requirement (amount/asset bound)", async () => {
    const unpaid = await post("/api/v1/entry", invoiceBody);
    const pr = decodePaymentRequiredHeader(unpaid.headers.get("PAYMENT-REQUIRED")!);
    const client = x402Client.fromConfig({ schemes: [{ network: NET, client: new ExactEvmScheme(agent) }], spendControls: false });
    const payload = await client.createPaymentPayload({ ...pr, accepts: [pr.accepts[1]] });
    // Tamper: claim the USDC requirement while the signature is for EURC.
    const forged = { ...payload, accepted: pr.accepts[0] };
    const res = await post("/api/v1/entry", invoiceBody, { "PAYMENT-SIGNATURE": Buffer.from(JSON.stringify(forged)).toString("base64") });
    expect(res.status).toBe(402);
    expect(engine.createEntry).not.toHaveBeenCalled();
  });

  it("operator stats report revenue per asset", async () => {
    await usdcFetch(`${BASE}/api/v1/entry`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(invoiceBody) });
    await eurcFetch(`${BASE}/api/v1/audit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: [{ invoice: {} }] }) });
    const body = await (await operatorStatsGET()).json();
    expect(body).toMatchObject({ calls: 2, usdc_earned: "0.15", earned_by_asset: { USDC: "0.15", EURC: "0.93" } });
    expect(body.by_endpoint.find((e: { endpoint: string }) => e.endpoint === "/api/v1/audit")).toMatchObject({ calls: 1, usdc: "0.00", eurc: "0.93" });
    expect(body.recent.map((r: { asset: string }) => r.asset).sort()).toEqual(["EURC", "USDC"]);
  });

  it("health and discovery list both assets from the pricing config", async () => {
    const h = await (await healthGET()).json();
    expect(h.payment.accepted_assets.map((a: { symbol: string }) => a.symbol)).toEqual(["USDC", "EURC"]);
    const cat = buildCatalog(BASE);
    expect(cat.payment.asset.address).toBe(USDC.address); // default unchanged
    expect(cat.payment.accepted_assets).toMatchObject([
      { symbol: "USDC", address: USDC.address, accepts_index: 0, default: true },
      { symbol: "EURC", address: EURC.address, eip712: { name: "EURC", version: "2" }, accepts_index: 1 },
    ]);
    const entry = cat.endpoints.paid.find((e) => e.id === "entry")!;
    expect(entry.prices).toEqual({ USDC: { amount: "0.15", amount_atomic: "150000" }, EURC: { amount: "0.14", amount_atomic: "140000" } });
    const spec = buildOpenApi(BASE) as { paths: Record<string, Record<string, Record<string, unknown>>> };
    const x = spec.paths["/api/v1/entry"].post["x-x402"] as { accepts: { asset_symbol: string; amount: string }[] };
    expect(x.accepts.map((a) => [a.asset_symbol, a.amount])).toEqual([["USDC", "150000"], ["EURC", "140000"]]);
    const llms = buildLlmsTxt(BASE);
    expect(llms).toContain(EURC.address);
    expect(llms).toContain("1 EURC = 1.08 USDC");
    const card = buildAgentCard(BASE);
    expect(card.x402.accepted_assets).toHaveLength(2);
    expect(card.skills.find((s) => s.id === "create_entry")!.price.alternatives).toEqual([{ amount: "0.14", amount_atomic: "140000", currency: "EURC" }]);
  });

  it("the MCP spending policy refuses EURC unless the bridge prefers it, and budgets it at its USDC value", () => {
    const policy = new SpendingPolicy({ maxPerCallUsdc: "0.20", dailyBudgetUsdc: "2.00" });
    const req = { network: NET, asset: EURC.address, amount: "140000", scheme: "exact" };
    expect(policy.checkRequirements(req).ok).toBe(false);
    const d = policy.checkRequirements(req, true);
    expect(d).toMatchObject({ ok: true, usdcEquivalent: 151200n });
    expect(policy.checkRequirements({ ...req, amount: "190000" }, true).ok).toBe(false); // 0.2052 USDC > 0.20 cap
  });
});

// ---------------------------------------------------------------------------
// Prepaid credit packs (ADR-025)
// ---------------------------------------------------------------------------

describe("credit packs: purchase", () => {
  it("packs come from config with a 20% volume bonus", () => {
    expect(CREDIT_PACKS.starter).toMatchObject({ price_usdc: "1.00", credit_usdc: "1.20", bonus_pct: 20 });
    expect(CREDIT_PACKS.pro).toMatchObject({ price_usdc: "10.00", credit_usdc: "12.00", bonus_pct: 20 });
    for (const p of Object.values(CREDIT_PACKS)) expect(BigInt(p.credit_atomic) * 100n).toBe(BigInt(p.price_atomic) * BigInt(100 + p.bonus_pct));
  });

  it("unpaid purchase → 402 with the pack price in USDC and EURC", async () => {
    const res = await post("/api/v1/credits", { pack: "starter" });
    expect(res.status).toBe(402);
    const pr = decodePaymentRequiredHeader(res.headers.get("PAYMENT-REQUIRED")!);
    expect(pr.accepts.map((a) => [a.asset, a.amount])).toEqual([
      [USDC.address, "1000000"],
      [EURC.address, "930000"],
    ]);
    expect((await res.json()).error.details).toMatchObject({ pack: "starter", credit_usdc: "1.20" });
  });

  it("unknown pack → 400 INVALID_CREDIT_PACK before any payment", async () => {
    const res = await post("/api/v1/credits", { pack: "mega" });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_CREDIT_PACK");
  });

  it("buys the starter pack: token + 1.20 USDC balance, only the SHA-256 is stored", async () => {
    const { res, body } = await buyPack("starter");
    expect(res.status).toBe(200);
    expect(CreditPurchaseResponseSchema.safeParse(body).success).toBe(true);
    expect(body.credit_token).toMatch(CREDIT_TOKEN_RE);
    expect(body).toMatchObject({ pack: "starter", balance: "1.20", balance_atomic: "1200000", asset: "USDC", paid: { amount: "1.00", asset: "USDC" } });
    expect(body.receipt).toMatchObject({ method: "x402", amount: "1.00", asset: "USDC" });
    expect(res.headers.get("PAYMENT-RESPONSE")).toBeTruthy();
    const days = (Date.parse(body.expires_at) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);
    // Store: account keyed by the hash, token itself never persisted.
    const store = getStore();
    const account = await store.getCredit(hashCreditToken(body.credit_token));
    expect(account).toMatchObject({ pack: "starter", balance_atomic: "1200000", mode: "simulated", paid_asset: "USDC" });
    const rec = await store.getReceipt(body.request_id);
    expect(rec?.endpoint).toBe("credits");
    expect(JSON.stringify(rec)).not.toContain(body.credit_token);
    expect(JSON.stringify(account)).not.toContain(body.credit_token);
    // Free receipt lookup works and never reveals the token.
    const r = await receiptGET(new NextRequest(`${BASE}/api/v1/receipts/${body.request_id}`), { params: Promise.resolve({ id: body.request_id }) });
    const rj = await r.json();
    expect(rj.result).toMatchObject({ kind: "credit_pack", pack: "starter" });
    expect(JSON.stringify(rj)).not.toContain(body.credit_token);
  });

  it("buys the pro pack in EURC (9.26 EURC → 12.00 USDC of calls)", async () => {
    const { res, body } = await buyPack("pro", eurcFetch);
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ pack: "pro", balance: "12.00", paid: { amount: "9.26", asset: "EURC" } });
    const stats = await getStore().stats();
    expect(stats.credits.simulated.packs_sold).toBe(1);
    expect(stats.credits.simulated.sold.EURC).toEqual({ payments: 1, amount: "9.26", amount_atomic: "9260000" });
    expect(stats.calls_served).toBe(0); // a pack is not an engine call
  });

  it("the pro pack needs the SDK's $1 cap raised; with it, USDC works", async () => {
    await expect(buyPack("pro", usdcFetch)).rejects.toThrow(/maxAmountPerPayment/);
    const { res, body } = await buyPack("pro", usdcFetch10);
    expect(res.status).toBe(200);
    expect(body.balance).toBe("12.00");
  });

  it("an idempotent replay of the purchase returns the same token and does not charge or credit twice", async () => {
    const key = "pack-key-1";
    const first = await buyPack("starter", usdcFetch, key);
    const replay = await post("/api/v1/credits", { pack: "starter" }, { "Idempotency-Key": key });
    expect(replay.status).toBe(200);
    expect(replay.headers.get("Idempotent-Replay")).toBe("true");
    const rb = await replay.json();
    expect(rb.credit_token).toBe(first.body.credit_token);
    expect(rb.request_id).toBe(first.body.request_id);
    expect((await getStore().stats()).credits.simulated.packs_sold).toBe(1);
    // Same key, other pack → conflict.
    const conflict = await post("/api/v1/credits", { pack: "pro" }, { "Idempotency-Key": key });
    expect(conflict.status).toBe(409);
  });

  it("tokens are derived from the purchase request_id with the server secret (re-derivable, unguessable)", () => {
    const t = deriveCreditToken("req_01JD0000000000000000000000");
    expect(t).toMatch(CREDIT_TOKEN_RE);
    expect(deriveCreditToken("req_01JD0000000000000000000000")).toBe(t);
    expect(deriveCreditToken("req_01JD0000000000000000000001")).not.toBe(t);
    process.env.CREDIT_TOKEN_SECRET = "another-secret-of-32-characters!!";
    try {
      expect(deriveCreditToken("req_01JD0000000000000000000000")).not.toBe(t);
    } finally {
      delete process.env.CREDIT_TOKEN_SECRET;
    }
  });
});

describe("credit packs: spending the token", () => {
  it("buy starter → 2 calls with the token → balance decreases; receipts say method credits", async () => {
    const { body: pack } = await buyPack("starter");
    const token = pack.credit_token as string;
    const r1 = await post("/api/v1/entry", invoiceBody, { "X-Credit-Token": token });
    expect(r1.status).toBe(200);
    expect(r1.headers.get("PAYMENT-RESPONSE")).toBeNull(); // no settlement
    expect(r1.headers.get("X-Credit-Balance")).toBe("1.05");
    const b1 = await r1.json();
    expect(b1.receipt).toMatchObject({ method: "credits", amount: "0.15", asset: "USDC", remaining_balance: "1.05", tx_hash: "", explorer_url: null, mode: "simulated" });
    expect(ReceiptSchema.safeParse(b1.receipt).success).toBe(true);
    expect(b1.entry.balanced).toBe(true);
    const r2 = await post("/api/v1/invoice/check", invoiceBody, { "X-Credit-Token": token });
    expect((await r2.json()).receipt).toMatchObject({ method: "credits", amount: "0.05", remaining_balance: "1.00" });

    const bal = await balance(token);
    expect(bal.status).toBe(200);
    const bj = await bal.json();
    expect(CreditBalanceSchema.safeParse(bj).success).toBe(true);
    expect(bj).toMatchObject({ balance: "1.00", balance_atomic: "1000000", initial_credit: "1.20", calls_debited: 2, pack: "starter", expired: false });

    const stats = await getStore().stats();
    expect(stats.calls_served).toBe(2);
    expect(stats.credits.simulated).toMatchObject({ packs_sold: 1, calls: 2, consumed_usdc: "0.20" });
    expect(stats.usdc_earned).toBe("1.00"); // the pack was the cash; credit calls add none
    expect(stats.revenue_per_endpoint.entry).toMatchObject({ calls: 1, credit_calls: 1, usdc: "0.00" });
    const op = await (await operatorStatsGET()).json();
    expect(op.credits).toMatchObject({ packs_sold: 1, sold: { USDC: "1.00", EURC: "0.00" }, calls: 2, consumed_usdc: "0.20" });
    expect(op.recent.find((r: { method: string }) => r.method === "credits")).toBeTruthy();
  });

  it("an idempotent replay of a credit call is never debited twice", async () => {
    const { body: pack } = await buyPack("starter");
    const h = { "X-Credit-Token": pack.credit_token, "Idempotency-Key": "credit-call-1" };
    const a = await post("/api/v1/entry", invoiceBody, h);
    const b = await post("/api/v1/entry", invoiceBody, h);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(b.headers.get("Idempotent-Replay")).toBe("true");
    expect((await b.json()).request_id).toBe((await a.json()).request_id);
    expect((await (await balance(pack.credit_token)).json()).balance).toBe("1.05");
    expect(engine.createEntry).toHaveBeenCalledTimes(1);
  });

  it("an engine error is never debited (reserve → refund)", async () => {
    const { body: pack } = await buyPack("starter");
    engine.createEntry.mockRejectedValueOnce(new engine.EngineError("UNSUPPORTED_FORMAT", "nope"));
    const res = await post("/api/v1/entry", invoiceBody, { "X-Credit-Token": pack.credit_token });
    expect(res.status).toBe(415);
    const bj = await (await balance(pack.credit_token)).json();
    expect(bj).toMatchObject({ balance: "1.20", calls_debited: 0 });
    const bad = await post("/api/v1/entry", { nope: true }, { "X-Credit-Token": pack.credit_token });
    expect(bad.status).toBe(400);
    expect((await (await balance(pack.credit_token)).json()).balance).toBe("1.20");
  });

  it("insufficient balance → 402 CREDITS_INSUFFICIENT with the normal x402 requirements + credits info, nothing debited", async () => {
    const { body: pack } = await buyPack("starter");
    const res = await post("/api/v1/audit", { items: [{ invoice: {} }] }, { "X-Credit-Token": pack.credit_token });
    expect(res.status).toBe(200); // 1.20 ≥ 1.00: paid with credits
    // 1.20 - 1.00 = 0.20 left: the next audit cannot be paid with credits.
    const res2 = await post("/api/v1/audit", { items: [{ invoice: {} }] }, { "X-Credit-Token": pack.credit_token });
    expect(res2.status).toBe(402);
    const pr = decodePaymentRequiredHeader(res2.headers.get("PAYMENT-REQUIRED")!);
    expect(pr.accepts).toHaveLength(2);
    expect(pr.accepts[0].amount).toBe("1000000");
    const b = await res2.json();
    expect(b.error.code).toBe("CREDITS_INSUFFICIENT");
    expect(b.error.details.credits).toMatchObject({ reason: "insufficient", balance_usdc: "0.20", price_usdc: "1.00" });
    expect(b.error.details.accepted_assets).toHaveLength(2);
    expect(engine.auditEntries).toHaveBeenCalledTimes(1);
    expect((await (await balance(pack.credit_token)).json()).balance).toBe("0.20");
    // The same request still goes through when paid with x402.
    const paid = await usdcFetch(`${BASE}/api/v1/audit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: [{ invoice: {} }] }) });
    expect(paid.status).toBe(200);
  });

  it("unknown, malformed, expired or other-mode tokens → 402 CREDIT_TOKEN_INVALID; balance → 404", async () => {
    for (const t of ["nope", "ajc_" + "A".repeat(43)]) {
      const res = await post("/api/v1/entry", invoiceBody, { "X-Credit-Token": t });
      expect(res.status).toBe(402);
      expect(res.headers.get("PAYMENT-REQUIRED")).toBeTruthy();
      expect((await res.json()).error).toMatchObject({ code: "CREDIT_TOKEN_INVALID", details: { credits: { reason: "unknown" } } });
      expect((await balance(t)).status).toBe(404);
    }
    expect((await inProcessFetch(`${BASE}/api/v1/credits/balance`)).status).toBe(404);

    const { body: pack } = await buyPack("starter");
    const store = getStore();
    const hash = hashCreditToken(pack.credit_token);
    const acc = (await store.getCredit(hash)) as CreditAccount;
    await store.saveCredit({ ...acc, expires_at: new Date(Date.now() - 1000).toISOString() });
    const expired = await post("/api/v1/entry", invoiceBody, { "X-Credit-Token": pack.credit_token });
    expect((await expired.json()).error.details.credits.reason).toBe("expired");
    expect((await (await balance(pack.credit_token)).json()).expired).toBe(true);

    await store.saveCredit({ ...acc, mode: "testnet" });
    const other = await post("/api/v1/entry", invoiceBody, { "X-Credit-Token": pack.credit_token });
    expect((await other.json()).error.details.credits.reason).toBe("wrong_mode");
    expect(engine.createEntry).not.toHaveBeenCalled();
  });

  it("concurrent calls on one token never overspend (per-instance lock)", async () => {
    const { body: pack } = await buyPack("starter");
    // 1.20 USDC = 8 entry calls; fire 10 in parallel.
    const results = await Promise.all(Array.from({ length: 10 }, () => post("/api/v1/entry", invoiceBody, { "X-Credit-Token": pack.credit_token })));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(8);
    expect(statuses.filter((s) => s === 402)).toHaveLength(2);
    expect((await (await balance(pack.credit_token)).json()).balance).toBe("0.00");
  });

  it("PAYMENT-SIGNATURE wins over X-Credit-Token (x402 path, token untouched)", async () => {
    const { body: pack } = await buyPack("starter");
    const res = await usdcFetch(`${BASE}/api/v1/entry`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Credit-Token": "ajc_" + "B".repeat(43) },
      body: JSON.stringify(invoiceBody),
    });
    // First leg (no signature) used the bogus token → 402 with requirements → SDK pays with x402.
    expect(res.status).toBe(200);
    expect((await res.json()).receipt.method).toBe("x402");
    expect((await (await balance(pack.credit_token)).json()).balance).toBe("1.20");
  });

  it("the per-token lock serialises critical sections", async () => {
    const order: string[] = [];
    await Promise.all([
      withCreditLock("h", async () => {
        order.push("a1");
        await new Promise((r) => setTimeout(r, 5));
        order.push("a2");
      }),
      withCreditLock("h", async () => {
        order.push("b1");
      }),
    ]);
    expect(order).toEqual(["a1", "a2", "b1"]);
  });

  it("discovery documents the credit packs (catalog, openapi, llms.txt, agent card)", () => {
    const cat = buildCatalog(BASE);
    expect(cat.endpoints.credits).toMatchObject({ path: "/api/v1/credits", validity_days: 30 });
    expect(cat.endpoints.credits.packs.map((p) => [p.id, p.price_usdc, p.credit_usdc])).toEqual([
      ["starter", "1.00", "1.20"],
      ["pro", "10.00", "12.00"],
    ]);
    expect(cat.payment.prepaid_credits.header).toBe("X-Credit-Token");
    expect(cat.endpoints.free.map((e) => e.path)).toContain("/api/v1/credits/balance");
    const spec = buildOpenApi(BASE) as { paths: Record<string, Record<string, { operationId: string }>> };
    expect(spec.paths["/api/v1/credits"].post.operationId).toBe("buy_credits");
    expect(spec.paths["/api/v1/credits/balance"].get.operationId).toBe("get_credit_balance");
    const llms = buildLlmsTxt(BASE);
    expect(llms).toContain("## Prepaid credits");
    expect(llms).toContain("X-Credit-Token");
    expect(llms).toContain("`CREDITS_INSUFFICIENT`");
    expect(buildAgentCard(BASE).x402.prepaid_credits.packs).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Stores: credit accounts + per-asset counters
// ---------------------------------------------------------------------------

function rec(id: string, endpoint: ReceiptRecord["endpoint"], receipt: ReceiptRecord["receipt"]): ReceiptRecord {
  return { request_id: id, endpoint, idempotency_key: null, request_hash: "h", receipt, result: {}, payment_response: null, created_at: receipt.paid_at };
}
const settle = (amount: string) => ({ success: true, transaction: "0x5151" + "0".repeat(60), network: NET as `${string}:${string}`, amount });

async function exerciseCredits(store: MemoryStore | FileStore | CloudflareKVStore) {
  const acc: CreditAccount = {
    token_hash: "f".repeat(64),
    pack: "starter",
    mode: "simulated",
    initial_atomic: "1200000",
    balance_atomic: "1200000",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    purchase_request_id: "req_x",
    paid_asset: "USDC",
    paid_amount_atomic: "1000000",
    calls: 0,
  };
  expect(await store.getCredit(acc.token_hash)).toBeNull();
  await store.saveCredit(acc);
  await store.saveCredit({ ...acc, balance_atomic: "1050000", calls: 1 });
  expect(await store.getCredit(acc.token_hash)).toMatchObject({ balance_atomic: "1050000", calls: 1 });
  await store.saveReceipt(rec("req_1", "entry", buildReceipt({ endpoint: "entry", settle: settle("140000"), payTo: PAY_TO, mode: "simulated", assetAddress: EURC.address })));
  await store.saveReceipt(rec("req_2", "credits", buildReceipt({ settle: settle("1000000"), payTo: PAY_TO, mode: "simulated", listedUsdcAtomic: "1000000" })));
  await store.saveReceipt(rec("req_3", "entry", buildCreditReceipt({ amountAtomic: "150000", remainingAtomic: "1050000", tokenId: "ct_x", payTo: PAY_TO, mode: "simulated" })));
  const s = await store.stats();
  expect(s.calls_served).toBe(2);
  expect(s.usdc_earned).toBe("1.00");
  expect(s.revenue_by_asset.simulated.EURC.amount).toBe("0.14");
  expect(s.credits.simulated).toMatchObject({ packs_sold: 1, calls: 1, consumed_usdc: "0.15" });
  expect(s.revenue_per_endpoint.entry).toMatchObject({ calls: 2, usdc: "0.00", eurc: "0.14", credit_calls: 1 });
}

describe("stores", () => {
  it("memory store keeps credit accounts and per-asset counters", async () => {
    await exerciseCredits(new MemoryStore());
  });

  it("file store keeps credit accounts and per-asset counters", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "ajean-credits-"));
    try {
      await exerciseCredits(new FileStore(path.join(dir, "r.json")));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("Cloudflare KV store (fake binding): credits with TTL, legacy 2-part counters read as USDC", async () => {
    const data = new Map<string, string>();
    const ttls = new Map<string, number | undefined>();
    const kv: KVNamespaceLike = {
      async get(key) {
        const v = data.get(key);
        return v === undefined ? null : JSON.parse(v);
      },
      async put(key, value, opts) {
        data.set(key, value);
        ttls.set(key, opts?.expirationTtl);
      },
    };
    const store = new CloudflareKVStore(() => kv);
    await exerciseCredits(store);
    expect(ttls.get("ajean:credit:" + "f".repeat(64))).toBeGreaterThan(86_400);
    // A stats document written before ADR-024 (`mode:endpoint` keys) is still read, as USDC.
    data.set("ajean:stats", JSON.stringify({ "testnet:entry": { calls: 3, atomic: "450000" } }));
    const s = await store.stats();
    expect(s.by_mode.testnet).toMatchObject({ calls: 3, usdc: "0.45" });
    expect(s.revenue_by_asset.testnet.USDC.amount).toBe("0.45");
  });

  it("counter keys: mode:endpoint:channel, legacy keys default to USDC", () => {
    expect(parseCounterKey("simulated:entry")).toEqual({ mode: "simulated", endpoint: "entry", channel: "USDC" });
    expect(parseCounterKey("testnet:credits:EURC")).toEqual({ mode: "testnet", endpoint: "credits", channel: "EURC" });
    const c = countersFromRecords([rec("r", "audit", buildCreditReceipt({ amountAtomic: "1000000", remainingAtomic: "0", tokenId: "ct_x", payTo: PAY_TO, mode: "testnet" }))]);
    expect([...c.keys()]).toEqual(["testnet:audit:credits"]);
  });
});
