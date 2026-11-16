/**
 * Demo client agent (Phase 4): spending policy, catalog parsing, and full scripted runs
 * against the REAL route handlers + real engine, dispatched in-process (no network,
 * PAYMENT_MODE=simulated). Also the demo routes (/api/demo/run, /api/demo/replays) and
 * /api/v1/operator/stats.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

// Same workaround as tests/api.test.ts: load @x402/next through its CJS build under Vitest.
vi.mock("@x402/next", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(import.meta.url)("@x402/next");
});

import { AGENT_COMPANY_PROFILE, parseCatalog, runAgent } from "@/agent/core";
import { MemoryErp } from "@/agent/erp";
import { buildInboxItem, fsFixture, loadInbox } from "@/agent/inbox";
import { MemorySpendLedger, evaluatePolicy, policyFromEnv } from "@/agent/policy";
import { scenarioItem } from "@/agent/scenarios";
import type { InboxItem, RunAgentOptions } from "@/agent/types";
import { GET as healthGET } from "@/app/api/health/route";
import { POST as entryPOST } from "@/app/api/v1/entry/route";
import { POST as auditPOST } from "@/app/api/v1/audit/route";
import { POST as demoRunPOST } from "@/app/api/demo/run/route";
import { GET as replaysGET } from "@/app/api/demo/replays/route";
import { GET as statsGET } from "@/app/api/v1/operator/stats/route";
import { resetPaidRoutes } from "@/lib/api/paid-route";
import { resetRateLimit } from "@/lib/api/rate-limit";
import { resetResourceServers } from "@/lib/payments/server";
import { resetSimulatedFacilitator } from "@/lib/payments/simulated-facilitator";
import { MemoryStore, setStoreForTests } from "@/lib/store";

const BASE = "http://agent-test.local";
const PAY_TO = privateKeyToAccount(generatePrivateKey()).address;
const AGENT_KEY = generatePrivateKey();
const wallet = privateKeyToAccount(AGENT_KEY);
const POLICY = { max_per_call_usdc: "0.20", daily_budget_usdc: "2.00" };

type Handler = (req: NextRequest) => Promise<Response>;
const ROUTES: Record<string, { GET?: () => Promise<Response>; POST?: Handler }> = {
  "/api/health": { GET: healthGET },
  "/api/v1/entry": { POST: entryPOST },
  "/api/v1/audit": { POST: auditPOST },
};

/** In-process fetch: dispatches to the Next route handlers. `catalog` simulates /api/v1/catalog. */
function makeFetch(opts: { catalog?: unknown; failPaid?: boolean } = {}): typeof fetch & { calls: string[] } {
  const calls: string[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const { cache: _cache, ...rest } = (init ?? {}) as RequestInit;
    const req = new NextRequest(input instanceof Request ? input : new Request(input, rest));
    const path = req.nextUrl.pathname;
    calls.push(`${req.method} ${path}${req.headers.get("PAYMENT-SIGNATURE") ? " +sig" : ""}`);
    if (path === "/api/v1/catalog") {
      return opts.catalog ? Response.json(opts.catalog) : Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
    }
    if (opts.failPaid && req.headers.get("PAYMENT-SIGNATURE")) {
      return Response.json(
        { error: { code: "PAYMENT_INVALID", message: "Payment rejected", details: { reason: "invalid_exact_evm_insufficient_balance" } } },
        { status: 402 },
      );
    }
    const r = ROUTES[path];
    if (!r) return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
    if (req.method === "GET" && r.GET) return r.GET();
    if (req.method === "POST" && r.POST) return r.POST(req);
    return new Response(null, { status: 405 });
  }) as typeof fetch & { calls: string[] };
  f.calls = calls;
  return f;
}

function opts(item: InboxItem, extra: Partial<RunAgentOptions> = {}): RunAgentOptions {
  return {
    serviceUrl: BASE,
    item,
    wallet,
    policy: POLICY,
    ledger: new MemorySpendLedger(),
    erp: new MemoryErp(),
    reasoning: "scripted",
    fetchImpl: makeFetch(),
    ...extra,
  };
}

const kinds = (t: { steps: { kind: string }[] }) => t.steps.map((s) => s.kind);

