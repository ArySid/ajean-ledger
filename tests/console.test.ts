import { describe, expect, it } from "vitest";
import { decodeBase64Json, decodedHeaders, isSimulatedTx, resultRevealIndex, stepHighlights, txExplorerUrl } from "@/lib/console/format";
import { allBundledReplays, BUNDLED_REPLAYS } from "@/lib/console/replays";
import { SCENARIOS } from "@/lib/console/scenarios";
import { extractTrace, fetchServerMode, isAgentTrace, LIVE_FAILED_NOTICE, loadReplay, runScenario } from "@/lib/console/source";
import { MODE_INFO, MODE_ORDER } from "@/lib/console/modes";
import { loadOperatorStats, normaliseStats, statsFromReplays } from "@/lib/console/stats";
import path from "node:path";
import { createEntry } from "@/engine";
import type { EntryResult } from "@/engine/types";
import { loadFixture } from "@/fixtures/loader";

const failingFetch = (async () => {
  throw new Error("network down");
}) as unknown as typeof fetch;

const jsonFetch = (routes: Record<string, unknown>) =>
  (async (url: string) => {
    const path = new URL(url, "http://x").pathname;
    if (!(path in routes)) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(routes[path]), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;

describe("bundled replays", () => {
  it("exist for every console scenario and are valid traces", () => {
    for (const s of SCENARIOS) {
      const t = BUNDLED_REPLAYS[s.id];
      expect(isAgentTrace(t)).toBe(true);
      expect(t.scenario).toBe(s.id);
      expect(t.mode).toBe("REPLAY");
    }
  });

  it("are accounting-correct: balanced entries with 2-decimal amounts", () => {
    for (const t of allBundledReplays()) {
      const r = t.result as EntryResult;
      const d = r.entry.lines.reduce((s, l) => s + l.debit, 0);
      const c = r.entry.lines.reduce((s, l) => s + l.credit, 0);
      expect(Math.abs(d - c)).toBeLessThan(0.001);
      expect(r.entry.balanced).toBe(true);
      expect(Math.abs(d - r.invoice.totals.total_incl_vat - (r.vat.regime === "reverse_charge_intra_eu" ? r.vat.breakdown[0].vat : 0))).toBeLessThan(0.001);
    }
  });

  it("match what the engine computes for each scenario's fixture (no hand-written samples)", async () => {
    const lines = (r: EntryResult) => r.entry.lines.map((l) => ({ account: l.account, debit: l.debit, credit: l.credit }));
    for (const s of SCENARIOS) {
      const replay = BUNDLED_REPLAYS[s.id].result as EntryResult;
      const fx = loadFixture(path.resolve(__dirname, `../fixtures/${s.id}.json`));
      const engine = await createEntry(fx.input, fx.context ?? {});
      // Structure of the §5.4 contract.
      for (const k of ["invoice", "compliance", "entry", "vat", "anomalies", "confidence", "human_review_required", "explanation", "engine", "disclaimer"]) {
        expect(replay, `${s.id}.${k}`).toHaveProperty(k);
      }
      // Accounts and amounts are the ones the engine computes today.
      expect(lines(replay), s.id).toEqual(lines(engine));
      expect(replay.entry.journal).toBe(engine.entry.journal);
      expect(replay.vat.regime).toBe(engine.vat.regime);
      expect(replay.vat.legal_basis_id).toBe(engine.vat.legal_basis_id);
      expect(replay.compliance.status).toBe(engine.compliance.status);
      expect(replay.human_review_required).toBe(engine.human_review_required);
      expect([...new Set(replay.anomalies.map((a) => a.code))].sort()).toEqual([...new Set(engine.anomalies.map((a) => a.code))].sort());
      expect(replay.invoice.supplier.siren ?? "000").toMatch(/^000/);
      expect(replay.invoice.customer.siren ?? "000").toMatch(/^000/);
    }
    // The story the console tells, derived from the engine output above.
    const r = (id: "01" | "03" | "04" | "06") => BUNDLED_REPLAYS[id].result as EntryResult;
    expect(r("01").human_review_required).toBe(false);
    expect(r("03").anomalies.map((a) => a.code)).toContain("VAT_RATE_MISMATCH");
    expect(r("04").vat.regime).toBe("reverse_charge_intra_eu");
    expect(r("06").anomalies.map((a) => a.code)).toContain("DUPLICATE_SUSPECTED");
  });

  it("carry a decodable x402 flow: 402 PAYMENT-REQUIRED, PAYMENT-SIGNATURE, PAYMENT-RESPONSE", () => {
    const t = BUNDLED_REPLAYS["03"];
    const r402 = t.steps.find((s) => s.http?.status === 402)!;
    const pr = decodeBase64Json(r402.http!.headers["PAYMENT-REQUIRED"]) as { x402Version: number; accepts: { amount: string; network: string }[] };
    expect(pr.x402Version).toBe(2);
    expect(pr.accepts[0]).toMatchObject({ amount: "150000", network: "eip155:84532" });
    expect(stepHighlights(r402)[0]).toMatchObject({ label: "price", value: "0.15 USDC" });
    const paid = t.steps.find((s) => s.http?.headers?.["PAYMENT-SIGNATURE"])!;
    expect(decodedHeaders(paid.http!).map((d) => d.header)).toContain("PAYMENT-SIGNATURE");
    const idx = resultRevealIndex(t.steps);
    expect(t.steps[idx].http?.status).toBe(200);
  });

  it("receipts match the mode they were recorded in (simulated: no explorer link; testnet: Basescan link)", () => {
    // Holds before and after `npm run record:replays -- --public` against the TESTNET deployment.
    for (const t of allBundledReplays()) {
      const r = (t.result as { receipt: Parameters<typeof isSimulatedTx>[0] }).receipt;
      if (t.recorded_from === "testnet") {
        expect(isSimulatedTx(r), t.scenario).toBe(false);
        expect(txExplorerUrl(r), t.scenario).toBe(`https://sepolia.basescan.org/tx/${r?.tx_hash}`);
      } else {
        expect(isSimulatedTx(r), t.scenario).toBe(true);
        expect(txExplorerUrl(r), t.scenario).toBeNull();
      }
    }
    const real = { tx_hash: "0x" + "ab".repeat(32), mode: "testnet" as const, explorer_url: null };
    expect(txExplorerUrl(real)).toBe(`https://sepolia.basescan.org/tx/${real.tx_hash}`);
  });
});

describe("source fallback ladder", () => {
  it("falls back to the bundled replay with a visible notice when the live call fails", async () => {
    const out = await runScenario("03", "testnet", { fetchImpl: failingFetch });
    expect(out.origin).toBe("replay-bundled");
    expect(out.notice).toBe(LIVE_FAILED_NOTICE);
    expect(out.trace.mode).toBe("REPLAY");
    expect(out.error).toContain("network down");
  });

  it("falls back on timeout", async () => {
    const slow = ((_: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as unknown as typeof fetch;
    const out = await runScenario("01", "simulated", { fetchImpl: slow, liveTimeoutMs: 30, replayTimeoutMs: 30 });
    expect(out.origin).toBe("replay-bundled");
    expect(out.error).toContain("timeout");
  });

  it("uses the replay API when it answers, before the bundled file", async () => {
    const served = { ...BUNDLED_REPLAYS["04"], id: "from-api" };
    const out = await runScenario("04", "testnet", { fetchImpl: jsonFetch({ "/api/demo/replays": served }) });
    expect(out.origin).toBe("replay-api");
    expect(out.trace.id).toBe("from-api");
    expect(out.notice).toBe(LIVE_FAILED_NOTICE);
  });

  it("returns the live trace when /api/demo/run succeeds", async () => {
    const live = { ...BUNDLED_REPLAYS["01"], id: "live-1", mode: "TESTNET" };
    const out = await runScenario("01", "testnet", { fetchImpl: jsonFetch({ "/api/demo/run": live }) });
    expect(out.origin).toBe("live");
    expect(out.trace.mode).toBe("TESTNET");
    expect(out.notice).toBeUndefined();
  });

  it("rejects malformed live payloads", async () => {
    const out = await runScenario("06", "testnet", { fetchImpl: jsonFetch({ "/api/demo/run": { hello: "world" } }) });
    expect(out.origin).toBe("replay-bundled");
    expect(out.error).toContain("malformed");
  });

  it("falls back to REPLAY when the live run answers 5xx (e.g. Cloudflare 1102 CPU limit → 503)", async () => {
    const f = (async (url: string) => {
      const p = new URL(url, "http://x").pathname;
      if (p === "/api/demo/run") return new Response("error code: 1102", { status: 503 });
      return new Response("down", { status: 500 });
    }) as unknown as typeof fetch;
    const out = await runScenario("03", "testnet", { fetchImpl: f });
    expect(out.origin).toBe("replay-bundled");
    expect(out.trace.mode).toBe("REPLAY");
    expect(out.notice).toBe(LIVE_FAILED_NOTICE);
    expect(out.error).toContain("HTTP 503");
  });

  it("falls back to REPLAY when the agent run itself ends in error (e.g. unfunded wallet, 429 DEMO_BUSY)", async () => {
    const errored = { ...BUNDLED_REPLAYS["03"], outcome: "error", fallback_hint: "replay" };
    const out = await runScenario("03", "testnet", { fetchImpl: jsonFetch({ "/api/demo/run": errored }) });
    expect(out.origin).toBe("replay-bundled");
    expect(out.error).toContain("ended in error");
    const busy = (async () => new Response(JSON.stringify({ error: { code: "DEMO_BUSY" } }), { status: 429 })) as unknown as typeof fetch;
    expect((await runScenario("01", "simulated", { fetchImpl: busy })).trace.mode).toBe("REPLAY");
  });

  it("loadReplay never throws and accepts {trace} wrappers", async () => {
    expect((await loadReplay("06", { fetchImpl: failingFetch })).origin).toBe("replay-bundled");
    expect(extractTrace({ trace: BUNDLED_REPLAYS["06"] }, "06")?.scenario).toBe("06");
    expect(extractTrace([BUNDLED_REPLAYS["01"], BUNDLED_REPLAYS["06"]], "06")?.scenario).toBe("06");
  });
});

describe("operator stats", () => {
  it("computes stats from replays", () => {
    const s = statsFromReplays();
    expect(s.calls).toBe(4);
    expect(s.usdc_earned).toBeCloseTo(0.6, 6);
    expect(s.review_required).toBe(2);
    expect(s.by_endpoint.map((e) => e.endpoint)).toEqual(["/api/v1/invoice/check", "/api/v1/entry", "/api/v1/audit"]);
    expect(s.source).toBe("replay");
  });

  it("normalises the documented console shape and the store shape", () => {
    const a = normaliseStats({
      calls: 3,
      usdc_earned: "1.30",
      by_endpoint: [{ endpoint: "/api/v1/audit", calls: 1, usdc: "1.00" }],
      recent: [{ request_id: "req_1", at: "2026-11-16T10:00:00Z", endpoint: "/api/v1/audit", payer: "0x1", amount: "1.00", tx_hash: "0xabc", explorer_url: null, mode: "testnet" }],
      source: "neon",
    })!;
    expect(a.calls).toBe(3);
    expect(a.usdc_earned).toBeCloseTo(1.3);
    expect(a.by_endpoint.find((e) => e.endpoint === "/api/v1/audit")?.usdc).toBe(1);
    const b = normaliseStats({
      store: "memory",
      calls_served: 2,
      usdc_earned: "0.20",
      revenue_per_endpoint: { invoice_check: { calls: 1, usdc: "0.05" }, entry: { calls: 1, usdc: "0.15" }, audit: { calls: 0, usdc: "0.00" } },
      recent_transactions: [{ request_id: "req_2", endpoint: "entry", amount: "0.15", tx_hash: "0x5151", payer: null, mode: "simulated", explorer_url: null, paid_at: "2026-11-16T10:00:00Z" }],
    })!;
    expect(b.source).toBe("memory");
    expect(b.recent[0].endpoint).toBe("/api/v1/entry");
    expect(b.by_endpoint.find((e) => e.endpoint === "/api/v1/entry")?.calls).toBe(1);
  });

  it("falls back to replays when the stats API fails or has no traffic", async () => {
    expect((await loadOperatorStats({ fetchImpl: failingFetch })).fallback).toBe(true);
    const empty = await loadOperatorStats({ fetchImpl: jsonFetch({ "/api/v1/operator/stats": { calls: 0, usdc_earned: "0", by_endpoint: [], recent: [], source: "memory" } }) });
    expect(empty.fallback).toBe(true);
    expect(empty.stats.calls).toBe(4);
  });
});

describe("mode legend and server mode", () => {
  it("explains every console mode (TESTNET / SIMULATED / REPLAY)", () => {
    expect(MODE_ORDER).toEqual(["TESTNET", "SIMULATED", "REPLAY"]);
    for (const m of MODE_ORDER) {
      expect(MODE_INFO[m].mode).toBe(m);
      expect(MODE_INFO[m].long.length).toBeGreaterThan(60);
    }
    expect(MODE_INFO.SIMULATED.long).toMatch(/fake/);
    expect(MODE_INFO.REPLAY.long).toMatch(/recorded/);
  });

  it("reads the deployment's payment mode from /api/health, null when unreachable", async () => {
    expect(await fetchServerMode({ fetchImpl: jsonFetch({ "/api/health": { payment: { mode: "testnet" } } }) })).toBe("testnet");
    expect(await fetchServerMode({ fetchImpl: jsonFetch({ "/api/health": { payment: { mode: "simulated" } } }) })).toBe("simulated");
    expect(await fetchServerMode({ fetchImpl: jsonFetch({ "/api/health": { payment: { mode: "weird" } } }) })).toBeNull();
    expect(await fetchServerMode({ fetchImpl: failingFetch })).toBeNull();
  });
});
