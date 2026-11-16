# Brief Compliance Checklist

Living map from each course-brief requirement and grading criterion (master prompt §1) to concrete evidence.
Legend: ✅ done · 🟡 in progress / partial · ⬜ not started.
**Last updated:** 2026-11-16, end of Phase 6 (hardening). Public demo: <https://ajean-ledger.ary-sidoun.workers.dev>.

## A. Core challenge requirements

| # | Requirement (brief) | Status | Evidence (file / endpoint / screen / demo step) | Phase |
|---|---|---|---|---|
| A1 | Original business idea | ✅ | Paid-per-call accounting brain for AI agents, timed on the French e-invoicing reform (reception mandatory since 1 Sept 2026, SME issuance 1 Sept 2027): `README.md`, `deliverables/CONCEPT_NOTE.md` (draft) | 0 / 7 |
| A2 | Application **specifically designed for AI agents** (agents are the direct users) | ✅ | JSON-only API `app/api/v1/*`; discovery `GET /api/v1/catalog`, `/openapi.json`, `/llms.txt`, `/.well-known/agent.json`; MCP `/mcp` + stdio bridge `mcp/server.ts`; machine-readable error codes (`lib/api/errors.ts`); idempotency + free receipts (`docs/PAYMENTS.md` §6–7) | 2–3 |
| A3 | **Not** a human app with a chatbot attached | ✅ | No human UI in the product path: the API is the product; `/live` and `/operator` only *observe* agent traffic ("a window into agent-to-agent traffic", `docs/CONSOLE.md`) | 5 |
| A4 | Show **what an agent requests and what it receives** | ✅ | `/live`: raw HTTP timeline (request → 402 + decoded `PAYMENT-REQUIRED` → `PAYMENT-SIGNATURE` → 200 + `PAYMENT-RESPONSE`) beside the structured result; `npm run agent` step-by-step log; `npm run pay:simulated` prints the decoded headers | 4–5 |
| A5 | Payments in **crypto / stablecoins** | ✅ | x402 v2 (`@x402/*` 2.31.0), USDC on Base Sepolia (`eip155:84532`, test USDC `0x036C…CF7e`), EIP-3009 signatures, x402.org facilitator in TESTNET (ADR-002, ADR-005, ADR-007, `docs/PAYMENTS.md`). Agent wallet funded with test USDC; real on-chain settlement sequence in `docs/HOSTING.md` §7 | 2, 6 |

## B. PoC deliverable

| # | Requirement | Status | Evidence | Phase |
|---|---|---|---|---|
| B1 | Representative agent request | ✅ | Demo purchasing agent of *Atelier Lumenor SAS (fictional)* processing `inbox/` (`agent/`, `docs/AGENT.md`); console scenarios 01/03/04/06 via `POST /api/demo/run` | 4 |
| B2 | Service's key function | ✅ | `/engine` + `POST /api/v1/entry` / `invoice/check` / `audit`; 13 synthetic fixtures with expected outputs, `npm test` (209 tests green); `npm run -s engine -- fixtures/03.json` | 1–2 |
| B3 | Result returned to the agent | ✅ | §5.4 response contract (`request_id`, `receipt` with tx hash, compliance checks with `rule_id`, balanced entry, VAT, anomalies, confidence, `human_review_required`, explanation, engine info); zod/OpenAPI schemas in `lib/discovery/schemas.ts` | 1–2 |
| B4 | Simulated data / interactions clearly defined | ✅ | Synthetic-only fixtures with unallocated `000…` SIRENs and "(fictional)" names (ADR-021, enforced by a test); SIMULATED and REPLAY badges with a tooltip and a click-to-open legend of the three modes on `/live` (`lib/console/modes.ts`); fake tx hashes labelled `0x5151…` | 1, 5, 6 |
| B5 | Shareable link to prototype UI | ✅ | <https://ajean-ledger.ary-sidoun.workers.dev> (Cloudflare Workers free plan, ADR-020); `npm run warmup` → READY FOR DEMO | 5–6 |
| B6 | Step-by-step demo sequence | ✅ | `deliverables/DEMO_SCRIPT.md` (timed 2:35, real URL, fixture 03 amounts from the engine, fallback ladder, Day-J warmup); team roles still to fill | 6–7 |
| B7 | **Prompts used to build the prototype** | 🟡 | `docs/prompts/00_MASTER_PROMPT.md` (verbatim), `docs/prompts/PROMPT_LOG.md`; final export `PROMPTS_SUBMISSION.md` in Phase 7 | 0 → 7 |