const savedEnv = { ...process.env };
beforeAll(() => {
  process.env.PAYMENT_MODE = "simulated";
  process.env.SERVICE_PAY_TO_ADDRESS = PAY_TO;
  process.env.STORE_KIND = "memory";
  process.env.RATE_LIMIT_PER_MINUTE = "0";
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.AGENT_PRIVATE_KEY;
  delete process.env.AGENT_MAX_PER_CALL_USDC;
  delete process.env.AGENT_DAILY_BUDGET_USDC;
  resetPaidRoutes();
  resetResourceServers();
});
afterAll(() => {
  process.env = { ...savedEnv };
  vi.unstubAllGlobals();
});
beforeEach(() => {
  setStoreForTests(new MemoryStore());
  resetSimulatedFacilitator();
  resetRateLimit();
});

// ---------------------------------------------------------------------------
describe("spending policy", () => {
  it("allows a price within max per call and daily budget", () => {
    const d = evaluatePolicy("0.15", POLICY, 0n);
    expect(d.decision).toBe("allow");
    expect(d.spent_after_usdc).toBe("0.15");
  });
  it("allows exactly the max per call and exactly the remaining budget", () => {
    expect(evaluatePolicy("0.20", POLICY, 0n).decision).toBe("allow");
    expect(evaluatePolicy("0.15", POLICY, 1_850_000n).decision).toBe("allow"); // 1.85 + 0.15 = 2.00
  });
  it("refuses a price above max per call (the 1.00 USDC audit)", () => {
    const d = evaluatePolicy("1.00", POLICY, 0n);
    expect(d).toMatchObject({ decision: "refuse", code: "PRICE_ABOVE_MAX_PER_CALL" });
    expect(d.reason).toContain("1.00 USDC > max per call 0.20 USDC");
  });
  it("refuses when the daily budget would be exceeded", () => {
    const d = evaluatePolicy("0.15", POLICY, 1_900_000n);
    expect(d).toMatchObject({ decision: "refuse", code: "DAILY_BUDGET_EXCEEDED", spent_today_usdc: "1.90", spent_after_usdc: "2.05" });
  });
  it("refuses an unreadable price", () => {
    expect(evaluatePolicy("abc", POLICY, 0n)).toMatchObject({ decision: "refuse", code: "INVALID_PRICE" });
  });
  it("reads the policy from env with overrides and normalises amounts", () => {
    process.env.AGENT_MAX_PER_CALL_USDC = "0.3";
    expect(policyFromEnv()).toEqual({ max_per_call_usdc: "0.30", daily_budget_usdc: "2.00" });
    expect(policyFromEnv({ max_per_call_usdc: "1" }).max_per_call_usdc).toBe("1.00");
    delete process.env.AGENT_MAX_PER_CALL_USDC;
  });
  it("memory ledger sums only today's payments", async () => {
    const l = new MemorySpendLedger();
    await l.record({ at: "2020-01-01T10:00:00Z", amount_atomic: "150000", endpoint: "/api/v1/entry" });
    await l.record({ at: new Date().toISOString(), amount_atomic: "150000", endpoint: "/api/v1/entry" });
    expect(await l.spentTodayAtomic()).toBe(150000n);
  });
});

