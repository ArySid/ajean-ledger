/**
 * End-to-end MCP check against a running Ajean Ledger (simulated mode recommended):
 *   AJEAN_LEDGER_URL=http://localhost:3400 npx tsx scripts/mcp-check.ts
 *
 * 1. Remote /mcp (Streamable HTTP): tools/list, unpaid create_entry → x402 PaymentRequired,
 *    paid create_entry via @x402/mcp createx402MCPClient → result + receipt, get_receipt.
 * 2. Stdio bridge (mcp/server.ts spawned with tsx): tools/list, create_entry paid through the HTTP
 *    API with @x402/fetch, then a spending-policy refusal (audit_entries above max per call).
 *
 * Uses AGENT_PRIVATE_KEY from the env/.env.local, or a fresh throwaway key (fine in simulated mode).
 * Never prints keys. Exit code 0 = all checks passed.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createx402MCPClient } from "@x402/mcp";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { NETWORK_CAIP2, PAID_ENDPOINTS } from "../lib/payments/pricing";
import { EXAMPLE_REQUESTS } from "../lib/discovery/examples";

for (const f of [".env.local", ".env"]) if (existsSync(f)) process.loadEnvFile(f);
const URL_BASE = (process.env.AJEAN_LEDGER_URL ?? "http://localhost:3000").replace(/\/$/, "");
const envKey = process.env.AGENT_PRIVATE_KEY?.trim();
const KEY = (envKey && /^0x[0-9a-fA-F]{64}$/.test(envKey) ? envKey : generatePrivateKey()) as `0x${string}`;
const account = privateKeyToAccount(KEY);

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures++;
}
const text0 = (r: unknown) => (((r as { content?: unknown }).content as { type: string; text?: string }[] | undefined)?.[0]?.text ?? "");
const json0 = (r: unknown) => {
  try {
    return JSON.parse(text0(r)) as Record<string, unknown>;
  } catch {
    return {};
  }
};

async function remote() {
  console.log(`\n== Remote MCP ${URL_BASE}/mcp ==`);
  const client = new Client({ name: "mcp-check", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${URL_BASE}/mcp`)));
  const tools = (await client.listTools()).tools.map((t) => t.name).sort();
  check("tools/list", ["audit_entries", "check_invoice", "create_entry", "get_catalog", "get_receipt"].every((n) => tools.includes(n)), tools.join(", "));
  const desc = (await client.listTools()).tools.find((t) => t.name === "create_entry")?.description ?? "";
  check("create_entry description states the price", desc.includes(`${PAID_ENDPOINTS.entry.price_usdc} USDC`));

  const unpaid = await client.callTool({ name: "create_entry", arguments: EXAMPLE_REQUESTS.entry });
  const pr = (unpaid.structuredContent ?? json0(unpaid)) as { x402Version?: number; accepts?: { amount: string; network: string; payTo: string }[] };
  check(
    "unpaid create_entry → x402 PaymentRequired",
    unpaid.isError === true && pr.x402Version === 2 && pr.accepts?.[0]?.amount === PAID_ENDPOINTS.entry.price_atomic,
    `amount=${pr.accepts?.[0]?.amount} network=${pr.accepts?.[0]?.network} payTo=${pr.accepts?.[0]?.payTo}`,
  );
  const catalog = await client.callTool({ name: "get_catalog", arguments: {} });
  check("get_catalog (free)", !catalog.isError && (json0(catalog).service as string) === "Ajean Ledger");
  await client.close();

  const payer = createx402MCPClient({
    name: "mcp-check-payer",
    version: "1.0.0",
    schemes: [{ network: NETWORK_CAIP2, client: new ExactEvmScheme(account) }],
    autoPayment: true,
    spendControls: { maxAmountPerPayment: false },
    onPaymentRequested: async ({ paymentRequired }) => BigInt(paymentRequired.accepts[0].amount) <= 200000n,
  });
  await payer.connect(new StreamableHTTPClientTransport(new URL(`${URL_BASE}/mcp`)));
  const paid = await payer.callTool("create_entry", EXAMPLE_REQUESTS.entry);
  const body = json0(paid) as { request_id?: string; receipt?: { tx_hash?: string; mode?: string; amount?: string }; entry?: { balanced?: boolean; lines?: { account: string }[] } };
  check(
    "paid create_entry via @x402/mcp",
    !paid.isError && paid.paymentMade && !!body.receipt?.tx_hash && body.entry?.balanced === true,
    `request_id=${body.request_id} paid=${body.receipt?.amount} ${body.receipt?.mode} tx=${body.receipt?.tx_hash?.slice(0, 18)}… accounts=${body.entry?.lines?.map((l) => l.account).join("/")}`,
  );
  check("settlement in _meta['x402/payment-response']", paid.paymentResponse?.success === true, `tx=${paid.paymentResponse?.transaction?.slice(0, 18)}…`);
  if (body.request_id) {
    const rec = await payer.callTool("get_receipt", { request_id: body.request_id });
    check("get_receipt (free) finds the MCP payment", !rec.isError && (json0(rec).request_id as string) === body.request_id);
  }
  await payer.close();
}

async function stdio() {
  console.log("\n== Stdio bridge (mcp/server.ts) ==");
  const tsx = path.resolve("node_modules/.bin/tsx");
  const client = new Client({ name: "mcp-check-stdio", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: tsx,
    args: [path.resolve("mcp/server.ts")],
    env: {
      PATH: process.env.PATH ?? "",
      AJEAN_LEDGER_URL: URL_BASE,
      AGENT_PRIVATE_KEY: KEY,
      AGENT_MAX_PER_CALL_USDC: "0.20",
      AGENT_DAILY_BUDGET_USDC: "0.40",
      AJEAN_MCP_DOTENV: "0",
    },
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (d) => (stderr += String(d)));
  await client.connect(transport);
  const tools = (await client.listTools()).tools.map((t) => t.name).sort();
  check("tools/list", tools.length === 5, tools.join(", "));

  const r = await client.callTool({ name: "create_entry", arguments: EXAMPLE_REQUESTS.entry });
  const b = (r.structuredContent ?? json0(r)) as { request_id?: string; receipt?: { tx_hash?: string; mode?: string; amount?: string }; entry?: { balanced?: boolean } };
  check("create_entry paid by the bridge via x402", !r.isError && !!b.receipt?.tx_hash && b.entry?.balanced === true, `paid=${b.receipt?.amount} ${b.receipt?.mode} tx=${b.receipt?.tx_hash?.slice(0, 18)}…`);

  const a = await client.callTool({ name: "audit_entries", arguments: EXAMPLE_REQUESTS.audit });
  check("audit_entries (1.00 USDC) refused by max-per-call 0.20", a.isError === true && text0(a).includes("SPENDING_POLICY_REFUSED"));

  const second = await client.callTool({ name: "create_entry", arguments: EXAMPLE_REQUESTS.entry });
  const third = await client.callTool({ name: "create_entry", arguments: EXAMPLE_REQUESTS.entry });
  check("daily budget 0.40: 2nd call paid, 3rd refused", !second.isError && third.isError === true && text0(third).includes("daily budget"));
  await client.close();
  check("bridge never logs the private key", !stderr.includes(KEY.slice(2)));
}

(async () => {
  try {
    const h = await fetch(`${URL_BASE}/api/health`).then((r) => r.json() as Promise<{ payment: { mode: string } }>);
    console.log(`server ${URL_BASE} mode=${h.payment.mode} agent=${account.address}`);
  } catch (e) {
    console.error(`Cannot reach ${URL_BASE}: ${(e as Error).message}. Start the server: PAYMENT_MODE=simulated npm run dev`);
    process.exit(1);
  }
  await remote();
  await stdio();
  console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll MCP checks passed.");
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
