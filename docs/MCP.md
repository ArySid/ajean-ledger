# MCP servers (Phase 3)

Ajean Ledger is usable from any MCP agent in two ways. Both expose the **same five tools**
(definitions in [`lib/discovery/tools.ts`](../lib/discovery/tools.ts), prices from `lib/payments/pricing.ts`):

| Tool | Price | Wraps | Arguments |
|---|---|---|---|
| `check_invoice` | 0.05 USDC | `POST /api/v1/invoice/check` | the request body: `{ input, profile?, history? }` |
| `create_entry` | 0.15 USDC | `POST /api/v1/entry` | `{ input, profile?, history?, use_server_history? }` |
| `audit_entries` | 1.00 USDC | `POST /api/v1/audit` | `{ items: [{invoice}|{entry}] (1..50), profile? }` |
| `get_catalog` | free | `GET /api/v1/catalog` | `{}` |
| `get_receipt` | free | `GET /api/v1/receipts/{id}` | `{ request_id }` |

Input schemas are the zod request envelopes of [`lib/discovery/schemas.ts`](../lib/discovery/schemas.ts) (the same
ones published in openapi.json). Paid tool descriptions state the price. Results are the API JSON
(`request_id`, `receipt`, engine result) as text content **and** `structuredContent`.

## 1. Remote MCP — `POST /mcp` (Streamable HTTP, stateless)

