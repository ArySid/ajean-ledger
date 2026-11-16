# Payments & paid API (Phase 2)

Ajean Ledger is paid per call in USDC with the **x402 v2** HTTP payment protocol. AI agents are the
users: **payment is the authentication** (no sign-up, no API key). Testnet only: Base Sepolia
(`eip155:84532`), Circle test USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e`.

SDK: `@x402/core`, `@x402/next`, `@x402/evm`, `@x402/fetch` — all pinned **2.31.0** (ADR-002).

## 1. Endpoints and prices

Single source of truth: [`lib/payments/pricing.ts`](../lib/payments/pricing.ts) (`PAID_ENDPOINTS`,
`FREE_ENDPOINTS`). Catalog, OpenAPI, llms.txt, agent.json and MCP tools must read prices from there.

| Endpoint | Price (USDC) | Atomic (6 dec.) | MCP tool |
|---|---|---|---|
| `POST /api/v1/invoice/check` | 0.05 | 50000 | `check_invoice` |
| `POST /api/v1/entry` | 0.15 | 150000 | `create_entry` |
| `POST /api/v1/audit` (1..50 items) | 1.00 | 1000000 | `audit_entries` |
| `GET /api/v1/receipts/{id}` | free | | |
| `GET /api/health` | free | | |

## 2. The flow (what an agent sees)

```
Agent                                   Ajean Ledger                         Facilitator
  | POST /api/v1/entry  (no payment)        |                                     |
  |---------------------------------------->|                                     |
  | 402 + PAYMENT-REQUIRED (base64 JSON)    |                                     |
  |<----------------------------------------|                                     |
  | sign EIP-3009 transferWithAuthorization |                                     |
  | POST again + PAYMENT-SIGNATURE          |                                     |
  |---------------------------------------->| verify ---------------------------->|
  |                                         | run engine (only if payment valid)  |
  |                                         | settle (only if result < 400) ----->| tx on Base Sepolia
  | 200 + PAYMENT-RESPONSE + JSON result    |                                     |
  |   { request_id, receipt{tx_hash}, ... } |                                     |
  |<----------------------------------------|                                     |
```

Headers (x402 v2):

| Header | Direction | Content |
|---|---|---|
| `PAYMENT-REQUIRED` | server → agent, on 402 | base64 JSON `PaymentRequired`: `x402Version: 2`, `resource {url, description, mimeType}`, `accepts[0] {scheme: "exact", network: "eip155:84532", amount: "150000", asset: <USDC>, payTo, maxTimeoutSeconds: 300, extra {name: "USDC", version: "2"}}` |
| `PAYMENT-SIGNATURE` | agent → server | base64 JSON `PaymentPayload` (signed EIP-3009 authorization) |
| `PAYMENT-RESPONSE` | server → agent, on 200 | base64 JSON `SettleResponse`: `success`, `transaction` (tx hash), `network`, `payer`, `amount` |
| `Idempotency-Key` | agent → server | optional, ≤ 128 visible ASCII chars (UUID recommended) |
| `Idempotent-Replay: true` | server → agent | response is a stored replay (not charged) |
| `X-Request-Id` | server → agent | `req_…` (also in the JSON body) |

The agent needs **test USDC only**: the facilitator submits the EIP-3009 authorization and pays gas (ADR-007).

## 3. Payment modes (`PAYMENT_MODE`)

| Mode | Facilitator | What happens |
|---|---|---|
| `simulated` (default, also for unset/unknown values) | `SimulatedFacilitatorClient` (local, offline) | Real 402, real PAYMENT-SIGNATURE, real EIP-712 signature check, nonce-reuse check. Settlement returns a fake tx hash `0x5151…` (= `0x5151` + 60 hex of keccak256(payload)), `extra.simulated: true`, receipt `explorer_url: null`, `mode: "simulated"`. |
| `testnet` | `HTTPFacilitatorClient(X402_FACILITATOR_URL)` (default `https://x402.org/facilitator`) | Real verify + settle on Base Sepolia. Receipt links `https://sepolia.basescan.org/tx/<hash>`. Requires `SERVICE_PAY_TO_ADDRESS` (else 503 `SERVICE_MISCONFIGURED`). |

