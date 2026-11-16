# Demo client agent (Phase 4)

The demo agent is the **client** that the jury watches: the autonomous purchasing agent of
**Atelier Lumenor SAS (fictional)**. It gets a French supplier invoice, does not know the French
rules, finds Ajean Ledger, checks its spending policy, pays **0.15 USDC in one HTTP request** (x402 v2),
receives a validated entry, posts it to a mock ERP and flags what a human must check.

It only talks to Ajean Ledger over HTTP + x402, like any third-party agent would.

## Run it

```bash
# 1. a server (simulated payments, offline)
PAYMENT_MODE=simulated npm run dev            # or: npx next build && PAYMENT_MODE=simulated npx next start -p 3500

# 2. the agent processes inbox/*.json once, sorted
npm run agent                                 # AJEAN_LEDGER_URL (default http://localhost:3000) or --url
npm run agent -- --only 03                    # one item (comma-separated ids)
npm run agent -- --max-per-call 1.00          # policy override: lets the 1.00 USDC audit request through
npm run agent -- --llm                        # Claude chooses the order of actions (needs ANTHROPIC_API_KEY)
npm run agent -- --watch                      # keep watching inbox/ for new files
#   other flags: --daily-budget <usdc>  --keep-erp  --reset-budget  --json (print the traces)
```

| File | Role |
|---|---|
| `inbox/*.json` | Incoming items: envelope only (sender, subject, channel, task) + the fixture id. The invoices stay in `fixtures/NN.json` (source of truth). `06` is a reminder re-sending invoice 01; `90` is a CFO request for a 1.00 USDC batch audit (policy-refusal demo). |
| `data/erp.local.json` | Mock ERP (gitignored). Reset at each CLI run unless `--keep-erp`. Each record keeps the lines, the `request_id`, the receipt (tx hash) and the review reasons. Suspected duplicates are stored as `draft`. |
| `data/agent-spend.local.json` | Daily spend ledger (gitignored), per UTC day, kept across runs. `--reset-budget` clears it. |

Wallet: `AGENT_PRIVATE_KEY` from `.env.local` (throwaway testnet key, never printed nor put in a trace).
If it is missing and the server is in SIMULATED mode, an ephemeral key is generated and labelled.

## What one run does (= one `AgentTrace`, `lib/trace/types.ts`)

| # | Step kind | What happens |
|---|---|---|
| 1 | `reasoning` | What I received (supplier, number, amount, line items), what I don't know (built from the document: foreign supplier, restaurant bill, credit note…), why I need a service. |
| 2 | `discovery` | `GET /api/v1/catalog` (free): finds the endpoint for the task (`entry`, `invoice_check`, `audit`) and its price, payTo, asset, network. Parser is tolerant to the catalog shape; falls back to `/api/health` prices. |
| 3 | `discovery` | `GET /api/health`: the payment mode is decided by the **server** (TESTNET / SIMULATED). |
| 4 | `policy` | `price ≤ max_per_call` **and** `spent_today + price ≤ daily_budget` → allow; else refuse with the reason, escalate (`review` step), outcome `refused_by_policy`, nothing signed. |
| 5-6 | `http_request` / `http_response` | `POST` without payment → `402` + `PAYMENT-REQUIRED` (decoded in `http.decoded`). The agent checks amount / asset / network / payTo / scheme against what discovery advertised; any mismatch → refusal. |
| 7 | `payment` | Signs the EIP-3009 `transferWithAuthorization` with `x402HTTPClient` + `ExactEvmScheme` (from `@x402/core/client`, `@x402/evm`). The low-level client is used instead of `wrapFetchWithPayment` so both HTTP requests are explicit in the trace. |
| 8-9 | `http_request` / `http_response` | Same `POST` + `PAYMENT-SIGNATURE` + `Idempotency-Key` → `200` + `PAYMENT-RESPONSE` (decoded). On `402 PAYMENT_INVALID` (e.g. unfunded wallet: `invalid_exact_evm_insufficient_balance`) → `error` step "my wallet has no test USDC", not charged. |
| 10 | `settlement` | tx hash, explorer link (null when SIMULATED), receipt `request_id`; the spend ledger is updated. |
| 11 | `erp` | Lines appended to the mock ERP: `posted`, `posted_review_pending`, or `draft` (duplicate suspected). |
| 12 | `review` | If `human_review_required`: plain-language message to the bookkeeper per reason (e.g. 20% VAT on a restaurant bill where 10% is expected; duplicate of an invoice already booked). |
| 13 | `reasoning` | Wrap-up: cost, spent today, notes (e.g. reverse-charge self-assessment), the service's explanation relayed to the operator. |

Outcomes: `posted`, `posted_with_review`, `refused_by_policy`, `error`. `runAgent` never throws: on
any failure it returns the steps so far with outcome `error`. Every run has a 40 s deadline.

What goes in a trace: method, URL, status, an allowlist of protocol headers (`content-type`,
`Idempotency-Key`, `PAYMENT-*`, `X-Request-Id`, `Idempotent-Replay`, `Retry-After`), bodies (long
strings/arrays truncated, the catalog trimmed to service/payment/endpoints/discovery), decoded x402
headers. `PAYMENT-SIGNATURE` is kept truncated and its decoded `signature` is redacted. No private key.

Duplicate detection: the agent sends the fingerprints of the invoices already booked in its ERP
(`history`) plus, for an item processed on its own, the ERP state described by the fixture
(`fixtures/06.json` `.context.history`). So `npm run agent` finds 06 as a duplicate of 01 because it
just booked 01, and `/api/demo/run {scenario: "06"}` finds it from the seeded history.

