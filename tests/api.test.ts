/**
 * Paid API, end to end through the real Next.js route handlers, with the x402 v2
 * SDK on both sides (withX402 server, @x402/fetch + ExactEvmScheme client) and
 * the simulated facilitator. No network. The engine is mocked.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { decodePaymentRequiredHeader, decodePaymentResponseHeader } from "@x402/core/http";
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
    invoice: { document_type: "invoice", number: "F-2026-001", date: "2026-11-02", supplier: { name: "Bureau Plus (fictional)", siren: "123456789", country: "FR" }, customer: { name: "Atelier Lumen SAS (fictional)", siren: "987654321", country: "FR" }, totals: { total_excl_vat: 100, total_vat: 20, total_incl_vat: 120 } },
    compliance: { status: "compliant", checks: [] },
    entry: { journal: "HA", date: "2026-11-02", reference: "F-2026-001", lines: [{ account: "6064", label: "Fournitures administratives", debit: 100, credit: 0 }, { account: "44566", label: "TVA déductible sur ABS", debit: 20, credit: 0 }, { account: "401BURO", label: "Bureau Plus", debit: 0, credit: 120 }], balanced: true },
    vat: { regime: "standard", rate: 0.2, deductible: true, breakdown: [] },
    anomalies: [],
    confidence: 0.97,
    human_review_required: false,
    review_reasons: [],
    explanation: "mock",
    engine: { version: "test", rules_applied: [], llm_used: false, extraction_method: "structured_json" },
    disclaimer: "test",
  };
  return {
    EngineError,
    entryResult,
    createEntry: vi.fn(async (..._args: unknown[]) => entryResult),
    checkInvoice: vi.fn(async (..._args: unknown[]) => ({ ...entryResult, kind: "check" })),
    auditEntries: vi.fn(async (items: unknown[]) => ({ entries_audited: items.length, kind: "audit" })),
  };
});

// @x402/next's ESM build imports "next/server" without extension, which Node's native ESM
// resolver (used by Vitest for node_modules) rejects. Load its CJS build instead; Next.js
// bundles (dev/build) resolve the ESM build fine. (Alternative: vitest `server.deps.inline`.)
vi.mock("@x402/next", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(import.meta.url)("@x402/next");
});

vi.mock("@/engine", () => ({
  EngineError: engine.EngineError,
  createEntry: engine.createEntry,
  checkInvoice: engine.checkInvoice,
  auditEntries: engine.auditEntries,
  DEMO_PROFILE: { name: "Atelier Lumen SAS (fictional)", siren: "987654321", activity: "commercial", accounting_basis: "accrual", vat_regime: "standard" },
}));

import { POST as entryPOST } from "@/app/api/v1/entry/route";
import { POST as checkPOST } from "@/app/api/v1/invoice/check/route";
import { POST as auditPOST } from "@/app/api/v1/audit/route";
import { GET as receiptGET } from "@/app/api/v1/receipts/[id]/route";
import { GET as healthGET } from "@/app/api/health/route";
import { resetPaidRoutes } from "@/lib/api/paid-route";
import { resetRateLimit } from "@/lib/api/rate-limit";
import { resetResourceServers } from "@/lib/payments/server";
import { resetSimulatedFacilitator } from "@/lib/payments/simulated-facilitator";
import { getStore, setStoreForTests, MemoryStore } from "@/lib/store";

const BASE = "http://localhost:3000";
const PAY_TO = privateKeyToAccount(generatePrivateKey()).address;
const AGENT_KEY = generatePrivateKey();
const agent = privateKeyToAccount(AGENT_KEY);
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

const invoiceBody = { input: { format: "json", invoice: { number: "F-2026-001", lines: [] } } };

type Handler = (req: NextRequest) => Promise<Response>;

function post(handler: Handler, path: string, body: unknown, headers: Record<string, string> = {}) {
  return handler(
    new NextRequest(`${BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

const httpClient = new x402HTTPClient(new x402Client().register("eip155:*", new ExactEvmScheme(agent)));

/** Unpaid call → 402 → sign → return the PAYMENT-SIGNATURE headers. */
async function paymentHeaders(handler: Handler, path: string, body: unknown): Promise<Record<string, string>> {
  const res = await post(handler, path, body);
  expect(res.status).toBe(402);
  const pr = httpClient.getPaymentRequiredResponse((n) => res.headers.get(n));
  return httpClient.encodePaymentSignatureHeader(await httpClient.createPaymentPayload(pr));
}