Both modes use the same `x402ResourceServer` + `ExactEvmScheme` (server) and the same route config, so the
**wire format (402 body, all headers, requirements) is identical**. Only the facilitator differs (ADR-005).
`X402_NETWORK` other than `eip155:84532` is ignored (testnet only). "Replay" is a console feature, not a server mode.

Code: [`lib/payments/server.ts`](../lib/payments/server.ts) (`getResourceServer`, `buildRouteConfig`,
`getPaymentMode`), [`lib/payments/simulated-facilitator.ts`](../lib/payments/simulated-facilitator.ts),
[`lib/payments/config.ts`](../lib/payments/config.ts).

## 4. How the receipt (tx hash) reaches the JSON body

`withX402(handler, routeConfig, server)` (from `@x402/next`) runs the handler **after** verifying the payment
and **settles after** the handler returns, only when its status is < 400. The handler therefore never sees the
tx hash. [`lib/api/paid-route.ts`](../lib/api/paid-route.ts) wraps the handler returned by `withX402`:

1. outer wrapper: rate limit, body size, `Idempotency-Key` format, idempotent replay/conflict (before payment);
2. `withX402`: 402 / payment verification;
3. inner handler: envelope validation (zod) + engine call (`createEntry` / `checkInvoice` / `auditEntries`);
4. `withX402`: settlement, adds `PAYMENT-RESPONSE`;
5. outer wrapper: decodes `PAYMENT-RESPONSE`, builds `receipt`, rebuilds the body as
   `{ request_id, receipt, ...engineResult }`, persists the receipt, returns 200.

The `withX402` handler is created lazily on the first request (per mode/endpoint/payTo), so `next build` never
contacts the facilitator. SDK error bodies (`{ error: "invalid_…" }`) are normalised into the API error envelope.

Receipt (ADR-006):
```json
{ "amount": "0.15", "amount_atomic": "150000", "asset": "USDC", "network": "base-sepolia",
  "network_caip2": "eip155:84532", "tx_hash": "0x…", "payer": "0x…", "pay_to": "0x…",
  "explorer_url": "https://sepolia.basescan.org/tx/0x…" , "mode": "testnet", "paid_at": "2026-…Z" }
```

## 5. Request envelopes

- `/invoice/check`, `/entry`: `{ "input": EngineInput, "profile"?: ClientProfile, "history"?: InvoiceFingerprint[], "use_server_history"?: boolean }`
  - formats: entry = `json | facturx | ubl | bank_transaction | pdf | image`; check = same without `bank_transaction`.
  - `use_server_history: true` (opt-in) adds the fingerprints of invoices previously booked through `/entry` for the
    same client SIREN (duplicate detection across calls). Off by default so outputs stay deterministic for a given body.
- `/audit`: `{ "items": AuditEntryInput[] (1..50), "profile"?: ClientProfile }`.

Types: [`engine/types.ts`](../engine/types.ts). Only the envelope is validated by the API
([`lib/api/envelope.ts`](../lib/api/envelope.ts)); the invoice itself is validated by the engine.

## 6. Errors: `{ "error": { "code", "message", "details"?, "docs_url" }, "request_id" }`

Every error has status ≥ 400, so `withX402` never settles: **an agent is never charged for a failed call**.

**Ordering decision:** an unpaid request gets **402 first** (even with an invalid body) so the agent always
learns the price; a paid but invalid request gets 4xx and is **not settled** (the signed authorization is never
submitted and can even be reused). Exceptions checked before the 402 because they are about the transport,
not the content: `RATE_LIMITED`, `PAYLOAD_TOO_LARGE`, `INVALID_IDEMPOTENCY_KEY`, and idempotent replays/conflicts.

