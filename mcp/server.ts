/**
 * Ajean Ledger — stdio MCP server for Claude Desktop (and any stdio MCP client).
 *
 *   npm run mcp:stdio                    # = tsx mcp/server.ts
 *   npx tsx /abs/path/ajean-ledger/mcp/server.ts
 *
 * Env (testnet only, never a mainnet key):
 *   AJEAN_LEDGER_URL          API base URL (default http://localhost:3000)
 *   AGENT_PRIVATE_KEY         0x… throwaway Base Sepolia wallet that pays (needed for paid tools only)
 *   AGENT_MAX_PER_CALL_USDC   max price per call (default 0.20)
 *   AGENT_DAILY_BUDGET_USDC   max spend per UTC day (default 2.00)
 *   AGENT_SPEND_LEDGER_FILE   optional JSON file that keeps the daily spend across restarts
 *   AJEAN_PAY_ASSET           USDC (default) | EURC — asset to pay x402 calls with (EURC budgeted at its USDC value)
 *   AJEAN_CREDIT_TOKEN        optional prepaid credit token (ajc_…, POST /api/v1/credits): tried before x402
 *   AJEAN_MCP_DOTENV=0        do not read <repo>/.env.local (read by default; never overrides set vars)
 *
 * stdout carries MCP JSON-RPC only: every log goes to stderr.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { privateKeyToAccount } from "viem/accounts";
import { createBridgeServer } from "./bridge";
import { SpendingPolicy, policyFromEnv } from "./policy";

// Keep stdout pure MCP: route any stray console output to stderr.
console.log = (...a: unknown[]) => console.error(...a);
console.info = (...a: unknown[]) => console.error(...a);
console.debug = (...a: unknown[]) => console.error(...a);

const log = (m: string) => console.error(`[ajean-mcp] ${m}`);

function loadDotenv(): void {
  if (process.env.AJEAN_MCP_DOTENV === "0") return;
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  for (const f of [".env.local", ".env"]) {
    const p = path.join(root, f);
    try {
      if (existsSync(p)) process.loadEnvFile(p); // does not override variables already set
    } catch {
      /* ignore */
    }
  }
}

async function main(): Promise<void> {
  loadDotenv();
  const baseUrl = (process.env.AJEAN_LEDGER_URL?.trim() || "http://localhost:3000").replace(/\/$/, "");
  const key = process.env.AGENT_PRIVATE_KEY?.trim();
  let account = null;
  if (key && /^0x[0-9a-fA-F]{64}$/.test(key)) account = privateKeyToAccount(key as `0x${string}`);
  else if (key) log("AGENT_PRIVATE_KEY is set but malformed (expected 0x + 64 hex): paid tools disabled.");
  else log("AGENT_PRIVATE_KEY not set: paid tools will refuse to pay (free tools still work).");

  const policy = new SpendingPolicy(policyFromEnv());
  const preferAsset = process.env.AJEAN_PAY_ASSET?.trim().toUpperCase() === "EURC" ? "EURC" : "USDC";
  const creditToken = process.env.AJEAN_CREDIT_TOKEN?.trim() || null;
  const server = createBridgeServer({ baseUrl, account, policy, log, preferAsset, creditToken });
  await server.connect(new StdioServerTransport());
  const s = policy.summary();
  log(
    `ready: API ${baseUrl}, agent wallet ${account ? account.address : "none"}, pays in ${preferAsset}${creditToken ? " (prepaid credit token first)" : ""}, policy max/call ${s.max_per_call_usdc} USDC, daily budget ${s.daily_budget_usdc} USDC (spent today ${s.spent_today_usdc}).`,
  );
}

main().catch((e) => {
  log(`fatal: ${(e as Error).message}`);
  process.exit(1);
});