## Spending policy

Env `AGENT_MAX_PER_CALL_USDC` (default `0.20`), `AGENT_DAILY_BUDGET_USDC` (default `2.00`);
CLI overrides `--max-per-call`, `--daily-budget`. Deterministic code (`agent/policy.ts`, atomic-unit
arithmetic), never decided by the LLM. Demo of a refusal: `inbox/90-year-end-audit-request.json`
(`/api/v1/audit` = 1.00 USDC > 0.20) → `refused_by_policy`; run with `--max-per-call 1.00` to let it pay.

## LLM reasoning (optional)

`reasoning: "llm"` (`--llm`) with `ANTHROPIC_API_KEY` set: Claude (`ANTHROPIC_MODEL`, default
`claude-sonnet-5-5`) drives the run through tool use (`discover_service`, `check_policy`,
`call_paid_endpoint`, `post_to_erp`, `flag_for_review`) and writes one sentence before each action
(shown as `reasoning` steps). The tools run the same deterministic code as the scripted path: the
policy and the payment cannot be bypassed by the model. Without a key, or on any API error, the
scripted procedure takes over (already-done actions are skipped). The LLM path is not covered by the
tests (no network in tests) and was not exercised in this session (no key configured).

## Server routes (used by the `/live` and `/operator` console)

| Route | Behaviour |
|---|---|
| `POST /api/demo/run` `{scenario: "01"\|"03"\|"04"\|"06", mode?, reasoning?}` | Runs `runAgent` in-process against **the same deployment** (base URL from the request host, override `AJEAN_LEDGER_INTERNAL_URL`), real HTTP + x402. Returns the `AgentTrace`, `mode` = server payment mode (`TESTNET`/`SIMULATED`). On failure: HTTP 200, `outcome: "error"`, the steps so far, `fallback_hint: "replay"`. Guards: 1 concurrent run per instance (`429 DEMO_BUSY`), its own per-IP rate limit (30/min, `429 RATE_LIMITED`), 40 s run deadline (`maxDuration` 60). Wallet: `AGENT_PRIVATE_KEY`; if missing, an ephemeral key in SIMULATED only (labelled in step 1), error trace in TESTNET. Spend: per-instance memory ledger in TESTNET; each SIMULATED run starts at 0 (fake money, keeps rehearsals from hitting the budget). ERP: memory. |
| `GET /api/demo/replays?scenario=03` | The recorded trace `demo/replays/03.json`, `mode` forced to `REPLAY`. Without `scenario`: the list. Unknown scenario: 404. Bundled at build time (no fs at runtime). |
| `GET /api/v1/operator/stats` (free) | `{calls, usdc_earned, by_endpoint:[{endpoint, calls, usdc}], by_mode, recent:[{request_id, at, endpoint, payer, amount, tx_hash, explorer_url, mode}], source, generated_at}` from `getStore().stats()`; `source` = store kind (`memory`/`file`/`neon`/`upstash`). With 0 calls served: aggregated from the replays, `source: "replay"`. USDC amounts are decimal strings. |

Deployment note: `/api/demo/run` calls its own public URL (on Cloudflare Workers the self-call goes back
through the front door, `global_fetch_strictly_public`); if the deployment sits behind an access gate,
set `AJEAN_LEDGER_INTERNAL_URL` so the self-call is not blocked. Rate limit: 30 demo runs per client IP and
minute (`DEMO_RUN_RATE_LIMIT_PER_MINUTE`, 429 + `fallback_hint: "replay"`).

## Recorded replays

```bash
PAYMENT_MODE=simulated npx next start -p 3500        # or npm run dev
AJEAN_LEDGER_URL=http://localhost:3500 npm run record:replays   # --dry-run to check without writing
```

Runs 01, 03, 04, 06 in order with one shared ERP and spend ledger (a working day), checks the expected
outcomes (`posted`, `posted_with_review`, `posted`, `posted_with_review`) and only then overwrites
`demo/replays/NN.json` (`mode: "REPLAY"`, `recorded_from` = server mode, `recorded_at`; no `sample`).
Once the agent wallet holds test USDC, re-record against a `PAYMENT_MODE=testnet` server to get
replays with real Base Sepolia tx hashes.

## Code map

`agent/core.ts` (runAgent, AgentRun steps, catalog parser) · `agent/policy.ts` (policy + ledgers) ·
`agent/erp.ts` (mock ERP) · `agent/inbox.ts` (inbox → items) · `agent/scenarios.ts` (bundled demo
scenarios) · `agent/narrative.ts` (scripted texts) · `agent/http.ts` (traced fetch, header allowlist,
redaction) · `agent/llm.ts` (optional tool-use driver) · `agent/replays.ts` · `agent/cli.ts` ·
`scripts/record-replays.ts` · `tests/agent.test.ts`.

## Tests

`npx vitest run tests/agent*` — no network: policy cases, catalog parsing, inbox, full scripted runs
against the real route handlers + real engine dispatched in-process (PAYMENT_MODE=simulated):
03 (VAT anomaly → review), 01→06 (duplicate → draft), 04 (reverse charge), audit refusal and
override, daily budget, 402/catalog mismatch, unfunded wallet, service down, LLM fallback, and the
three routes (`/api/demo/run` end to end, replays, operator stats from store and from replays).