/** A fetch that dispatches to the route handlers in-process (lets @x402/fetch drive the whole flow). */
const routes: Record<string, Handler> = { "/api/v1/entry": entryPOST, "/api/v1/invoice/check": checkPOST, "/api/v1/audit": auditPOST };
const inProcessFetch: typeof fetch = async (input, init) => {
  const req = new NextRequest(input instanceof Request ? input : new Request(input, init));
  return routes[req.nextUrl.pathname](req);
};
const payingFetch = wrapFetchWithPayment(inProcessFetch, new x402Client().register("eip155:*", new ExactEvmScheme(agent)));

const savedEnv = { ...process.env };
beforeAll(() => {
  process.env.PAYMENT_MODE = "simulated";
  process.env.SERVICE_PAY_TO_ADDRESS = PAY_TO;
  process.env.STORE_KIND = "memory";
  delete process.env.ANTHROPIC_API_KEY;
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

describe("402 Payment Required (unpaid call)", () => {
  it.each([
    ["/api/v1/entry", entryPOST, "150000", "0.15"],
    ["/api/v1/invoice/check", checkPOST, "50000", "0.05"],
    ["/api/v1/audit", auditPOST, "1000000", "1.00"],
  ] as const)("%s answers 402 with the x402 v2 requirements", async (path, handler, atomic, usdc) => {
    const res = await post(handler, path, {});
    expect(res.status).toBe(402);
    const header = res.headers.get("PAYMENT-REQUIRED");
    expect(header).toBeTruthy();
    const pr = decodePaymentRequiredHeader(header!);
    expect(pr.x402Version).toBe(2);
    expect(pr.resource.url).toBe(`${BASE}${path}`);
    expect(pr.accepts).toHaveLength(1);
    expect(pr.accepts[0]).toMatchObject({
      scheme: "exact",
      network: "eip155:84532",
      amount: atomic,
      asset: USDC,
      payTo: PAY_TO,
      maxTimeoutSeconds: 300,
      extra: { name: "USDC", version: "2" },
    });
    const body = await res.json();
    expect(body.error.code).toBe("PAYMENT_REQUIRED");
    expect(body.error.details).toMatchObject({ price_usdc: usdc, amount_atomic: atomic, network: "eip155:84532", pay_to: PAY_TO, mode: "simulated" });
    expect(body.request_id).toMatch(/^req_/);
    expect(engine.createEntry).not.toHaveBeenCalled();
  });

  it("returns 402 before validating the body (invalid JSON unpaid → 402)", async () => {
    const res = await post(entryPOST, "/api/v1/entry", "{not json");
    expect(res.status).toBe(402);
  });
});

describe("paid flow (simulated facilitator)", () => {
  it("@x402/fetch pays 0.15 USDC and gets result + receipt + PAYMENT-RESPONSE", async () => {
    const res = await payingFetch(`${BASE}/api/v1/entry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(invoiceBody),
    });
    expect(res.status).toBe(200);
    const settle = decodePaymentResponseHeader(res.headers.get("PAYMENT-RESPONSE")!);
    expect(settle).toMatchObject({ success: true, network: "eip155:84532", payer: agent.address });
    expect(settle.transaction).toMatch(/^0x5151[0-9a-f]{60}$/);

    const body = await res.json();
    expect(Object.keys(body).slice(0, 2)).toEqual(["request_id", "receipt"]);
    expect(body.request_id).toMatch(/^req_[0-9A-Z]{26}$/);
    expect(res.headers.get("X-Request-Id")).toBe(body.request_id);
    expect(body.receipt).toMatchObject({
      amount: "0.15",
      amount_atomic: "150000",
      asset: "USDC",
      network: "base-sepolia",
      network_caip2: "eip155:84532",
      tx_hash: settle.transaction,
      payer: agent.address,
      pay_to: PAY_TO,
      explorer_url: null,
      mode: "simulated",
    });
    expect(body.entry.balanced).toBe(true);
    expect(body.compliance.status).toBe("compliant");
    expect(engine.createEntry).toHaveBeenCalledTimes(1);
    expect(engine.createEntry.mock.calls[0][0]).toEqual(invoiceBody.input);

    // Receipt retrievable for free.
    const r = await receiptGET(new NextRequest(`${BASE}/api/v1/receipts/${body.request_id}`), { params: Promise.resolve({ id: body.request_id }) });
    expect(r.status).toBe(200);
    const rec = await r.json();
    expect(rec.receipt.tx_hash).toBe(settle.transaction);
    expect(rec.result.entry.lines).toHaveLength(3);

    const stats = await getStore().stats();
    expect(stats.calls_served).toBe(1);
    expect(stats.usdc_earned).toBe("0.15");
    expect(stats.revenue_per_endpoint.entry.calls).toBe(1);
  });

  it("check and audit endpoints charge their own price", async () => {
    const c = await payingFetch(`${BASE}/api/v1/invoice/check`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(invoiceBody) });
    expect(c.status).toBe(200);
    expect((await c.json()).receipt.amount).toBe("0.05");
    const a = await payingFetch(`${BASE}/api/v1/audit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: [{ invoice: {} }, { entry: {} }] }) });
    expect(a.status).toBe(200);
    const ab = await a.json();
    expect(ab.receipt.amount).toBe("1.00");
    expect(ab.entries_audited).toBe(2);
    expect((await getStore().stats()).usdc_earned).toBe("1.05");
  });

  it("rejects a tampered payment with 402 PAYMENT_INVALID", async () => {
    const headers = await paymentHeaders(entryPOST, "/api/v1/entry", invoiceBody);
    const decoded = JSON.parse(Buffer.from(headers["PAYMENT-SIGNATURE"], "base64").toString());
    decoded.payload.authorization.value = "1";
    decoded.accepted.amount = "1";
    const forged = Buffer.from(JSON.stringify(decoded)).toString("base64");
    const res = await post(entryPOST, "/api/v1/entry", invoiceBody, { "PAYMENT-SIGNATURE": forged });
    expect(res.status).toBe(402);
    expect((await res.json()).error.code).toBe("PAYMENT_INVALID");
    expect(engine.createEntry).not.toHaveBeenCalled();
  });

  it("refuses to settle the same authorization twice", async () => {
    const headers = await paymentHeaders(entryPOST, "/api/v1/entry", invoiceBody);
    expect((await post(entryPOST, "/api/v1/entry", invoiceBody, headers)).status).toBe(200);
    const again = await post(entryPOST, "/api/v1/entry", invoiceBody, headers);
    expect(again.status).toBe(402);
    const b = await again.json();
    expect(b.error.code).toBe("PAYMENT_INVALID");
    expect(b.error.details.reason).toBe("invalid_exact_evm_nonce_already_used");
  });
});