describe("catalog parsing (tolerant to the catalog shape)", () => {
  it("finds price, payTo, network and asset in nested structures", () => {
    const cat = {
      payment: { network: "eip155:84532", asset: { symbol: "USDC", address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" }, pay_to: PAY_TO },
      endpoints: [
        { method: "POST", path: "/api/v1/invoice/check", price_usdc: "0.05" },
        { method: "POST", path: "/api/v1/entry", price: { usdc: "0.15", atomic: "150000" } },
      ],
    };
    expect(parseCatalog(cat, "/api/v1/entry")).toEqual({
      price_usdc: "0.15",
      pay_to: PAY_TO,
      network: "eip155:84532",
      asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    });
    expect(parseCatalog({ tools: [{ url: "https://x/api/v1/audit", price: "$1.00" }] }, "/api/v1/audit").price_usdc).toBe("1.00");
    expect(parseCatalog({}, "/api/v1/entry").price_usdc).toBeNull();
  });
});

describe("inbox", () => {
  it("loads the inbox sorted, resolving fixtures (source of truth)", () => {
    const items = loadInbox();
    expect(items.map((i) => i.id)).toEqual(["01", "03", "04", "06", "90"]);
    expect((items[1].input as { invoice: { number: string } }).invoice.number).toBe("LBL-2026-1187");
    expect(items[3].erp_seed?.[0].number).toBe("BE-2026-0412");
    expect(items[4]).toMatchObject({ task: "audit", fixtures: ["01", "03", "04"] });
    expect(items[4].audit_items).toHaveLength(3);
  });
  it("bundled scenarios match the inbox files", () => {
    expect(scenarioItem("03")).toEqual(loadInbox().find((i) => i.id === "03"));
  });
});

// ---------------------------------------------------------------------------
describe("runAgent (scripted) against the real routes, simulated payments", () => {
  it("scenario 03: full trace, VAT anomaly flagged, entry posted for review, 0.15 USDC spent", async () => {
    const ledger = new MemorySpendLedger();
    const erp = new MemoryErp();
    const fetchImpl = makeFetch();
    const seen: string[] = [];
    const trace = await runAgent(opts(scenarioItem("03"), { ledger, erp, fetchImpl, onStep: (s) => seen.push(s.kind) }));

    expect(kinds(trace)).toEqual([
      "reasoning",
      "discovery",
      "discovery",
      "policy",
      "http_request",
      "http_response",
      "payment",
      "http_request",
      "http_response",
      "settlement",
      "erp",
      "review",
      "reasoning",
    ]);
    expect(seen).toEqual(kinds(trace));
    expect(fetchImpl.calls).toEqual(["GET /api/v1/catalog", "GET /api/health", "POST /api/v1/entry", "POST /api/v1/entry +sig"]);
    expect(trace).toMatchObject({ scenario: "03", mode: "SIMULATED", recorded_from: "simulated", outcome: "posted_with_review", service_url: BASE });
    expect(trace.agent.wallet).toBe(wallet.address);

    const r402 = trace.steps[5];
    expect(r402.http?.status).toBe(402);
    expect(r402.http?.decoded?.header).toBe("PAYMENT-REQUIRED");
    expect((r402.http?.decoded?.value as { accepts: { amount: string }[] }).accepts[0].amount).toBe("150000");
    expect((r402.data?.requirements_check as { ok: boolean }[]).every((c) => c.ok)).toBe(true);

    const paidReq = trace.steps[7];
    expect(paidReq.http?.headers["PAYMENT-SIGNATURE"]).toBeTruthy();
    expect(paidReq.http?.headers["Idempotency-Key"]).toBeTruthy();
    expect(paidReq.http?.decoded?.header).toBe("PAYMENT-SIGNATURE");
    expect(trace.steps[8].http?.status).toBe(200);
    expect(trace.steps[8].http?.decoded?.header).toBe("PAYMENT-RESPONSE");

    const settle = trace.steps[9].data!;
    expect(settle).toMatchObject({ simulated: true, amount_usdc: "0.15", explorer_url: null });
    expect(String(settle.tx_hash)).toMatch(/^0x5151[0-9a-f]{60}$/);

    expect(trace.steps[11].data?.review_reasons).toEqual(["VAT_RATE_MISMATCH"]);
    expect(trace.steps[11].detail).toContain("20%");

    const result = trace.result as { entry: { lines: { account: string }[] }; receipt: { tx_hash: string } };
    expect(result.entry.lines.map((l) => l.account)).toEqual(["6257", "44566", "401BOUCHON"]);
    expect(result.receipt.tx_hash).toBe(settle.tx_hash);

    const posted = await erp.list();
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ status: "posted_review_pending", reference: "LBL-2026-1187", total_debit: 175.2, total_credit: 175.2 });
    expect(await ledger.spentTodayAtomic()).toBe(150000n);

    // Never a private key in a trace; the payment signature is redacted in the decoded header.
    const s = JSON.stringify(trace);
    expect(s).not.toContain(AGENT_KEY.slice(2));
    expect(JSON.stringify(paidReq.http?.decoded)).toContain("(redacted)");
  });

  it("scenario 01 then 06 with the same ERP: 01 posted, 06 detected as a duplicate and kept as draft", async () => {
    const erp = new MemoryErp();
    const ledger = new MemorySpendLedger();
    const t1 = await runAgent(opts(scenarioItem("01"), { erp, ledger }));
    expect(t1.outcome).toBe("posted");
    expect(kinds(t1)).not.toContain("review");
    const t6 = await runAgent(opts(scenarioItem("06"), { erp, ledger }));
    expect(t6.outcome).toBe("posted_with_review");
    const review = t6.steps.find((s) => s.kind === "review")!;
    expect(review.data?.review_reasons).toEqual(["DUPLICATE_SUSPECTED"]);
    expect((await erp.list()).map((r) => r.status)).toEqual(["posted", "draft"]);
    expect(await ledger.spentTodayAtomic()).toBe(300000n);
  });

  it("scenario 04: reverse charge posted with no review", async () => {
    const t = await runAgent(opts(scenarioItem("04")));
    expect(t.outcome).toBe("posted");
    expect((t.result as { vat: { regime: string } }).vat.regime).toBe("reverse_charge_intra_eu");
  });

  it("refuses the 1.00 USDC audit (max per call 0.20): no paid call, nothing spent", async () => {
    const item = loadInbox().find((i) => i.id === "90")!;
    const ledger = new MemorySpendLedger();
    const fetchImpl = makeFetch();
    const t = await runAgent(opts(item, { ledger, fetchImpl }));
    expect(t.outcome).toBe("refused_by_policy");
    expect(kinds(t)).toEqual(["reasoning", "discovery", "discovery", "policy", "review"]);
    expect(t.steps[3].data).toMatchObject({ decision: "refuse", code: "PRICE_ABOVE_MAX_PER_CALL", price_usdc: "1.00" });
    expect(fetchImpl.calls.some((c) => c.startsWith("POST"))).toBe(false);
    expect(await ledger.spentTodayAtomic()).toBe(0n);
  });

  it("the same audit goes through with --max-per-call 1.00", async () => {
    const item = loadInbox().find((i) => i.id === "90")!;
    const t = await runAgent(opts(item, { policy: { max_per_call_usdc: "1.00", daily_budget_usdc: "2.00" } }));
    expect(["posted", "posted_with_review"]).toContain(t.outcome);
    expect(t.steps.find((s) => s.kind === "settlement")?.data?.amount_usdc).toBe("1.00");
  });

  it("refuses when the daily budget is exhausted", async () => {
    const ledger = new MemorySpendLedger();
    await ledger.record({ at: new Date().toISOString(), amount_atomic: "1950000", endpoint: "/api/v1/entry" });
    const t = await runAgent(opts(scenarioItem("01"), { ledger }));
    expect(t.outcome).toBe("refused_by_policy");
    expect(t.steps.find((s) => s.kind === "policy")?.data?.code).toBe("DAILY_BUDGET_EXCEEDED");
  });

  it("reads the price from the catalog and refuses when the 402 does not match it", async () => {
    const catalog = { endpoints: [{ method: "POST", path: "/api/v1/entry", price_usdc: "0.10" }], payment: { pay_to: PAY_TO } };
    const fetchImpl = makeFetch({ catalog });
    const t = await runAgent(opts(scenarioItem("01"), { fetchImpl }));
    expect(t.steps[1].title).toContain("catalog");
    expect(t.outcome).toBe("refused_by_policy");
    const refusal = t.steps.filter((s) => s.kind === "policy").at(-1)!;
    expect(refusal.data?.code).toBe("REQUIREMENTS_MISMATCH");
    expect(kinds(t)).not.toContain("payment");
  });

  it("payment refused by the facilitator (unfunded wallet) → outcome error, not charged", async () => {
    const ledger = new MemorySpendLedger();
    const t = await runAgent(opts(scenarioItem("01"), { ledger, fetchImpl: makeFetch({ failPaid: true }) }));
    expect(t.outcome).toBe("error");
    const err = t.steps.at(-1)!;
    expect(err.kind).toBe("error");
    expect(err.title).toContain("no test USDC");
    expect(await ledger.spentTodayAtomic()).toBe(0n);
  });

  it("unreachable service → outcome error with the steps so far (never throws)", async () => {
    const t = await runAgent(
      opts(scenarioItem("01"), {
        fetchImpl: (async () => {
          throw new Error("ECONNREFUSED");
        }) as typeof fetch,
      }),
    );
    expect(t.outcome).toBe("error");
    expect(t.steps[0].kind).toBe("reasoning");
    expect(t.steps.at(-1)!.kind).toBe("error");
  });

  it("llm reasoning without ANTHROPIC_API_KEY falls back to the scripted procedure", async () => {
    const t = await runAgent(opts(scenarioItem("01"), { reasoning: "llm" }));
    expect(t.outcome).toBe("posted");
    expect(t.steps[1].title).toContain("scripted");
  });

  it("sends the agent's company profile and its ERP history", async () => {
    const bodies: unknown[] = [];
    const base = makeFetch();
    const spy = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST" && typeof init.body === "string") bodies.push(JSON.parse(init.body));
      return base(input, init);
    }) as typeof fetch;
    const item = buildInboxItem({ id: "06", fixture: "06" }, "inbox/x.json", fsFixture());
    await runAgent(opts(item, { fetchImpl: spy }));
    expect(bodies[0]).toMatchObject({ profile: AGENT_COMPANY_PROFILE, history: [{ number: "BE-2026-0412" }] });
  });
});

