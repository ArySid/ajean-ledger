/**
 * MCP layer, in-process (no network): real engine, simulated facilitator, x402 SDK on both sides.
 *  - remote MCP server (lib/discovery/mcp-remote.ts) over an in-memory transport, paid with @x402/mcp;
 *  - app/mcp/route.ts over Streamable HTTP (Request/Response);
 *  - stdio bridge tools (mcp/bridge.ts) paying the HTTP route handlers via @x402/fetch, spending policy.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createx402MCPClient } from "@x402/mcp";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

// Same workaround as tests/api.test.ts: load @x402/next through its CJS build under Vitest.
vi.mock("@x402/next", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(import.meta.url)("@x402/next");
});

import { POST as entryPOST } from "@/app/api/v1/entry/route";
import { POST as checkPOST } from "@/app/api/v1/invoice/check/route";
import { POST as auditPOST } from "@/app/api/v1/audit/route";
import { GET as receiptGET } from "@/app/api/v1/receipts/[id]/route";
import { GET as catalogGET } from "@/app/api/v1/catalog/route";
import { GET as mcpGET, POST as mcpPOST } from "@/app/mcp/route";
import { resetPaidRoutes } from "@/lib/api/paid-route";
import { resetRateLimit } from "@/lib/api/rate-limit";
import { EXAMPLE_REQUESTS } from "@/lib/discovery/examples";
import { createRemoteMcpServer, resetMcpWrappers } from "@/lib/discovery/mcp-remote";
import { PAID_TOOLS } from "@/lib/discovery/tools";
import { PAID_ENDPOINTS } from "@/lib/payments/pricing";
import { resetResourceServers } from "@/lib/payments/server";
import { resetSimulatedFacilitator } from "@/lib/payments/simulated-facilitator";
import { MemoryStore, getStore, setStoreForTests } from "@/lib/store";
import { createBridgeServer } from "@/mcp/bridge";
import { SpendingPolicy } from "@/mcp/policy";

const BASE = "http://localhost:3000";
const PAY_TO = privateKeyToAccount(generatePrivateKey()).address;
const AGENT_KEY = generatePrivateKey();
const agent = privateKeyToAccount(AGENT_KEY);

const savedEnv = { ...process.env };
process.env.PAYMENT_MODE = "simulated";
process.env.SERVICE_PAY_TO_ADDRESS = PAY_TO;
process.env.STORE_KIND = "memory";
process.env.RATE_LIMIT_PER_MINUTE = "0";
delete process.env.ANTHROPIC_API_KEY;
afterAll(() => {
  process.env = { ...savedEnv };
});
beforeEach(() => {
  setStoreForTests(new MemoryStore());
  resetSimulatedFacilitator();
  resetRateLimit();
  resetResourceServers();
  resetPaidRoutes();
  resetMcpWrappers();
});

type Json = Record<string, unknown>;
const json0 = (r: { content?: unknown }) => JSON.parse(((r.content as { text: string }[])[0]).text) as Json;

async function connectRemote() {
  const server = createRemoteMcpServer(BASE);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  return { server, clientT };
}

describe("remote MCP server (x402 MCP transport)", () => {
  it("lists the 5 tools; paid tool descriptions state the price; input schemas are the envelopes", async () => {
    const { clientT } = await connectRemote();
    const client = new Client({ name: "t", version: "1" });
    await client.connect(clientT);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["audit_entries", "check_invoice", "create_entry", "get_catalog", "get_receipt"]);
    for (const def of PAID_TOOLS) {
      const t = tools.find((x) => x.name === def.name)!;
      expect(t.description).toContain(`${PAID_ENDPOINTS[def.endpoint].price_usdc} USDC`);
    }
    const entry = tools.find((t) => t.name === "create_entry")!;
    expect(entry.inputSchema.required).toEqual(["input"]);
    expect(Object.keys(entry.inputSchema.properties ?? {})).toEqual(expect.arrayContaining(["input", "profile", "history", "use_server_history"]));
    expect(tools.find((t) => t.name === "audit_entries")!.inputSchema.required).toEqual(["items"]);
    await client.close();
  });

  it("unpaid create_entry returns the x402 PaymentRequired with the HTTP API requirements", async () => {
    const { clientT } = await connectRemote();
    const client = new Client({ name: "t", version: "1" });
    await client.connect(clientT);
    const r = await client.callTool({ name: "create_entry", arguments: EXAMPLE_REQUESTS.entry });
    expect(r.isError).toBe(true);
    const pr = r.structuredContent as { x402Version: number; accepts: Json[]; resource: Json };
    expect(pr.x402Version).toBe(2);
    expect(pr.accepts[0]).toMatchObject({
      scheme: "exact",
      network: "eip155:84532",
      amount: PAID_ENDPOINTS.entry.price_atomic,
      asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      payTo: PAY_TO,
      extra: { name: "USDC", version: "2" },
    });
    expect(pr.resource.url).toBe("mcp://tool/create_entry");
    // Same requirements as the HTTP 402.
    const http = await entryPOST(new NextRequest(`${BASE}/api/v1/entry`, { method: "POST", body: JSON.stringify(EXAMPLE_REQUESTS.entry), headers: { "content-type": "application/json" } }));
    expect(http.status).toBe(402);
    const httpPr = JSON.parse(Buffer.from(http.headers.get("PAYMENT-REQUIRED")!, "base64").toString()) as { accepts: Json[] };
    expect(pr.accepts[0]).toMatchObject({ amount: httpPr.accepts[0].amount, payTo: httpPr.accepts[0].payTo, asset: httpPr.accepts[0].asset });
    await client.close();
  });

  it("paid create_entry (createx402MCPClient) returns the engine result + request_id + receipt, persisted", async () => {
    const { clientT } = await connectRemote();
    const payer = createx402MCPClient({
      name: "payer",
      version: "1",
      schemes: [{ network: "eip155:84532", client: new ExactEvmScheme(agent) }],
      autoPayment: true,
    });
    await payer.connect(clientT);
    const r = await payer.callTool("create_entry", EXAMPLE_REQUESTS.entry);
    expect(r.isError).toBeFalsy();
    expect(r.paymentMade).toBe(true);
    expect(r.paymentResponse?.success).toBe(true);
    const body = json0(r) as { request_id: string; receipt: Json; entry: { balanced: boolean; lines: { account: string }[] } };
    expect(body.request_id).toMatch(/^req_/);
    expect(body.receipt).toMatchObject({ amount: "0.15", amount_atomic: "150000", mode: "simulated", pay_to: PAY_TO, payer: agent.address });
    expect(String(body.receipt.tx_hash)).toMatch(/^0x5151/);
    expect(body.entry.balanced).toBe(true);
    expect(body.entry.lines.map((l) => l.account)).toEqual(["6064", "44566", "401BURO"]);
    const rec = await getStore().getReceipt(body.request_id);
    expect(rec?.endpoint).toBe("entry");
    // free get_receipt tool
    const g = await payer.callTool("get_receipt", { request_id: body.request_id });
    expect((json0(g) as { receipt: Json }).receipt).toMatchObject({ tx_hash: body.receipt.tx_hash });
    await payer.close();
  });

  it("a paid call with an invalid body is NOT settled (not charged)", async () => {
    const { clientT } = await connectRemote();
    const payer = createx402MCPClient({ name: "payer", version: "1", schemes: [{ network: "eip155:84532", client: new ExactEvmScheme(agent) }] });
    await payer.connect(clientT);
    // Passes the tool input schema, fails in the engine (unparseable UBL) → error result, never settled.
    const r = await payer.callTool("create_entry", { input: { format: "ubl", xml: "<Invoice><broken" } });
    expect(r.isError).toBe(true);
    expect(r.paymentMade).toBe(true);
    expect(r.paymentResponse?.success ?? false).toBe(false);
    expect((json0(r) as { error: { code: string } }).error.code).toMatch(/^(INVALID_XML|INVALID_INPUT)$/);
    expect((await getStore().stats()).calls_served).toBe(0);
    // Fails the tool input schema → MCP invalid-params error before any payment.
    const bad = { input: { format: "json", invoice: { ...(EXAMPLE_REQUESTS.entry.input as { invoice: Json }).invoice, issue_date: "05/10/2026" } } };
    const r2 = await payer.callTool("create_entry", bad);
    expect(r2.isError).toBe(true);
    expect(r2.paymentMade).toBe(false);
    await payer.close();
  });
});

describe("app/mcp/route.ts (Streamable HTTP, stateless)", () => {
  const rpc = (body: Json) =>
    mcpPOST(new Request(`${BASE}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify(body) }));

  it("answers initialize and tools/list with JSON", async () => {
    const init = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "curl", version: "1" } } });
    expect(init.status).toBe(200);
    expect(init.headers.get("content-type")).toContain("application/json");
    expect(((await init.json()) as { result: { serverInfo: Json } }).result.serverInfo.name).toBe("ajean-ledger");
    const list = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const names = ((await list.json()) as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name);
    expect(names).toContain("create_entry");
  });

  it("GET returns 405 with MCP info", async () => {
    const res = await mcpGET(new Request(`${BASE}/mcp`));
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
  });
});

describe("stdio bridge tools (mcp/bridge.ts)", () => {
  const routes: Record<string, (req: NextRequest) => Promise<Response>> = {
    "/api/v1/entry": entryPOST,
    "/api/v1/invoice/check": checkPOST,
    "/api/v1/audit": auditPOST,
    "/api/v1/catalog": catalogGET as never,
  };
  const inProcessFetch: typeof fetch = async (input, init) => {
    const req = new NextRequest(input instanceof Request ? input : new Request(input, init));
    const p = req.nextUrl.pathname;
    if (p.startsWith("/api/v1/receipts/")) return receiptGET(req, { params: Promise.resolve({ id: p.split("/").pop()! }) });
    return routes[p](req);
  };

  async function bridge(max = "0.20", daily = "2.00") {
    const policy = new SpendingPolicy({ maxPerCallUsdc: max, dailyBudgetUsdc: daily });
    const logs: string[] = [];
    const server = createBridgeServer({ baseUrl: BASE, account: agent, policy, fetchImpl: inProcessFetch, log: (m) => logs.push(m) });
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await server.connect(serverT);
    const client = new Client({ name: "desktop", version: "1" });
    await client.connect(clientT);
    return { client, policy, logs };
  }

  it("create_entry pays the HTTP API via x402 and returns result + receipt", async () => {
    const { client, policy, logs } = await bridge();
    const r = await client.callTool({ name: "create_entry", arguments: EXAMPLE_REQUESTS.entry });
    expect(r.isError).toBeFalsy();
    const body = r.structuredContent as { request_id: string; receipt: Json; entry: { balanced: boolean } };
    expect(body.receipt).toMatchObject({ amount: "0.15", mode: "simulated", payer: agent.address });
    expect(body.entry.balanced).toBe(true);
    expect(policy.summary().spent_today_usdc).toBe("0.15");
    expect(logs.join("\n")).not.toContain(AGENT_KEY.slice(2));
    const g = await client.callTool({ name: "get_receipt", arguments: { request_id: body.request_id } });
    expect((g.structuredContent as { request_id: string }).request_id).toBe(body.request_id);
    const cat = await client.callTool({ name: "get_catalog", arguments: {} });
    expect((cat.structuredContent as { service: string; agent_spending_policy: Json }).agent_spending_policy).toMatchObject({ max_per_call_usdc: "0.20" });
    await client.close();
  });

  it("refuses a call above AGENT_MAX_PER_CALL_USDC without paying", async () => {
    const { client, policy } = await bridge("0.20", "5.00");
    const r = await client.callTool({ name: "audit_entries", arguments: EXAMPLE_REQUESTS.audit });
    expect(r.isError).toBe(true);
    expect((r.structuredContent as { error: { code: string; message: string } }).error).toMatchObject({ code: "SPENDING_POLICY_REFUSED" });
    expect(policy.summary().spent_today_usdc).toBe("0.00");
    expect((await getStore().stats()).calls_served).toBe(0);
    await client.close();
  });

  it("enforces the daily budget", async () => {
    const { client } = await bridge("0.20", "0.10");
    const r = await client.callTool({ name: "check_invoice", arguments: EXAMPLE_REQUESTS.invoice_check });
    expect(r.isError).toBeFalsy(); // 0.05
    const r2 = await client.callTool({ name: "check_invoice", arguments: EXAMPLE_REQUESTS.invoice_check });
    expect(r2.isError).toBeFalsy(); // 0.10
    const r3 = await client.callTool({ name: "check_invoice", arguments: EXAMPLE_REQUESTS.invoice_check });
    expect(r3.isError).toBe(true);
    expect(JSON.stringify(r3.content)).toContain("daily budget exceeded");
    await client.close();
  });

  it("refuses server requirements outside the policy (wrong network/asset/amount)", () => {
    const p = new SpendingPolicy({ maxPerCallUsdc: "0.20", dailyBudgetUsdc: "2.00" });
    const ok = { scheme: "exact", network: "eip155:84532", asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", amount: "150000" };
    expect(p.checkRequirements(ok).ok).toBe(true);
    expect(p.checkRequirements({ ...ok, network: "eip155:8453" }).ok).toBe(false);
    expect(p.checkRequirements({ ...ok, asset: "0x0000000000000000000000000000000000000001" }).ok).toBe(false);
    expect(p.checkRequirements({ ...ok, amount: "200001" }).ok).toBe(false);
  });

  it("paid tools refuse clearly without a wallet", async () => {
    const policy = new SpendingPolicy({ maxPerCallUsdc: "0.20", dailyBudgetUsdc: "2.00" });
    const server = createBridgeServer({ baseUrl: BASE, account: null, policy, fetchImpl: inProcessFetch, log: () => undefined });
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await server.connect(serverT);
    const client = new Client({ name: "desktop", version: "1" });
    await client.connect(clientT);
    const r = await client.callTool({ name: "create_entry", arguments: EXAMPLE_REQUESTS.entry });
    expect(r.isError).toBe(true);
    expect(JSON.stringify(r.structuredContent)).toContain("AGENT_WALLET_MISSING");
    await client.close();
  });
});