describe("errors are machine-readable and never charged", () => {
  async function paid(handler: Handler, path: string, body: unknown) {
    const headers = await paymentHeaders(handler, path, body);
    const res = await post(handler, path, body, headers);
    return { res, json: await res.json(), headers };
  }

  it("paid but invalid JSON → 400 INVALID_JSON, no settlement, payment still reusable", async () => {
    const { res, json, headers } = await paid(entryPOST, "/api/v1/entry", "{oops");
    expect(res.status).toBe(400);
    expect(json.error).toMatchObject({ code: "INVALID_JSON", docs_url: expect.any(String) });
    expect(json.request_id).toMatch(/^req_/);
    expect(res.headers.get("PAYMENT-RESPONSE")).toBeNull();
    expect((await getStore().stats()).calls_served).toBe(0);
    // The authorization was never settled, so the agent can reuse it on a valid request.
    expect((await post(entryPOST, "/api/v1/entry", invoiceBody, headers)).status).toBe(200);
  });

  it("INVALID_INPUT, UNSUPPORTED_FORMAT, LLM_UNAVAILABLE, BATCH_TOO_LARGE", async () => {
    const a = await paid(entryPOST, "/api/v1/entry", { foo: 1 });
    expect([a.res.status, a.json.error.code]).toEqual([400, "INVALID_INPUT"]);
    const b = await paid(entryPOST, "/api/v1/entry", { input: { format: "docx" } });
    expect([b.res.status, b.json.error.code]).toEqual([415, "UNSUPPORTED_FORMAT"]);
    const c = await paid(checkPOST, "/api/v1/invoice/check", { input: { format: "bank_transaction", transaction: {} } });
    expect([c.res.status, c.json.error.code]).toEqual([415, "UNSUPPORTED_FORMAT"]);
    const d = await paid(entryPOST, "/api/v1/entry", { input: { format: "pdf", document_base64: "JVBERi0=" } });
    expect([d.res.status, d.json.error.code]).toEqual([503, "LLM_UNAVAILABLE"]);
    const e = await paid(auditPOST, "/api/v1/audit", { items: Array.from({ length: 51 }, () => ({ invoice: {} })) });
    expect([e.res.status, e.json.error.code]).toEqual([400, "BATCH_TOO_LARGE"]);
    const f = await paid(entryPOST, "/api/v1/entry", { ...invoiceBody, profile: { name: "x", siren: "12" } });
    expect([f.res.status, f.json.error.code]).toEqual([400, "INVALID_INPUT"]);
    expect(engine.createEntry).not.toHaveBeenCalled();
    expect((await getStore().stats()).calls_served).toBe(0);
  });

  it("maps engine errors and crashes without charging", async () => {
    engine.createEntry.mockRejectedValueOnce(new engine.EngineError("INVALID_INPUT", "Missing supplier", { field: "supplier" }));
    const a = await paid(entryPOST, "/api/v1/entry", invoiceBody);
    expect(a.res.status).toBe(400);
    expect(a.json.error).toMatchObject({ code: "INVALID_INPUT", message: "Missing supplier", details: { field: "supplier" } });
    expect(a.res.headers.get("PAYMENT-RESPONSE")).toBeNull();

    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    engine.createEntry.mockRejectedValueOnce(new Error("boom"));
    const b = await paid(entryPOST, "/api/v1/entry", invoiceBody);
    err.mockRestore();
    expect([b.res.status, b.json.error.code]).toEqual([500, "INTERNAL"]);
    expect((await getStore().stats()).calls_served).toBe(0);
  });

  it("testnet mode without a payTo address → 503 SERVICE_MISCONFIGURED (offline)", async () => {
    process.env.PAYMENT_MODE = "testnet";
    process.env.SERVICE_PAY_TO_ADDRESS = "";
    try {
      const res = await post(entryPOST, "/api/v1/entry", invoiceBody);
      expect(res.status).toBe(503);
      expect((await res.json()).error.code).toBe("SERVICE_MISCONFIGURED");
    } finally {
      process.env.PAYMENT_MODE = "simulated";
      process.env.SERVICE_PAY_TO_ADDRESS = PAY_TO;
      resetPaidRoutes();
      resetResourceServers();
    }
  });

  it("rate limits with 429 RATE_LIMITED + Retry-After", async () => {
    process.env.RATE_LIMIT_PER_MINUTE = "2";
    try {
      await post(entryPOST, "/api/v1/entry", {});
      await post(entryPOST, "/api/v1/entry", {});
      const res = await post(entryPOST, "/api/v1/entry", {});
      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBeTruthy();
      expect((await res.json()).error.code).toBe("RATE_LIMITED");
    } finally {
      delete process.env.RATE_LIMIT_PER_MINUTE;
    }
  });
});