// ---------------------------------------------------------------------------
describe("demo routes", () => {
  const post = (body: unknown) =>
    demoRunPOST(new NextRequest(`${BASE}/api/demo/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

  it("POST /api/demo/run rejects an unknown scenario", async () => {
    const res = await post({ scenario: "99" });
    expect(res.status).toBe(400);
  });

  it("POST /api/demo/run is rate limited per client IP (429 + Retry-After + fallback_hint replay)", async () => {
    process.env.DEMO_RUN_RATE_LIMIT_PER_MINUTE = "2";
    try {
      const run = (ip: string) =>
        demoRunPOST(
          new NextRequest(`${BASE}/api/demo/run`, {
            method: "POST",
            headers: { "content-type": "application/json", "cf-connecting-ip": ip },
            body: JSON.stringify({ scenario: "99" }),
          }),
        );
      expect((await run("203.0.113.5")).status).toBe(400);
      expect((await run("203.0.113.5")).status).toBe(400);
      const limited = await run("203.0.113.5");
      expect(limited.status).toBe(429);
      expect(limited.headers.get("Retry-After")).toBeTruthy();
      expect(await limited.json()).toMatchObject({ error: { code: "RATE_LIMITED" }, fallback_hint: "replay" });
      expect((await run("203.0.113.6")).status).toBe(400); // other client unaffected
    } finally {
      delete process.env.DEMO_RUN_RATE_LIMIT_PER_MINUTE;
    }
  });

  it("POST /api/demo/run runs the agent against the same deployment (ephemeral wallet in SIMULATED)", async () => {
    vi.stubGlobal("fetch", makeFetch());
    try {
      const res = await post({ scenario: "03", mode: "simulated" });
      expect(res.status).toBe(200);
      const t = await res.json();
      expect(t).toMatchObject({ scenario: "03", mode: "SIMULATED", outcome: "posted_with_review", service_url: BASE });
      expect(t.fallback_hint).toBeUndefined();
      expect(t.steps[0].data.wallet_note).toContain("ephemeral");
      expect(t.duration_ms).toBeLessThan(45_000);

      // The paid call landed in the store → operator stats come from it.
      const stats = await (await statsGET()).json();
      expect(stats).toMatchObject({ calls: 1, usdc_earned: "0.15", source: "memory" });
      expect(stats.by_endpoint.find((e: { endpoint: string }) => e.endpoint === "/api/v1/entry")).toMatchObject({ calls: 1, usdc: "0.15" });
      expect(stats.recent[0]).toMatchObject({ endpoint: "/api/v1/entry", amount: "0.15", mode: "simulated" });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("POST /api/demo/run returns 200 + outcome error + fallback_hint when the service is down", async () => {
    vi.stubGlobal("fetch", (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch);
    try {
      const t = await (await post({ scenario: "01" })).json();
      expect(t).toMatchObject({ outcome: "error", fallback_hint: "replay" });
      expect(t.steps.length).toBeGreaterThan(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("GET /api/demo/replays?scenario=03 returns a REPLAY trace; without scenario, the list", async () => {
    const one = await (await replaysGET(new NextRequest(`${BASE}/api/demo/replays?scenario=03`))).json();
    expect(one).toMatchObject({ scenario: "03", mode: "REPLAY" });
    expect(one.steps.length).toBeGreaterThan(3);
    const list = await (await replaysGET(new NextRequest(`${BASE}/api/demo/replays`))).json();
    expect(list.replays.map((r: { scenario: string }) => r.scenario)).toEqual(["01", "03", "04", "06"]);
    expect((await replaysGET(new NextRequest(`${BASE}/api/demo/replays?scenario=02`))).status).toBe(404);
  });

  it("GET /api/v1/operator/stats falls back to the replays when no call was served", async () => {
    const stats = await (await statsGET()).json();
    expect(stats.source).toBe("replay");
    expect(stats.calls).toBeGreaterThan(0);
    expect(stats.by_endpoint).toHaveLength(3);
  });
});
