import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { x402Client } from "@x402/core/client";
import type { PaymentRequirements } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import {
  NETWORK_CAIP2,
  PAID_ENDPOINTS,
  PAID_ENDPOINT_LIST,
  USDC,
  atomicToUsdc,
  usdcToAtomic,
} from "@/lib/payments/pricing";
import { getPaymentMode, getPayTo, SIMULATED_FALLBACK_PAY_TO } from "@/lib/payments/config";
import { buildRouteConfig } from "@/lib/payments/server";
import {
  SimulatedFacilitatorClient,
  isSimulatedTxHash,
  resetSimulatedFacilitator,
  simulatedTxHash,
} from "@/lib/payments/simulated-facilitator";
import { buildReceipt } from "@/lib/payments/receipt";
import { MemoryStore, ResilientStore } from "@/lib/store";
import { FileStore } from "@/lib/store/file";
import type { ReceiptRecord, Store } from "@/lib/store";

const PAY_TO = privateKeyToAccount(generatePrivateKey()).address;

function requirements(amount = "150000", payTo: string = PAY_TO): PaymentRequirements {
  return {
    scheme: "exact",
    network: NETWORK_CAIP2,
    asset: USDC.address,
    amount,
    payTo,
    maxTimeoutSeconds: 300,
    extra: { name: "USDC", version: "2" },
  };
}

async function signPayment(req: PaymentRequirements) {
  const account = privateKeyToAccount(generatePrivateKey());
  const client = new x402Client().register("eip155:*", new ExactEvmScheme(account));
  const payload = await client.createPaymentPayload({ x402Version: 2, resource: { url: "http://test/api/v1/entry" }, accepts: [req] });
  return { account, payload };
}

describe("pricing (single source of truth)", () => {
  it("has consistent USDC and atomic prices", () => {
    expect(PAID_ENDPOINTS.invoice_check.price_atomic).toBe("50000");
    expect(PAID_ENDPOINTS.entry.price_atomic).toBe("150000");
    expect(PAID_ENDPOINTS.audit.price_atomic).toBe("1000000");
    for (const e of PAID_ENDPOINT_LIST) {
      expect(usdcToAtomic(e.price_usdc)).toBe(e.price_atomic);
      expect(atomicToUsdc(e.price_atomic)).toBe(e.price_usdc);
    }
    expect(PAID_ENDPOINT_LIST.map((e) => e.mcp_tool).sort()).toEqual(["audit_entries", "check_invoice", "create_entry"]);
  });

  it("formats atomic amounts", () => {
    expect(atomicToUsdc("1")).toBe("0.000001");
    expect(atomicToUsdc("1200000")).toBe("1.20");
    expect(atomicToUsdc(0n)).toBe("0.00");
  });
});

describe("payment config", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("defaults to simulated mode", () => {
    delete process.env.PAYMENT_MODE;
    expect(getPaymentMode()).toBe("simulated");
    process.env.PAYMENT_MODE = "TESTNET";
    expect(getPaymentMode()).toBe("testnet");
    process.env.PAYMENT_MODE = "mainnet";
    expect(getPaymentMode()).toBe("simulated");
  });

  it("requires a real payTo in testnet mode only", () => {
    process.env.SERVICE_PAY_TO_ADDRESS = "0x0000000000000000000000000000000000000000";
    expect(getPayTo("testnet")).toBeNull();
    expect(getPayTo("simulated")).toBe(SIMULATED_FALLBACK_PAY_TO);
    expect(buildRouteConfig("entry", "testnet")).toBeNull();
    process.env.SERVICE_PAY_TO_ADDRESS = PAY_TO;
    expect(getPayTo("testnet")).toBe(PAY_TO);
  });

  it("builds the x402 route config from pricing.ts", () => {
    process.env.SERVICE_PAY_TO_ADDRESS = PAY_TO;
    const cfg = buildRouteConfig("audit", "simulated")!;
    expect(cfg.accepts).toMatchObject({
      scheme: "exact",
      network: "eip155:84532",
      payTo: PAY_TO,
      price: { asset: USDC.address, amount: "1000000", extra: { name: "USDC", version: "2" } },
    });
    expect(cfg.mimeType).toBe("application/json");
  });
});