describe("idempotency", () => {
  it("replays a paid result without payment, and detects conflicts", async () => {
    const key = "agent-run-42";
    const first = await payingFetch(`${BASE}/api/v1/entry`, {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify(invoiceBody),
    });
    expect(first.status).toBe(200);
    const original = await first.json();

    // Same key + same body (different key order / whitespace), NO payment → replay, not charged.
    const reordered = JSON.stringify({ input: { invoice: { lines: [], number: "F-2026-001" }, format: "json" } }, null, 2);
    const replay = await post(entryPOST, "/api/v1/entry", reordered, { "Idempotency-Key": key });
    expect(replay.status).toBe(200);
    expect(replay.headers.get("Idempotent-Replay")).toBe("true");
    expect(replay.headers.get("PAYMENT-RESPONSE")).toBe(first.headers.get("PAYMENT-RESPONSE"));
    const replayed = await replay.json();
    expect(replayed).toEqual(original);

    // A replay that carries a payment is not charged either (short-circuit before verification).
    const withPayment = await post(entryPOST, "/api/v1/entry", invoiceBody, {
      "Idempotency-Key": key,
      ...(await paymentHeaders(entryPOST, "/api/v1/entry", invoiceBody)),
    });
    expect(withPayment.status).toBe(200);
    expect(withPayment.headers.get("Idempotent-Replay")).toBe("true");

    expect(engine.createEntry).toHaveBeenCalledTimes(1);
    expect((await getStore().stats()).calls_served).toBe(1);

    // Same key, different body → 409.
    const conflict = await post(entryPOST, "/api/v1/entry", { input: { format: "json", invoice: { number: "OTHER" } } }, { "Idempotency-Key": key });
    expect(conflict.status).toBe(409);
    const cb = await conflict.json();
    expect(cb.error.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(cb.error.details.original_request_id).toBe(original.request_id);

    // Same key on another endpoint → 409.
    const other = await post(checkPOST, "/api/v1/invoice/check", invoiceBody, { "Idempotency-Key": key });
    expect(other.status).toBe(409);
  });

  it("rejects malformed keys", async () => {
    const res = await post(entryPOST, "/api/v1/entry", invoiceBody, { "Idempotency-Key": "x".repeat(129) });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_IDEMPOTENCY_KEY");
  });
});

describe("free endpoints", () => {
  it("receipts: 404 for unknown, 400 for malformed ids", async () => {
    const id = "req_01JZZZZZZZZZZZZZZZZZZZZZZZ";
    const a = await receiptGET(new NextRequest(`${BASE}/api/v1/receipts/${id}`), { params: Promise.resolve({ id }) });
    expect(a.status).toBe(404);
    expect((await a.json()).error.code).toBe("NOT_FOUND");
    const b = await receiptGET(new NextRequest(`${BASE}/api/v1/receipts/x`), { params: Promise.resolve({ id: "x" }) });
    expect(b.status).toBe(400);
  });

  it("health exposes mode, network, payTo and store, never secrets", async () => {
    process.env.AGENT_PRIVATE_KEY = AGENT_KEY;
    const res = await healthGET();
    const text = await res.text();
    const h = JSON.parse(text);
    expect(h.payment).toMatchObject({ mode: "simulated", network: "base-sepolia", network_caip2: "eip155:84532", pay_to: PAY_TO });
    expect(h.store.kind).toBe("memory");
    expect(h.engine_ready).toBe(true);
    expect(text).not.toContain(AGENT_KEY.slice(2));
    expect(text.toLowerCase()).not.toContain("private");
  });
});
