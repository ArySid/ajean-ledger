/**
 * npm run pay:simulated [-- --endpoint entry|check|audit] [--url http://localhost:3000]
 *
 * Full x402 v2 flow against a server started with PAYMENT_MODE=simulated (the default):
 * unpaid POST → 402 + PAYMENT-REQUIRED → signed EIP-3009 payment (@x402/fetch + ExactEvmScheme,
 * agent key from .env.local) → 200 + result + fake tx hash (0x5151…). Works offline; no funds needed.
 */
import { loadEnv, runPaymentDemo } from "./pay-common";

loadEnv();
runPaymentDemo("simulated").catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
