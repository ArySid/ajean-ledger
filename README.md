# Ajean Ledger

> An API that lets any AI agent send a French invoice or bank transaction and get back a validated,
> machine-readable accounting entry (PCG accounts, VAT treatment, e-invoicing compliance, anomaly flags).
> The agent pays per call in USDC through the x402 HTTP payment protocol. No sign-up, no API key:
> **payment is the authentication.**

**Status:** Phase 0 (setup). Proof of concept for the course *Digital Transformation & FinTech —
The AI Agent Economy Challenge*. Testnet only (Base Sepolia). Synthetic data only.
**Not a substitute for a chartered accountant's review.**

Team: Ary SIDOUN, Victor BONNAPETIT, Yoann POMMEROLLE, Leo COUTURIER.

## Project docs
- [`docs/prompts/00_MASTER_PROMPT.md`](docs/prompts/00_MASTER_PROMPT.md) — the master prompt
- [`docs/prompts/PROMPT_LOG.md`](docs/prompts/PROMPT_LOG.md) — every prompt used to build the PoC
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — technical and product decisions (ADR log)
- [`docs/BRIEF_COMPLIANCE.md`](docs/BRIEF_COMPLIANCE.md) — course brief → evidence checklist

Quickstart: _coming in Phase 6._

## Connect your agent

Ajean Ledger is built for AI agents: discovery files, JSON only, HTTP 402 payments (x402 v2, Base Sepolia **testnet**
USDC), no sign-up, no API key. Details: [`docs/DISCOVERY.md`](docs/DISCOVERY.md), [`docs/MCP.md`](docs/MCP.md).

**Discovery (free):**

```bash
BASE=http://localhost:3000   # or your deployment URL
curl -s $BASE/api/v1/catalog          # service + pricing manifest (JSON)
curl -s $BASE/openapi.json            # OpenAPI 3.1 with x-x402 price per operation
curl -s $BASE/llms.txt                # Markdown for LLM agents (how to pay, errors…)
curl -s $BASE/.well-known/agent.json  # agent card (skills + prices)
```

**Unpaid call → 402 with the price (x402 v2):**

```bash
curl -i -X POST $BASE/api/v1/entry -H 'content-type: application/json' \
  -d '{"input":{"format":"json","invoice":{}}}'
# HTTP/1.1 402 Payment Required
# PAYMENT-REQUIRED: eyJ4NDAyVmVyc2lvbiI6Mi…   (base64 JSON: accepts[0].amount "150000" = 0.15 USDC, payTo, asset, network eip155:84532)
npm run pay:simulated   # full 402 → sign → 200 flow with the demo agent wallet
```

**Claude Desktop (stdio bridge that pays with your testnet agent wallet)** — `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ajean-ledger": {
      "command": "npx",
      "args": ["tsx", "/ABSOLUTE/PATH/TO/ajean-ledger/mcp/server.ts"],
      "env": {
        "AJEAN_LEDGER_URL": "http://localhost:3000",
        "AGENT_PRIVATE_KEY": "0xYOUR_THROWAWAY_BASE_SEPOLIA_TESTNET_KEY",
        "AGENT_MAX_PER_CALL_USDC": "0.20",
        "AGENT_DAILY_BUDGET_USDC": "2.00"
      }
    }
  }
}
```

Testnet keys only (generate one with `npx tsx scripts/gen-wallets.ts`, fund it at https://faucet.circle.com). If
`npx tsx` is not resolvable from Claude Desktop's working directory, use
`"command": "/ABSOLUTE/PATH/TO/ajean-ledger/node_modules/.bin/tsx", "args": ["/ABSOLUTE/PATH/TO/ajean-ledger/mcp/server.ts"]`.
Tools: `check_invoice` (0.05 USDC), `create_entry` (0.15), `audit_entries` (1.00), `get_catalog`, `get_receipt` (free).
The bridge refuses any payment above `AGENT_MAX_PER_CALL_USDC` or beyond `AGENT_DAILY_BUDGET_USDC`. Local test:
`npm run mcp:stdio`, `npm run mcp:inspect`, or `AJEAN_LEDGER_URL=http://localhost:3000 npx tsx scripts/mcp-check.ts`.

**Remote MCP (Streamable HTTP, stateless)** — for MCP clients that speak the x402 MCP transport
(e.g. `createx402MCPClient` from `@x402/mcp`):

```json
{ "mcpServers": { "ajean-ledger": { "type": "http", "url": "https://YOUR-DEPLOYMENT/mcp" } } }
```

```bash
curl -s -X POST $BASE/mcp -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Unpaid paid-tool calls return the x402 `PaymentRequired` (same price and payTo as the HTTP API); the client retries with
`_meta["x402/payment"]` and gets the result + receipt.
