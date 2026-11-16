/**
 * npm run smoke [-- --url http://localhost:3000]
 * No payment: checks /api/health, the 402 + PAYMENT-REQUIRED of every paid endpoint
 * (amount / payTo / asset / network from lib/payments/pricing.ts) and the receipts 404.
 */
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { NETWORK_CAIP2, PAID_ENDPOINT_LIST, USDC } from "../lib/payments/pricing";
import { baseUrl, health, loadEnv } from "./pay-common";

loadEnv();

async function main() {
  const url = baseUrl();
  let failures = 0;
  const check = (ok: boolean, label: string) => {
    console.log(`${ok ? "✔" : "✖"} ${label}`);
    if (!ok) failures++;
  };
  const hs = await health(url);
  check(true, `health: mode=${hs.mode} payTo=${hs.pay_to} engine_ready=${hs.engine_ready}`);
  for (const e of PAID_ENDPOINT_LIST) {
    const res = await fetch(`${url}${e.path}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const header = res.headers.get("PAYMENT-REQUIRED");
    const a = header ? decodePaymentRequiredHeader(header).accepts[0] : undefined;
    check(
      res.status === 402 && !!a && a.amount === e.price_atomic && a.network === NETWORK_CAIP2 && a.asset === USDC.address && a.payTo === hs.pay_to,
      `${e.path} → ${res.status} amount=${a?.amount} (${e.price_usdc} USDC) network=${a?.network}`,
    );
  }
  const r = await fetch(`${url}/api/v1/receipts/req_00000000000000000000000000`);
  check(r.status === 404, `receipts unknown id → ${r.status}`);
  if (failures) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\nsmoke OK");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