describe("simulated facilitator", () => {
  const fac = new SimulatedFacilitatorClient();
  beforeEach(() => resetSimulatedFacilitator());

  it("advertises exact on Base Sepolia", async () => {
    const s = await fac.getSupported();
    expect(s.kinds).toEqual([{ x402Version: 2, scheme: "exact", network: "eip155:84532" }]);
  });

  it("verifies a real EIP-3009 signature and settles with a deterministic fake tx hash", async () => {
    const req = requirements();
    const { account, payload } = await signPayment(req);
    const v = await fac.verify(payload, req);
    expect(v).toEqual({ isValid: true, payer: account.address });

    const expected = simulatedTxHash(payload);
    expect(simulatedTxHash(payload)).toBe(expected);
    expect(isSimulatedTxHash(expected)).toBe(true);
    expect(expected).toMatch(/^0x5151[0-9a-f]{60}$/);

    const s = await fac.settle(payload, req);
    expect(s).toMatchObject({ success: true, transaction: expected, network: "eip155:84532", payer: account.address, amount: "150000" });

    // Same authorization cannot be settled twice (nonce consumed).
    const again = await fac.settle(payload, req);
    expect(again.success).toBe(false);
    expect(again.errorReason).toBe("invalid_exact_evm_nonce_already_used");
  });

  it("rejects wrong amount, wrong recipient, tampered signature and malformed payloads", async () => {
    const req = requirements();
    const { payload } = await signPayment(req);
    expect((await fac.verify(payload, requirements("50000"))).invalidReason).toBe(
      "invalid_exact_evm_payload_authorization_value_mismatch",
    );
    expect((await fac.verify(payload, requirements("150000", SIMULATED_FALLBACK_PAY_TO))).invalidReason).toBe(
      "invalid_exact_evm_recipient_mismatch",
    );
    const auth = (payload.payload as { authorization: Record<string, string> }).authorization;
    const tampered = { ...payload, payload: { ...payload.payload, authorization: { ...auth, validBefore: String(Number(auth.validBefore) + 1) } } };
    expect((await fac.verify(tampered, req)).invalidReason).toBe("invalid_exact_evm_signature");
    expect((await fac.verify({ ...payload, payload: {} }, req)).invalidReason).toBe("invalid_exact_evm_payload");
  });
});

describe("receipt", () => {
  it("labels simulated receipts and links testnet ones to the explorer", () => {
    const sim = buildReceipt({
      endpoint: "entry",
      settle: { success: true, transaction: "0x5151" + "a".repeat(60), network: "eip155:84532", payer: PAY_TO },
      payTo: PAY_TO,
      mode: "simulated",
    });
    expect(sim).toMatchObject({ amount: "0.15", amount_atomic: "150000", asset: "USDC", network: "base-sepolia", network_caip2: "eip155:84532", explorer_url: null, mode: "simulated" });
    const tx = "0x" + "b".repeat(64);
    const real = buildReceipt({ endpoint: "audit", settle: { success: true, transaction: tx, network: "eip155:84532" }, payTo: PAY_TO, mode: "testnet" });
    expect(real.amount).toBe("1.00");
    expect(real.explorer_url).toBe(`https://sepolia.basescan.org/tx/${tx}`);
  });
});

function record(id: string, endpoint: ReceiptRecord["endpoint"], atomic: string, key: string | null = null): ReceiptRecord {
  return {
    request_id: id,
    endpoint,
    idempotency_key: key,
    request_hash: "h",
    receipt: buildReceipt({
      endpoint,
      settle: { success: true, transaction: "0x5151" + "0".repeat(60), network: "eip155:84532", amount: atomic },
      payTo: PAY_TO,
      mode: "simulated",
    }),
    result: { ok: true },
    payment_response: null,
    created_at: new Date().toISOString(),
  };
}

async function exerciseStore(store: Store) {
  await store.saveReceipt(record("req_1", "entry", "150000", "k1"));
  await store.saveReceipt(record("req_2", "audit", "1000000"));
  expect((await store.getReceipt("req_1"))?.endpoint).toBe("entry");
  expect((await store.getByIdempotencyKey("k1"))?.request_id).toBe("req_1");
  expect(await store.getReceipt("nope")).toBeNull();
  expect((await store.listRecent(1)).map((r) => r.request_id)).toEqual(["req_2"]);
  const stats = await store.stats();
  expect(stats.calls_served).toBe(2);
  expect(stats.usdc_earned).toBe("1.15");
  expect(stats.revenue_per_endpoint.entry).toEqual({ calls: 1, usdc: "0.15", usdc_atomic: "150000" });
  expect(stats.revenue_per_endpoint.invoice_check.calls).toBe(0);
  expect(stats.by_mode.simulated.calls).toBe(2);
  expect(stats.recent_transactions[0].request_id).toBe("req_2");
  const fp = { supplier_key: "123456789", number: "F-1", issue_date: "2026-11-01", total_incl_vat: 120 };
  await store.saveFingerprint("999999999", fp);
  await store.saveFingerprint("999999999", fp);
  expect(await store.history("999999999")).toEqual([fp]);
  expect(await store.history("other")).toEqual([]);
}

describe("store", () => {
  it("memory store", async () => {
    await exerciseStore(new MemoryStore());
  });

  it("file store", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "ajean-store-"));
    try {
      await exerciseStore(new FileStore(path.join(dir, "receipts.local.json")));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falls back to memory when the primary store fails, and logs once", async () => {
    const boom = () => Promise.reject(new Error("db down"));
    const broken: Store = {
      kind: "neon",
      saveReceipt: boom,
      getReceipt: boom,
      getByIdempotencyKey: boom,
      listRecent: boom,
      stats: boom,
      saveFingerprint: boom,
      history: boom,
    };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = new ResilientStore(broken);
    expect(store.kind).toBe("neon");
    await exerciseStore(store);
    expect(store.kind).toBe("memory");
    expect(store.degraded).toBe(true);
    expect(err).toHaveBeenCalledTimes(1);
    err.mockRestore();
  });
});
