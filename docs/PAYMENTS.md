# Payments & paid API (Phase 2)

Ajean Ledger is paid per call in USDC with the **x402 v2** HTTP payment protocol. AI agents are the
users: **payment is the authentication** (no sign-up, no API key). Testnet only: Base Sepolia
(`eip155:84532`), Circle test USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e` (default) and, since the
Phase 6 bonus, Circle test **EURC** `0x808456652fdb597867f38412077A9182bf77359F` as a second accepted
stablecoin (§13, ADR-024). Agents can also prepay with **credit packs** (§14, ADR-025).

SDK: `@x402/core`, `@x402/next`, `@x402/evm`, `@x402/fetch` — all pinned **2.31.0** (ADR-002).

## 1. Endpoints and prices

Single source of truth: [`lib/payments/pricing.ts`](../lib/payments/pricing.ts) (`PAID_ENDPOINTS`,
`FREE_ENDPOINTS`). Catalog, OpenAPI, llms.txt, agent.json and MCP tools must read prices from there.

| Endpoint | Price (USDC) | Atomic (6 dec.) | MCP tool |
|---|---|---|---|
| `POST /api/v1/invoice/check` | 0.05 | 50000 | `check_invoice` |
| `POST /api/v1/entry` | 0.15 | 150000 | `create_entry` |
| `POST /api/v1/audit` (1..50 items) | 1.00 | 1000000 | `audit_entries` |
| `POST /api/v1/credits` (`{"pack":"starter"}` / `"pro"`) | 1.00 / 10.00 | 1000000 / 10000000 | (HTTP only) |
| `GET /api/v1/credits/balance` | free | | |
| `GET /api/v1/receipts/{id}` | free | | |
| `GET /api/health` | free | | |

Every paid price is also payable in EURC (`accepts[1]`): check 0.05, entry 0.14, audit 0.93, starter 0.93,
pro 9.26 EURC (derived, §13).

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
| `PAYMENT-REQUIRED` | server → agent, on 402 | base64 JSON `PaymentRequired`: `x402Version: 2`, `resource {url, description, mimeType}`, `accepts[0] {scheme: "exact", network: "eip155:84532", amount: "150000", asset: <USDC>, payTo, maxTimeoutSeconds: 300, extra {name: "USDC", version: "2"}}`, `accepts[1]` = same with `asset: <EURC>`, `amount: "140000"`, `extra {name: "EURC", version: "2"}` |
| `X-Credit-Token` | agent → server | optional prepaid alternative to `PAYMENT-SIGNATURE` (§14) |
| `X-Credit-Balance` | server → agent | remaining USDC credit after a call paid with `X-Credit-Token` |
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

Receipt (ADR-006; `method`, `asset_address` and EURC since ADR-024/025):
```json
{ "method": "x402", "amount": "0.15", "amount_atomic": "150000", "asset": "USDC",
  "asset_address": "0x036C…CF7e", "network": "base-sepolia", "network_caip2": "eip155:84532",
  "tx_hash": "0x…", "payer": "0x…", "pay_to": "0x…",
  "explorer_url": "https://sepolia.basescan.org/tx/0x…" , "mode": "testnet", "paid_at": "2026-…Z" }