## C. Other deliverables

| # | Requirement | Status | Evidence | Phase |
|---|---|---|---|---|
| C1 | Concept note ≤ 2 pages, brief structure | 🟡 | `deliverables/CONCEPT_NOTE.md` (draft, ~1,000 words); 2-page export check in Phase 7 | 7 |
| C2 | Presentation 8–10 min, 6–8 slides | 🟡 | `deliverables/SLIDES_OUTLINE.md` (draft, 7 slides + backups, speaker notes) | 7 |
| C3 | 2–3 min live demo that cannot fail | ✅ | Three modes (TESTNET / SIMULATED / REPLAY, ADR-005); console fallback ladder live → replay API → bundled replay, automatic on network error, timeout, 5xx (e.g. Cloudflare 1102), 429 or agent error (`lib/console/source.ts`, `tests/console.test.ts`); `/operator` falls back to replay stats with an empty store; API store failure → memory (`tests/api.test.ts`); rate limits sized for warmup + two full demos; `npm run warmup` banner; DEMO_SCRIPT ladder | 2, 5, 6 |
| C4 | Q&A preparation | 🟡 | `deliverables/QA_PREP.md` (draft, 12 questions) | 7 |

## D. Grading criteria

| Criterion | Weight | Status | Evidence |
|---|---|---|---|
| Economic relevance & innovation | 30% | ✅ | Real pain (agents mis-booking French invoices, e-invoicing reform 2026/2027, VAT deduction errors): the fixture 03 story deducts only the VAT legally due (ADR-018) and flags it; concept note draft |
| Fit for AI-agent use | 25% | ✅ | Payment = authentication (x402, no sign-up, no API key); 402 with machine-readable requirements; discovery files + MCP (remote and stdio); idempotency keys, receipts, stable `rule_id`s, error codes; agent spending policy (`max_per_call` 0.20, `daily_budget` 2.00) enforced in code; rate limits published in the catalog and `llms.txt` |
| Quality of the PoC | 20% | ✅ | End-to-end real service: engine (13 fixtures), paid API, discovery, MCP, demo agent, console, public deployment; 209 tests, `tsc` clean; Phase 1 independent review applied (`docs/reviews/PHASE1_REVIEW.md`); fresh-clone run-through green without any `.env` (Phase 6) |
| Commercial potential | 15% | 🟡 | Per-call pricing 0.05 / 0.15 / 1.00 USDC from one config (`lib/payments/pricing.ts`); `/operator` shows calls served and USDC earned per endpoint; payer = agent operator; pricing illustration in the concept note (Phase 7) |
| Final presentation | 10% | 🟡 | Demo script + slides outline drafts; demo hardened (warmup, fallbacks, replays); rehearsal from the public URL in Phase 7 |

## E. Hosting (free plan) — Cloudflare Workers