| Code | HTTP | Meaning |
|---|---|---|
| `PAYMENT_REQUIRED` | 402 | no payment; read `PAYMENT-REQUIRED` |
| `PAYMENT_INVALID` | 402 | payment rejected (`details.reason`, e.g. `invalid_exact_evm_signature`, `invalid_exact_evm_insufficient_balance`, `invalid_exact_evm_nonce_already_used`) |
| `PAYMENT_SETTLEMENT_FAILED` | 402 | result computed but settlement failed; result withheld |
| `INVALID_JSON` / `INVALID_INPUT` / `BATCH_TOO_LARGE` / `INVALID_IDEMPOTENCY_KEY` | 400 | |
| `NOT_FOUND` / `INVALID_RECEIPT_ID` | 404 / 400 | receipts endpoint |
| `IDEMPOTENCY_CONFLICT` / `IDEMPOTENCY_IN_PROGRESS` | 409 | |
| `PAYLOAD_TOO_LARGE` | 413 | body > 5 MB |
| `UNSUPPORTED_FORMAT` | 415 | `details.supported_formats` |
| engine document errors (`INVALID_PDF`, `INVALID_XML`, `FACTURX_XML_NOT_FOUND`, …) | 422 | code passed through from the engine |
| `RATE_LIMITED` | 429 | `Retry-After` header |
| `INTERNAL` | 500 | |
| `FACILITATOR_UNAVAILABLE` | 502 | |
| `LLM_UNAVAILABLE` / `ENGINE_UNAVAILABLE` / `SERVICE_MISCONFIGURED` | 503 | |

Descriptions for discovery files: `ERROR_DESCRIPTIONS` in [`lib/api/errors.ts`](../lib/api/errors.ts).

## 7. Idempotency

- Same `Idempotency-Key` + same endpoint + same body (canonical JSON: key order/whitespace ignored) → the stored
  response (same `request_id`, original `receipt`, original `PAYMENT-RESPONSE` header) with `Idempotent-Replay: true`.
  This check runs **before payment verification**: the agent can resend with or without a payment and is not charged again.
- Same key + different body or endpoint → 409 `IDEMPOTENCY_CONFLICT` (`details.original_request_id`).
- Two concurrent calls with the same key → 409 `IDEMPOTENCY_IN_PROGRESS` (in-process guard against double charge).
- Only successful, settled calls are stored; a failed call can be retried with the same key.
- `GET /api/v1/receipts/{request_id}` (free) returns `{ request_id, endpoint, created_at, receipt, result }`.
- Trade-off (PoC): whoever knows a key **and** the exact body can replay the result; keys should be random UUIDs.

## 8. Storage ([`lib/store/`](../lib/store/index.ts))

`Store { saveReceipt, getReceipt, getByIdempotencyKey, listRecent, stats, saveFingerprint, history }`.
`stats()` returns `calls_served`, `usdc_earned`, `by_mode`, `revenue_per_endpoint`, `recent_transactions` (for `/operator`).

`STORE_KIND` = `auto` (default) | `memory` | `file` | `neon` | `upstash`. Auto: Neon if `DATABASE_URL`/`POSTGRES_URL`
(tables `ajean_receipts`, `ajean_fingerprints` created IF NOT EXISTS), else Upstash if
`UPSTASH_REDIS_REST_URL`+`TOKEN` or `KV_REST_API_URL`+`TOKEN`, else memory. `file` writes `data/receipts.local.json`
(gitignored; override `STORE_FILE_PATH`). Storage is optional: any adapter error is logged once and the store
serves from memory (primary retried after 60 s). `getStoreKind()` / `getStoreInfo()` expose the effective kind.
All in-process state (store, x402 servers, simulated nonces, rate limit) lives on `globalThis`, so every route
bundle shares it.

## 9. Run it