[`app/mcp/route.ts`](../app/mcp/route.ts) → [`lib/discovery/mcp-remote.ts`](../lib/discovery/mcp-remote.ts).
One `McpServer` + `WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })`
per HTTP request (stateless, serverless-friendly). `GET` with `Accept: text/event-stream` (an MCP client opening an SSE stream) and `DELETE` → 405 with a small JSON info body, as the spec requires from a server without SSE; any other `GET` (a browser, the landing page's link) → **200** with a JSON usage document (how to POST JSON-RPC, an example, the tools, the discovery links; Phase 7 review m7). Rate-limited like the API.

**Payment is real x402, through the official `@x402/mcp` `createPaymentWrapper`**, with the same
`x402ResourceServer` (`getResourceServer()`: simulated or HTTP facilitator) and the same requirements
(`buildRouteConfig()` → `server.buildPaymentRequirements`) as the HTTP API — same asset, amount, payTo, network, EIP-712 domain:

1. `tools/call create_entry` without payment → tool result `isError: true`, `structuredContent` = `PaymentRequired`
   (`x402Version: 2`, `resource.url: "mcp://tool/create_entry"`, `accepts[0].amount: "150000"`…), also JSON-encoded in `content[0].text`.
2. The client signs the EIP-3009 authorization and retries with `params._meta["x402/payment"] = PaymentPayload`.
3. Server: verify → engine (same envelope parsers `parseInvoiceEnvelope`/`parseAuditEnvelope` and engine adapter as
   `lib/api/paid-route.ts`) → settle only if the tool result is not an error → `_meta["x402/payment-response"] = SettleResponse`.
4. Ajean adds `request_id` + `receipt` (same `buildReceipt`) to the result and stores the receipt (so `get_receipt`,
   `/api/v1/receipts/{id}` and the operator stats see MCP payments too).

Engine/validation errors are returned as `isError: true` with the API error envelope → the wrapper cancels the
payment: **never charged**. Arguments that fail the tool input schema are rejected by the MCP SDK before any payment.
The payment wrapper is created lazily at the first paid call, so `initialize`/`tools/list` never contact the facilitator.

Client side (any language with an x402 MCP client; TypeScript example):

```ts
import { createx402MCPClient } from "@x402/mcp";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
const client = createx402MCPClient({
  name: "my-agent", version: "1.0.0",
  schemes: [{ network: "eip155:84532", client: new ExactEvmScheme(testnetAccount) }],
  onPaymentRequested: async ({ paymentRequired }) => BigInt(paymentRequired.accepts[0].amount) <= 200_000n, // spending policy
});
await client.connect(new StreamableHTTPClientTransport(new URL("https://<host>/mcp")));
const r = await client.callTool("create_entry", { input: { format: "json", invoice: { /* … */ } } });
// r.paymentResponse.transaction = tx hash; JSON.parse(r.content[0].text).receipt
```

Raw JSON-RPC (any HTTP client; Accept must list both types):

```bash
curl -s -X POST http://localhost:3000/mcp -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Claude Desktop / claude.ai "custom connector" can point at `https://<host>/mcp`, but a client that does not speak the
x402 MCP transport will only see the `PaymentRequired` result for paid tools (free tools work). To pay from Claude
Desktop, use the stdio bridge below.

## 2. Stdio bridge — `mcp/server.ts` (Claude Desktop)

[`mcp/server.ts`](../mcp/server.ts) (entry) + [`mcp/bridge.ts`](../mcp/bridge.ts) (tools) + [`mcp/policy.ts`](../mcp/policy.ts) (spending policy).
A local MCP server over stdio; for each paid tool call it calls the **HTTP API** at `AJEAN_LEDGER_URL` with
`@x402/fetch` `wrapFetchWithPayment` + `ExactEvmScheme(AGENT_PRIVATE_KEY)` (402 → sign → retry), with a fresh
`Idempotency-Key` per call, and returns the result + receipt (plus a one-line payment summary).

```bash
npm run mcp:stdio          # tsx mcp/server.ts
npm run mcp:inspect        # MCP Inspector UI (downloads @modelcontextprotocol/inspector via npx)
```

| Env | Default | Meaning |
|---|---|---|
| `AJEAN_LEDGER_URL` | `http://localhost:3000` | API base URL |
| `AGENT_PRIVATE_KEY` | — | throwaway **Base Sepolia** wallet (0x + 64 hex). Without it paid tools answer `AGENT_WALLET_MISSING`; free tools work |
| `AGENT_MAX_PER_CALL_USDC` | `0.20` | refuse any call priced above this |
| `AGENT_DAILY_BUDGET_USDC` | `2.00` | refuse once the UTC-day spend would exceed this |
| `AGENT_SPEND_LEDGER_FILE` | — (in memory) | optional JSON file keeping the daily spend across restarts |
| `AJEAN_PAY_ASSET` | `USDC` | `EURC` selects the EURC requirement (`accepts[1]`, ADR-024); the policy counts it at its USDC value (1.08, rounded up) |
| `AJEAN_CREDIT_TOKEN` | — | prepaid credit token (`ajc_…`, ADR-025): each paid tool first tries `X-Credit-Token`, falls back to x402 on `CREDITS_INSUFFICIENT` / `CREDIT_TOKEN_INVALID` |
| `AJEAN_MCP_DOTENV` | `1` | read `<repo>/.env.local` (never overrides variables already set); `0` disables |

Spending policy (master prompt §6) — enforced twice:
1. before calling, against the published price (`pricing.ts`);
2. right before signing, in an `x402Client.onBeforePaymentCreation` hook, against the server's actual requirements:
   network must be `eip155:84532`, asset must be test USDC (or test EURC when `AJEAN_PAY_ASSET=EURC`, counted at its USDC value), scheme `exact`, amount ≤ max per call, spent today +
   in-flight + amount ≤ daily budget. Otherwise the payment is aborted and the tool returns
   `isError: true` with `SPENDING_POLICY_REFUSED` and the reason. Only settled payments count (idempotent replays and
   failed calls are not charged and not counted).

stdout carries MCP only (`console.log/info/debug` are redirected to stderr); the private key is never logged.

Claude Desktop config: see the README section "Connect your agent".

## 3. Verification (2026-11-16, simulated mode)

`AJEAN_LEDGER_URL=http://localhost:3400 npx tsx scripts/mcp-check.ts` against `PAYMENT_MODE=simulated next dev -p 3400`
(script: [`scripts/mcp-check.ts`](../scripts/mcp-check.ts), MCP SDK client):

```
== Remote MCP http://localhost:3400/mcp ==
PASS  tools/list  — audit_entries, check_invoice, create_entry, get_catalog, get_receipt
PASS  create_entry description states the price
PASS  unpaid create_entry → x402 PaymentRequired  — amount=150000 network=eip155:84532 payTo=0xCB4b…
PASS  get_catalog (free)
PASS  paid create_entry via @x402/mcp  — paid=0.15 simulated tx=0x5151… accounts=6064/44566/401BURO
PASS  settlement in _meta['x402/payment-response']
PASS  get_receipt (free) finds the MCP payment
== Stdio bridge (mcp/server.ts) ==
PASS  tools/list
PASS  create_entry paid by the bridge via x402  — paid=0.15 simulated tx=0x5151…
PASS  audit_entries (1.00 USDC) refused by max-per-call 0.20
PASS  daily budget 0.40: 2nd call paid, 3rd refused
PASS  bridge never logs the private key
All MCP checks passed.
```

`npx vitest run tests/mcp*` (11 tests, in-process, real engine, simulated facilitator): tools/list + price in
descriptions + envelope input schemas; unpaid → PaymentRequired identical to the HTTP 402 requirements; paid via
`createx402MCPClient` → receipt persisted + `get_receipt`; engine error after payment → not settled; schema-invalid
arguments → rejected before payment; `/mcp` route initialize + tools/list over Streamable HTTP, GET 405 for SSE and 200 usage info otherwise; bridge pays the
real route handlers via `@x402/fetch`, max-per-call and daily-budget refusals, requirement checks, no wallet.

`npx @modelcontextprotocol/inspector --cli` was not run: the package is not installed and `npx` would download it
(`npm run mcp:inspect` does that on demand).

## Limitations

- The remote `/mcp` endpoint has no `Idempotency-Key` equivalent (each paid `tools/call` is a new charge); use the HTTP
  API for idempotent retries. The stdio bridge does send an `Idempotency-Key` to the API.
- The bridge's daily budget lives in memory unless `AGENT_SPEND_LEDGER_FILE` is set (a Claude Desktop restart resets it).
- In testnet mode the first paid MCP call initializes the resource server against the facilitator (one extra request).