| Item | Status | Evidence / impact |
|---|---|---|
| Free plan only, no Vercel (account paused) | ✅ | ADR-017, ADR-020; `wrangler.embedded.jsonc`; `npm run cf:deploy:embedded` |
| 100,000 requests / day | ✅ | One demo run ≈ 5 requests (console call + agent self-calls); static assets are served by the Worker (ADR-020) but a page view is a handful of requests. Per-IP rate limits (120/min paid endpoints + `/mcp`, 30/min demo runs) keep one client from draining the quota (`lib/api/rate-limit.ts`). |
| 10 ms CPU per request | ✅ (mitigated) | JSON paid call ≈ 6 ms warm; Factur-X PDF and 50-item audits can exceed it (`docs/HOSTING.md` §5). Mitigations: live demo uses JSON fixtures, `npm run warmup` absorbs cold starts, any 1102/5xx in the console → automatic REPLAY. |
| KV 1,000 writes / day | ✅ | ≈ 4 writes per paid call → ≈ 250 paid calls/day; any KV error → memory fallback (`ResilientStore`, tested). |
| Worker size 64 MiB / startup 1 s | ✅ | ≈ 12.6 MiB raw / 2.8 MiB gzip, startup ≈ 14 ms (ADR-020). |
| Pitch argument | ✅ | x402 was co-created by Coinbase and Cloudflare: running an agent-payment service on Cloudflare is coherent with the protocol's ecosystem (ADR-017, `README.md`). |

## F. Phase 6 hardening (master prompt §7)

| Item | Status | Evidence |
|---|---|---|
| Record 3 replay runs | ✅ (simulated) / 🟡 (testnet) | `demo/replays/01, 03, 04, 06.json` recorded from real agent runs against a SIMULATED server; re-record with real Base Sepolia tx hashes: `npm run record:replays -- --public` after the testnet switch (`docs/HOSTING.md` §7) |
| Check the fallbacks | ✅ | live → REPLAY, `/operator` empty store → replay stats, store failure → memory: tests in `tests/console.test.ts`, `tests/agent.test.ts`, `tests/api.test.ts`; `docs/CONSOLE.md` |
| Rate limiting (simple) | ✅ | `lib/api/rate-limit.ts` on the 3 paid endpoints, `/mcp` and `/api/demo/run`; `CF-Connecting-IP`; 429 + `Retry-After`; documented in catalog `limits` and `llms.txt` |
| README quickstart (3 commands) | ✅ | `README.md` (clone + `npm ci`, `npm test`, `npm run dev`; "Try it as an agent") |
| Fresh-clone run-through | ✅ | `git clone` → `npm ci` → `npm test` → `tsc --noEmit` → `npm run build` → `next start` (SIMULATED) → `npm run agent`, `pay:simulated` (entry/check/audit), `warmup` (17/17 READY), `smoke`, `record:replays --dry-run`, MCP check, `npm run dev`: all green without `.env.local` |
| Demo twice in a row from the public URL | 🟡 | `npm run warmup` (public URL default, READY banner) + two full demos verified locally without hitting limits; to repeat on the public URL after the next deploy |
| Bonus: credit packs, EURC | ⬜ | Not started (ADR-015: only after Phases 1–7) |

## G. Traceability & safety rules (§2, §4)

| Rule | Status | Evidence |
|---|---|---|
| Master prompt saved verbatim | ✅ | `docs/prompts/00_MASTER_PROMPT.md` |
| Prompt log entry per message | ✅ | `docs/prompts/PROMPT_LOG.md` |
| Decisions log | ✅ | `docs/DECISIONS.md` (ADR-001 → ADR-021) |
| Changelog | ✅ | `CHANGELOG.md` (Phases 0–6) |
| Git, one commit per step | ✅ | `git log`; pushed to `ArySid/ajean-ledger` (ADR-009) |
| Testnet only, no secrets committed | ✅ | `.gitignore` ignores `.env*` except `.env.example`; `cf:build` secret scan; Worker secrets via `wrangler secret put`; scripts never print keys |
| Synthetic data only, PoC disclaimer | ✅ | Fictional parties + `000…` SIRENs (ADR-021, test); disclaimer in API responses, `llms.txt`, README; ambiguous cases → `human_review_required: true` |
| Legal references curated and reviewed | 🟡 | `engine/rules/legal-basis.ts` + `docs/LEGAL_REVIEW.md`: no article number shown until Ary signs it off |