```
`asset` is the asset actually paid, read from the `PAYMENT-SIGNATURE` payload (`accepted.asset`): an EURC payment
gives `"asset": "EURC", "amount": "0.14"`. Receipts stored before ADR-024 have no `method` / `asset_address` and
are read as x402 USDC.

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

`Store { saveReceipt, getReceipt, getByIdempotencyKey, listRecent, stats, saveFingerprint, history, getCredit, saveCredit }`.
`stats()` returns `calls_served`, `usdc_earned`, `by_mode`, `revenue_per_endpoint(_by_mode)` (now with `eurc` and
`credit_calls`), `revenue_by_asset` (cash per asset), `credits` (packs sold per asset, calls paid with credits,
credit consumed) and `recent_transactions` (with `asset` and `method`) for `/operator`. Counters are keyed
`mode:endpoint:channel` (channel = `USDC` | `EURC` | `credits`; legacy `mode:endpoint` keys read as USDC).

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

# EURC instead of USDC (selects accepts[1]; works in both modes)
npm run pay:simulated -- --asset EURC       # → receipt.asset "EURC", amount 0.14

# prepaid credits: buy a pack, then calls with X-Credit-Token (no signature per call)
npm run pay:credits                         # starter: 1.00 → 1.20 USDC; 2 entry calls; balance 0.90; replay = same token
npm run pay:credits -- --pack pro --asset EURC --calls 3

# tests (no network)
npx vitest run tests/payments* tests/api* tests/bonus*
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

## 13. EURC — second accepted stablecoin (ADR-024)

- **Contract (verified on-chain, `sepolia.base.org` `eth_call`, 2026-11-16):** `0x808456652fdb597867f38412077A9182bf77359F`,
  `name()` = `"EURC"`, `version()` = `"2"`, `decimals()` = 6, `DOMAIN_SEPARATOR()` = the EIP-712 hash of
  `{name "EURC", version "2", chainId 84532, verifyingContract}`, `TRANSFER_WITH_AUTHORIZATION_TYPEHASH()` = the
  EIP-3009 typehash (Circle FiatToken v2, same family as USDC). So the `exact` EVM scheme works unchanged.
- **Facilitator:** `https://x402.org/facilitator/supported` lists kinds per (scheme, network), not per asset
  (`exact` on `eip155:84532`). A `/verify` probe with an EURC authorization signed by an unfunded throwaway key
  returned `invalid_exact_evm_insufficient_balance` from the simulated `transferWithAuthorization` on the EURC
  contract (USDC: same; a non-token address: `asset_not_deployed_contract`), i.e. the signature and EIP-712 domain
  were accepted and only the balance failed. **Verdict: EURC is supported in TESTNET too.** No real EURC payment was
  made: the agent wallet holds 0 test EURC (Circle faucet https://faucet.circle.com → Base Sepolia → EURC funds it).
- **Pricing:** one config, `lib/payments/pricing.ts`: `ACCEPTED_ASSETS = ["USDC", "EURC"]` (order = `accepts` order),
  `FX_DEMO` = fixed demo rate **1 EURC = 1.08 USDC**; EURC price = USDC price / 1.08 rounded half-up to the cent
  (`usdcAtomicToEurcAtomic`). An assumption for the PoC, not a live FX quote; documented in every discovery file.
- **402:** every paid endpoint (and the credit packs) lists `accepts[0]` USDC then `accepts[1]` EURC. The simulated
  facilitator verifies EURC exactly like USDC (EIP-712 domain from `extra`, `verifyingContract` = asset).
- **Clients:** the x402 SDK picks `accepts[0]` and filters non-default assets through `spendControls`, so every existing
  client keeps paying USDC. To pay EURC: allow the asset (`spendControls.allowedAssets: [{network, asset: EURC}]`) and
  select it (`paymentRequirementsSelector`). Implemented in `scripts/pay-common.ts` (`--asset EURC`) and the stdio MCP
  bridge (`AJEAN_PAY_ASSET=EURC`; the spending policy budgets EURC at its USDC value, rounded up). The `/live` agent
  (`agent/core.ts`) selects the catalog's default asset (USDC) by address.
- **Receipts and stats:** `receipt.asset` = asset paid; operator stats `earned_by_asset` / per-endpoint `eurc`.
  `usdc_earned` stays USDC only (no FX mixing in revenue).

## 14. Prepaid credit packs (ADR-025)

- **Packs (config `CREDIT_PACKS`):** `starter` 1.00 USDC → 1.20 USDC of calls, `pro` 10.00 USDC → 12.00 USDC (+20 %
  volume bonus), valid 30 days. Payable in USDC or EURC (0.93 / 9.26 EURC); balances are always USDC.
- **Buy:** `POST /api/v1/credits {"pack":"starter"}` → same x402 flow (402 → pay → 200; price chosen by `body.pack`,
  one `withX402` handler per pack). The token is issued **after settlement**:
  `{ request_id, receipt, credit_token: "ajc_…", pack, balance, balance_atomic, asset: "USDC", expires_at, usage }`.
  x402 SDK clients cap a payment at $1 by default: raise `spendControls.maxAmountPerPayment` for `pro`.
- **Token:** opaque bearer, `ajc_` + base64url(HMAC-SHA256(secret, purchase request_id)) (256 bits). The store keeps
  only `sha256(token)` → `{pack, mode, balance_atomic, initial_atomic, expires_at, purchase_request_id, paid_asset, …}`
  (`CreditAccount`). Deriving the token from the purchase lets an **idempotent replay** of the purchase return the
  same token without storing it. `secret` = `CREDIT_TOKEN_SECRET` (optional Worker secret, ≥ 16 chars) or a random
  per-instance secret; without the env secret a replay served by another isolate returns the receipt and balance but
  `credit_token: null` + a note (the token itself is never lost by the buyer who received the 200).
- **Spend:** any paid endpoint with `X-Credit-Token: <token>` and **no** `PAYMENT-SIGNATURE` (a signature wins):
  reserve the USDC price under a per-token lock → engine → 200 with
  `receipt { method: "credits", amount, remaining_balance, credit_token_id, tx_hash: "", explorer_url: null }` +
  `X-Credit-Balance`. Engine/validation error → refund (never debited). No settlement, no facilitator call.
- **Refusals:** low balance → **402 `CREDITS_INSUFFICIENT`**; malformed/unknown/expired/other-mode token → **402
  `CREDIT_TOKEN_INVALID`**. Both carry the normal `PAYMENT-REQUIRED` header (2 accepts) so the agent can pay that call
  with x402, plus `error.details.credits {reason, price_usdc, balance_usdc, expires_at}`. Nothing is debited.
- **Balance:** `GET /api/v1/credits/balance` + header (free) → balance, pack, calls debited, expiry; 404 if unknown.
- **Idempotency:** replays are checked before either payment path, so a retried credit call (same key + body) is
  answered from the stored receipt and never debited twice. Credit calls are stored as normal receipts
  (`GET /api/v1/receipts/{id}` works; pack purchases are stored with `endpoint: "credits"` and never the token).
- **Consistency limits:** the lock is per instance (isolate). Memory/file stores are exact within one process. On
  **Workers KV** (eventually consistent, ~60 s between locations, no transactions) two isolates in different locations
  could both spend the last cents of one token; Neon/Upstash use the same read-modify-write. A production version would
  move balances to a Durable Object or a SQL `UPDATE … SET balance = balance - $price WHERE balance >= $price`.
- **KV quota (free plan, 1,000 writes/day):** a pack purchase = 5 writes (receipt, idem, recent, stats, credit), a
  credit call = 5 (same + the balance), an x402 call = 4 — still ~200 paid calls/day.
- **CPU (10 ms free plan):** a credit call does no signature recovery and no facilitator round trip: one SHA-256 + store
  reads/writes, cheaper than an x402 call.
- **MCP:** the remote `/mcp` tools stay x402-only (x402 MCP transport); the stdio bridge uses `AJEAN_CREDIT_TOKEN`
  first and falls back to x402 on `CREDITS_INSUFFICIENT` / `CREDIT_TOKEN_INVALID`.

