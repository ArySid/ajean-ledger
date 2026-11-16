/**
 * npm run pay:credits [-- --pack starter|pro] [--calls 2] [--asset USDC|EURC] [--endpoint entry|check|audit]
 *                       [--url http://localhost:3000] [--testnet]
 *
 * Prepaid credits flow (ADR-025): buy a pack with ONE x402 payment → calls with X-Credit-Token →
 * balance → idempotent replay of the purchase. SIMULATED by default (no funds needed); --testnet
 * spends real Base Sepolia test USDC/EURC (the pack price) against a TESTNET server.
 */
import { loadEnv, runCreditsDemo } from "./pay-common";

loadEnv();
const testnet = process.argv.includes("--testnet");
runCreditsDemo(testnet ? "testnet" : "simulated").catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