```bash
# simulated (offline, no funds)
PAYMENT_MODE=simulated npm run dev
curl -i -X POST localhost:3000/api/v1/entry -d '{}' -H 'content-type: application/json'   # → 402 + PAYMENT-REQUIRED
npm run pay:simulated                       # 402 → pay → 200 + 0x5151… tx, replay, receipt
                                            # (no AGENT_PRIVATE_KEY? an ephemeral in-memory key is used, with a note)
npm run pay:simulated -- --endpoint check   # or audit; --url http://host:port
npm run smoke                               # no payment: health + 402 requirements of the 3 endpoints + receipts 404

# real testnet payment
# 1) fund the agent wallet with test USDC: https://faucet.circle.com (Base Sepolia, AGENT_ADDRESS in .env.local)
PAYMENT_MODE=testnet npm run dev
npm run pay:testnet                         # checks USDC balance first, then pays; prints the Basescan link

# tests (no network)
npx vitest run tests/payments* tests/api*
```

Scripts read `.env.local` (`AGENT_PRIVATE_KEY`, `AJEAN_LEDGER_URL`, default `http://localhost:3000`), never print
keys, and use `fixtures/01.json` `.input` as the body when it exists (else an inline synthetic invoice).
`pay:testnet` exits with code 3 and the faucet message when the balance is below the price.

## 10. x402 API surface used

- `@x402/core/server`: `x402ResourceServer` (`.register`), `HTTPFacilitatorClient`, types `FacilitatorClient`, `RouteConfig`
  (`accepts`, `description`, `mimeType`, `serviceName`, `tags`, `unpaidResponseBody`, `settlementFailedResponseBody`).
- `@x402/core/http`: `decodePaymentRequiredHeader`, `decodePaymentResponseHeader`.
- `@x402/core/types`: `PaymentPayload`, `PaymentRequirements`, `SettleResponse`, `VerifyResponse`, `SupportedResponse`.
- `@x402/next`: `withX402(handler, routeConfig, server)`.
- `@x402/evm/exact/server`: `ExactEvmScheme` (price given as `AssetAmount {asset, amount, extra {name, version}}`).
- Client (scripts/tests): `@x402/fetch` `wrapFetchWithPayment`, `x402Client`; `@x402/core/client` `x402HTTPClient`;
  `@x402/evm/exact/client` `ExactEvmScheme(viemAccount)`.

## 11. Verified (2026-11-16)

- `npx vitest run tests/payments* tests/api*`: 29 tests (402 requirements for the 3 endpoints, full paid flow via
  `@x402/fetch` against the route handlers + simulated facilitator, tampered/replayed payments, error codes, not
  charged on errors, idempotency replay/conflict, receipts, health, store fallback).
- `npm run pay:simulated` against `next dev` with the real engine: 402 → 200, tx `0x5151…`, replay, receipt (all 3 endpoints).
- Testnet server (`PAYMENT_MODE=testnet`, real x402.org facilitator): 402 OK; paid call with the unfunded agent →
  402 `PAYMENT_INVALID` `invalid_exact_evm_insufficient_balance` (proves verify against the real facilitator).
  The first real on-chain settlement awaits funding of the agent wallet.

## 12. Known limitations

- Rate limit (Phase 6): fixed 60 s window per client IP (`CF-Connecting-IP` on Cloudflare, else `X-Real-IP` /
  first `X-Forwarded-For` hop), **per server instance** (each Cloudflare isolate counts on its own — a PoC
  trade-off, no shared counter). Paid endpoints + `/mcp`: `RATE_LIMIT_PER_MINUTE` (default 120); console
  `/api/demo/run`: `DEMO_RUN_RATE_LIMIT_PER_MINUTE` (default 30). 0 disables. Published in the catalog
  (`limits.rate_limit_per_minute`) and `llms.txt` (## Limits). The idempotency in-flight guard is per instance too.
- Vitest loads `@x402/next` via its CJS build in `tests/api.test.ts` (its ESM build imports `next/server` without
  extension, which Node's ESM resolver rejects). Adding `server: { deps: { inline: ["@x402/next"] } }` to
  `vitest.config.ts` would remove that workaround. Next.js dev/build are unaffected.
- No CORS headers (agents call server-to-server).
