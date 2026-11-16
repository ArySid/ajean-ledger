/**
 * npm run pay:testnet [-- --endpoint entry|check|audit] [--url http://localhost:3000]
 *
 * REAL x402 payment on Base Sepolia (test USDC, testnet only) against a server started with
 * PAYMENT_MODE=testnet. First checks the agent's USDC balance; the agent needs test USDC only
 * (no ETH: the facilitator pays gas, ADR-007). Prints the tx hash and the Basescan link.
 */
import { createPublicClient, erc20Abi, formatUnits, http } from "viem";
import { baseSepolia } from "viem/chains";
import { PAID_ENDPOINTS, USDC } from "../lib/payments/pricing";
import { agentAccount, die, endpointFromArgs, loadEnv, runPaymentDemo } from "./pay-common";

loadEnv();

async function main() {
  const account = agentAccount();
  const endpoint = PAID_ENDPOINTS[endpointFromArgs()];
  const rpc = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
  const client = createPublicClient({ chain: baseSepolia, transport: http(rpc) });
  let balance: bigint;
  try {
    balance = await client.readContract({ address: USDC.address, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
  } catch (e) {
    die(`Could not read the USDC balance on Base Sepolia via ${rpc}: ${(e as Error).message}`);
  }
  console.log(`Agent ${account.address} — test USDC balance on Base Sepolia: ${formatUnits(balance, USDC.decimals)} USDC (needs ${endpoint.price_usdc})`);
  if (balance < BigInt(endpoint.price_atomic)) {
    die(
      `Not enough test USDC. Fund the agent at https://faucet.circle.com (network: Base Sepolia, address ${account.address}), then re-run npm run pay:testnet.`,
      3,
    );
  }
  await runPaymentDemo("testnet");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
