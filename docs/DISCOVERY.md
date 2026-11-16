# Discovery layer (Phase 3)

How an AI agent finds Ajean Ledger, learns what it does, what it costs and how to pay — without a human,
a sign-up or an API key. All discovery endpoints are **free**, JSON or plain text, and generated from code:
prices and endpoints come from [`lib/payments/pricing.ts`](../lib/payments/pricing.ts) (single source of truth),
so they can never drift from the x402 402 responses.

| URL | Content-Type | What it is | Builder |
|---|---|---|---|
| `GET /api/v1/catalog` | `application/json` | Service + pricing manifest: payment details, endpoints, idempotency, errors, examples, payment mode | [`lib/discovery/catalog.ts`](../lib/discovery/catalog.ts) |
| `GET /openapi.json` | `application/json` | OpenAPI 3.1 (JSON Schema 2020-12) with `x-x402` / `x-payment` per operation | [`lib/discovery/openapi.ts`](../lib/discovery/openapi.ts) |
| `GET /llms.txt` | `text/plain; charset=utf-8` | Markdown for LLMs (llmstxt.org): what / when / how to pay / endpoints / example / MCP / **Errors** / limits / disclaimer | [`lib/discovery/llms.ts`](../lib/discovery/llms.ts) |
| `GET /.well-known/agent.json` | `application/json` | A2A-style agent card: skills with prices, `x402` section, links | [`lib/discovery/agent-card.ts`](../lib/discovery/agent-card.ts) |
| `POST /mcp` | `application/json` | Remote MCP server (see [MCP.md](MCP.md)) | [`lib/discovery/mcp-remote.ts`](../lib/discovery/mcp-remote.ts) |

Routes: `app/api/v1/catalog/route.ts`, `app/openapi.json/route.ts`, `app/llms.txt/route.ts`,
`app/.well-known/agent.json/route.ts` (Next 16 serves the `.well-known` folder directly, no rewrite needed),
`app/mcp/route.ts`. Cache: `public, max-age=60` (catalog) / `300` (others); `Access-Control-Allow-Origin: *`.

## Single sources

| Data | Source | Used by |
|---|---|---|
| Endpoints, prices (USDC + atomic), MCP tool names | `lib/payments/pricing.ts` | all discovery files, MCP tools, x402 route config |
| Payment mode, payTo, facilitator | `lib/payments/config.ts` (`getPaymentMode`, `getPayTo`) | catalog, openapi `x-x402`, llms.txt, agent card |
| Request/response contract | [`lib/discovery/schemas.ts`](../lib/discovery/schemas.ts) — zod mirror of `engine/types.ts`, `lib/api/envelope.ts`, `lib/payments/receipt.ts`, x402 wire objects | OpenAPI `components.schemas` (via `z.toJSONSchema` + registry → `$ref`), MCP tool input schemas |
| Error codes | `lib/api/errors.ts` (`ERROR_STATUS`, `ERROR_DESCRIPTIONS`, `ENGINE_CODE_STATUS`) via [`lib/discovery/errors.ts`](../lib/discovery/errors.ts) | catalog `errors.codes`, OpenAPI `ErrorResponse.error.code` enum, llms.txt `## Errors` |
| Examples | `fixtures/01.json` `.input` (request) + truncated real engine output (response) — [`lib/discovery/examples.ts`](../lib/discovery/examples.ts) | catalog, openapi examples, llms.txt |
| Base URL | request origin (`x-forwarded-host` / `x-forwarded-proto`, validated) — `baseUrlFromRequest` in [`lib/discovery/meta.ts`](../lib/discovery/meta.ts) | all |

Every error body carries `docs_url: "/llms.txt#errors"`; llms.txt has an `<a id="errors"></a>` anchor followed by the
`## Errors` heading (the GitHub-style slug of that heading is also `errors`).

## OpenAPI highlights

- `openapi: 3.1.0`, `jsonSchemaDialect` 2020-12, `servers[0].url` = request origin.
- Paid operations (`operationId` = MCP tool name): `PAYMENT-SIGNATURE` + `Idempotency-Key` header parameters;
  `200` with `PAYMENT-RESPONSE`, `X-Request-Id`, `Idempotent-Replay` headers and `EntryResponse` / `CheckResponse` /
  `AuditResponse` (= engine result + `request_id` + `receipt`); `402` with the `PAYMENT-REQUIRED` header whose
  `contentSchema` is the decoded `PaymentRequired` (x402 v2); 400/409/413/415/422/429/500/502/503 → `ErrorResponse`.
- `x-x402` per operation: `{ x402Version: 2, scheme: "exact", network: "eip155:84532", asset, amount (atomic), price_usdc, payTo, maxTimeoutSeconds, extra, accepts: [USDC, EURC], mode }` (EURC = `accepts[1]`, ADR-024); `POST /api/v1/credits` (`buy_credits`) and `GET /api/v1/credits/balance` document the prepaid credit packs and the `X-Credit-Token` parameter (ADR-025);
  `x-payment`: `{ protocol, required, price_usdc, price_atomic, currency, network }`; `x-mcp-tool`.
- Request schemas: `CheckInvoiceRequest`, `CreateEntryRequest`, `AuditRequest`; `EntryEngineInput` = oneOf
  `JsonInvoiceInput | FacturxInput | UblInput | BankTransactionEngineInput | DocumentInput (pdf/image)`.

## Verify

```bash
PAYMENT_MODE=simulated npm run dev   # or reuse a running server via its port
for p in /api/v1/catalog /openapi.json /llms.txt /.well-known/agent.json; do
  curl -s -o /dev/null -w "$p %{http_code} %{content_type}\n" localhost:3000$p; done
# /api/v1/catalog 200 application/json
# /openapi.json 200 application/json
# /llms.txt 200 text/plain; charset=utf-8
# /.well-known/agent.json 200 application/json
npx vitest run tests/discovery*
```

`tests/discovery.test.ts` (32 tests) checks: OpenAPI 3.1 structure, **every `$ref` resolves**, unique operationIds,
every paid route of `pricing.ts` present with the right price in `x-x402`/`x-payment`/summary, PAYMENT-REQUIRED /
PAYMENT-RESPONSE / PAYMENT-SIGNATURE / Idempotency-Key documented, error enum ⊇ API + engine codes; **the real engine
output of all 13 fixtures validates against `EntryResult`**, CheckResult/AuditResult too, the example response still
matches the engine; catalog, llms.txt (sections, price table, every error code), agent card; route handlers'
status, content types, cache headers; base-URL derivation rejects malformed hosts.

## Limitations

- `schemas.ts` mirrors `engine/types.ts` by hand (TypeScript types are not available at runtime); the fixture tests
  catch drift on the output side. Output schemas are open (`additionalProperties` allowed) for forward compatibility.
- The agent card follows the A2A field names (`protocolVersion`, `skills`, `capabilities`, `defaultInputModes`…) but
  Ajean Ledger does not implement the A2A JSON-RPC protocol: its interfaces are HTTP+JSON (x402) and MCP.
