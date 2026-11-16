# Brief Compliance Checklist

Living map from each course-brief requirement and grading criterion (master prompt §1) to concrete evidence.
Legend: ✅ done · 🟡 depends on the team / partial · ⬜ not started.
**Last updated:** 2026-11-16, end of Phase 7 (course deliverables). Public demo: <https://ajean-ledger.ary-sidoun.workers.dev>, **TESTNET mode** (`/api/health` → `payment.mode: "testnet"`, store `cloudflare-kv`).

**Live on-chain proof (Base Sepolia, 0.15 test USDC each, agent `0xD25E…c1BF` → service `0xCB4b84079B1dd19828c3d5733f9e0D2DcB26dFeC`), recorded from the public Worker and used by REPLAY:**
scenario 01 [0x6d48…5b18](https://sepolia.basescan.org/tx/0x6d48cf9f7d5610c47ccc5267c3e3a3c889016dbc6103bf968480e9a043145b18) ·
scenario 03 [0xc155…3586](https://sepolia.basescan.org/tx/0xc1554772f5b9cef69564f6f621d1a12ae5af113d1723cceeec685b28e5b23586) (status 1, USDC transfer of 150000 atomic units, checked on the Base Sepolia RPC) ·
scenario 04 [0x5c01…aea9](https://sepolia.basescan.org/tx/0x5c01600eb9ec856f2c14e76c731427e532183744ca6bd5dbb4e70c9f60a4aea9) ·
scenario 06 [0x3581…3132](https://sepolia.basescan.org/tx/0x3581475920377c6d82614f8afd45a26e355b78045db04f36ef0566c3272f3132).

## A. Core challenge requirements

| # | Requirement (brief) | Status | Evidence (file / endpoint / screen / demo step) | Phase |
|---|---|---|---|---|
| A1 | Original business idea | ✅ | A paid-per-call accounting brain for AI agents, timed on the French e-invoicing reform: `deliverables/CONCEPT_NOTE.md` (2 pages, `deliverables/pdf/CONCEPT_NOTE.pdf`), `README.md` | 0 / 7 |
| A2 | Application **specifically designed for AI agents** (agents are the direct users) | ✅ | JSON-only API `app/api/v1/*`; free discovery: [`/api/v1/catalog`](https://ajean-ledger.ary-sidoun.workers.dev/api/v1/catalog), [`/openapi.json`](https://ajean-ledger.ary-sidoun.workers.dev/openapi.json), [`/llms.txt`](https://ajean-ledger.ary-sidoun.workers.dev/llms.txt), [`/.well-known/agent.json`](https://ajean-ledger.ary-sidoun.workers.dev/.well-known/agent.json) (all 200 live); MCP `/mcp` + stdio bridge `mcp/server.ts`; machine-readable error codes (`lib/api/errors.ts`); idempotency + free receipts (`docs/PAYMENTS.md` §6–7) | 2–3 |
| A3 | **Not** a human app with a chatbot attached | ✅ | No human UI in the product path. The API is the product; `/live` and `/operator` only *observe* agent traffic ("a window into agent-to-agent traffic", `docs/CONSOLE.md`; Phase 5 review §2) | 5 |
| A4 | Show **what an agent requests and what it receives** | ✅ | `/live` shows the raw HTTP timeline (request → 402 with the decoded `PAYMENT-REQUIRED` → `PAYMENT-SIGNATURE` → 200 with `PAYMENT-RESPONSE`) beside the structured result; `npm run agent` prints a step-by-step log; `demo/replays/03.json` | 4–5 |
| A5 | Payments in **crypto / stablecoins** | ✅ | x402 v2 (`@x402/*` 2.31.0), USDC on Base Sepolia (`eip155:84532`, test USDC `0x036C…CF7e`), EIP-3009 signatures, x402.org facilitator; **live in TESTNET** with real settlements (tx links above) (ADR-002, ADR-005, ADR-007, `docs/PAYMENTS.md`) | 2, 6 |

## B. PoC deliverable

| # | Requirement | Status | Evidence | Phase |
|---|---|---|---|---|
| B1 | Representative agent request | ✅ | Purchasing agent of *Atelier Lumenor SAS (fictional)* processing `inbox/` (`agent/`, `docs/AGENT.md`); console scenarios 01/03/04/06/90 via `POST /api/demo/run` | 4 |
| B2 | Service's key function | ✅ | `/engine` + `POST /api/v1/entry` / `invoice/check` / `audit`; 13 synthetic fixtures with expected outputs; `npm test` → **217 tests green (8 files)**; `npm run -s engine -- fixtures/03.json` → D 6257 160.60 / D 44566 14.60 / C 401BOUCHON 175.20 | 1–2 |
| B3 | Result returned to the agent | ✅ | The §5.4 response contract: `request_id`, `receipt` with the tx hash, compliance checks with `rule_id`, a balanced entry, VAT, anomalies, confidence, `human_review_required`, explanation, engine info; zod/OpenAPI schemas in `lib/discovery/schemas.ts` | 1–2 |
| B4 | Simulated data / interactions clearly defined | ✅ | Synthetic-only fixtures with unallocated `000…` SIRENs and "(fictional)" names (ADR-021, enforced by a test); TESTNET / SIMULATED / REPLAY badge with a legend on `/live` (`lib/console/modes.ts`); the REPLAY banner states "recorded from a testnet run on 16 Nov 2026, 11:55 UTC" | 1, 5, 6 |
| B5 | Shareable link to the prototype UI | ✅ | <https://ajean-ledger.ary-sidoun.workers.dev> (Cloudflare Workers free plan, ADR-020); `/`, `/live`, `/operator` return 200 | 5–6 |
| B6 | Step-by-step demo sequence | ✅ | `deliverables/DEMO_SCRIPT.md` (+ PDF): timed at 2:35, real URL, TESTNET as the live default, fixture 03 amounts from the engine, optional scenario 90, fallback ladder, Day-J warmup | 6–7 |
| B7 | **Prompts used to build the prototype** | ✅ | `docs/prompts/PROMPTS_SUBMISSION.md` (+ `deliverables/pdf/PROMPTS_SUBMISSION.pdf`): prompts #01–#04 in chronological order, French originals verbatim with English translations, master prompt verbatim in the appendix, and a "How the prototype was built" note; sources `docs/prompts/00_MASTER_PROMPT.md`, `docs/prompts/PROMPT_LOG.md` | 0 → 7 |

## C. Other deliverables

| # | Requirement | Status | Evidence | Phase |
|---|---|---|---|---|
| C1 | Concept note ≤ 2 pages, in the brief's structure | ✅ | `deliverables/CONCEPT_NOTE.md` → `deliverables/pdf/CONCEPT_NOTE.pdf`: **2 pages A4** (counted with pdf-lib by `npm run export:deliverables`, which fails above 2 pages), ≈ 1,020 words. It covers the problem, agent use case, innovative features, target customers, alternatives, revenue model, x402 stablecoin mechanism (incl. Cloudflare / Coinbase) and pricing illustration | 7 |
| C2 | Presentation 8–10 min, 6–8 slides | ✅ outline · 🟡 deck | `deliverables/SLIDES_OUTLINE.md` (+ PDF): 7 slides plus backups, ≈ 8:45, with speaker notes, timing, grading criterion per slide, the "why Cloudflare" line and the live tx link. **Team:** build the actual deck from the outline, choose the speakers, fill `{{ASK}}` | 7 |
| C3 | 2–3 min live demo that cannot fail | ✅ | TESTNET live → automatic REPLAY of real testnet recordings (network error, 45 s timeout, 5xx such as Cloudflare 1102, 429, agent error: `lib/console/source.ts`, `tests/console.test.ts`) → backup laptop (replays bundled in the page) → backup video; `/operator` falls back to replay stats; store failure → memory (`tests/api.test.ts`); `npm run warmup` READY banner | 2, 5, 6 |
| C4 | Q&A preparation | ✅ | `deliverables/QA_PREP.md` (+ PDF): 16 questions plus rapid-fire extras, including the Cloudflare free-plan limits and mitigations, x402 co-created by Coinbase and Cloudflare, mainnet, liability, GDPR / 30-day receipt TTL (`lib/store/cloudflare-kv.ts`), legal references pending sign-off, and accuracy | 7 |

## D. Grading criteria

| Criterion | Weight | Status | Evidence |
|---|---|---|---|
| Economic relevance & innovation | 30% | ✅ | Real pain: agents mis-booking French invoices, the 2026/2027 e-invoicing reform, VAT deduction errors. The fixture 03 story deducts only the VAT legally due (ADR-018) and flags it. Concept note §1–3, slides 1, 2 and 6 |
| Fit for AI-agent use | 25% | ✅ | Payment is the authentication (x402: no sign-up, no API key); the 402 carries machine-readable requirements; discovery files + MCP (remote and stdio); idempotency keys, receipts, stable `rule_id`s, error codes; agent spending policy (`max_per_call` 0.20, `daily_budget` 2.00) enforced in code and shown refusing a 1.00 USDC audit on `/live` (scenario 90); rate limits published in the catalog and `llms.txt` |
| Quality of the PoC | 20% | ✅ | An end-to-end real service: engine (13 fixtures), paid API, discovery, MCP, demo agent, console, public deployment in TESTNET with real settlements; 217 tests, `tsc` clean; two independent reviews applied (`docs/reviews/PHASE1_REVIEW.md`, `docs/reviews/PHASE5_REVIEW.md`); fresh-clone run-through green (Phase 6) |
| Commercial potential | 15% | ✅ | Clear payer (the agent's operator, through the agent's wallet and policy); per-call pricing of 0.05 / 0.15 / 1.00 USDC from one config file (`lib/payments/pricing.ts`); `/operator` shows calls served and USDC earned per endpoint; pricing illustration (20,000 invoices → 3,400 USDC/month, 0.17 per invoice) in concept note §8 and slide 5 |
| Final presentation | 10% | 🟡 | Final demo script, slides outline and Q&A prep; demo hardened (warmup, fallbacks, testnet replays). **Team:** assign the roles (`{{NARRATOR}}`, `{{DRIVER}}`, `{{BACKUP}}`), record the backup video, decide the `/operator` reset, and rehearse twice from the public URL |

## E. Hosting (free plan): Cloudflare Workers

| Item | Status | Evidence / impact |
|---|---|---|
| Free plan only, no Vercel (account paused) | ✅ | ADR-017, ADR-020; `wrangler.embedded.jsonc`; `npm run cf:deploy:embedded` |
| 100,000 requests / day | ✅ | One demo run ≈ 5 requests (the console call plus the agent's self-calls); a page view adds a few (static assets are embedded in the Worker, ADR-020). Per-IP rate limits (120/min on paid endpoints and `/mcp`, 30/min on demo runs) stop one client from draining the quota (`lib/api/rate-limit.ts`) |
| 10 ms CPU per request | ✅ (mitigated) | A paid JSON call takes ≈ 6 ms warm; Factur-X PDF and 50-item audits can exceed the limit (`docs/HOSTING.md` §5). Mitigations: the live demo uses JSON fixtures, `npm run warmup` absorbs cold starts, and any 1102/5xx in the console → automatic REPLAY. In TESTNET the facilitator calls are network waits, not CPU |
| KV 1,000 writes / day | ✅ | ≈ 4–5 writes per paid call → ≈ 200–250 paid calls a day; any KV error → memory fallback (`ResilientStore`, tested) |
| Worker size 64 MiB / startup 1 s | ✅ | ≈ 12.6 MiB raw / 2.8 MiB gzip, startup ≈ 14 ms (ADR-020) |
| Pitch argument | ✅ | x402 was co-created by Coinbase and Cloudflare: concept note §7, slide 5 ("Why Cloudflare"), QA Q14 |

## F. Phase 6 hardening (master prompt §7)

| Item | Status | Evidence |
|---|---|---|
| Record 3 replay runs | ✅ | `demo/replays/01, 03, 04, 06.json` recorded from **real testnet runs** on the public Worker (`recorded_from: "testnet"`, 2026-11-16 11:55 UTC, tx links above); `90.json` = policy refusal, no payment |
| Check the fallbacks | ✅ | live → REPLAY, `/operator` empty store → replay stats, store failure → memory: tests in `tests/console.test.ts`, `tests/agent.test.ts`, `tests/api.test.ts`; `docs/CONSOLE.md` |
| Rate limiting (simple) | ✅ | `lib/api/rate-limit.ts` on the 3 paid endpoints, `/mcp` and `/api/demo/run`; `CF-Connecting-IP`; 429 + `Retry-After`; documented in the catalog `limits` and `llms.txt` |
| README quickstart (3 commands) | ✅ | `README.md` (clone + `npm ci`, `npm test`, `npm run dev`; "Try it as an agent") |
| Fresh-clone run-through | ✅ | `npm ci` → tests → `tsc` → build → start (SIMULATED) → agent, pay, warmup, smoke, MCP check: all green without `.env` (Phase 6) |
| Demo twice in a row from the public URL | 🟡 | Verified twice from the public URL in the Phase 5 review (Playwright, SIMULATED, 2 × 4 runs, no errors); the testnet replays were recorded from the public URL. **Team:** repeat in TESTNET during rehearsal (`npm run warmup -- --pay --expect-mode testnet`, then two full runs of 03) |
| Bonus: credit packs, EURC | ⬜ | Not built; presented as "planned, not in the PoC" in the concept note and slides (ADR-015) |

## G. Traceability & safety rules (§2, §4)

| Rule | Status | Evidence |
|---|---|---|
| Master prompt saved verbatim | ✅ | `docs/prompts/00_MASTER_PROMPT.md`; also in the appendix of `PROMPTS_SUBMISSION.md` |
| Prompt log entry per message | ✅ | `docs/prompts/PROMPT_LOG.md` (maintained by the orchestrator) |
| Final prompt export | ✅ | `docs/prompts/PROMPTS_SUBMISSION.md` (French originals + English translations) |
| Decisions log | ✅ | `docs/DECISIONS.md` (ADR-001 → ADR-023) |
| Changelog | ✅ | `CHANGELOG.md` (Phases 0–7) |
| Git, one commit per step | ✅ | `git log`; pushed to `ArySid/ajean-ledger` (ADR-009) |
| Testnet only, no secrets committed | ✅ | Base Sepolia only; `.gitignore` ignores `.env*` except `.env.example`; `cf:build` secret scan; Worker secrets via `wrangler secret put`; scripts never print keys |
| Synthetic data only, PoC disclaimer | ✅ | Fictional parties + `000…` SIRENs (ADR-021, test); disclaimer in the catalog, API responses, `llms.txt` and README; ambiguous cases → `human_review_required: true` |
| Legal references curated and reviewed | 🟡 | `engine/rules/legal-basis.ts` (25 entries) + `docs/LEGAL_REVIEW.md`: **all `reviewed_by` empty, pending sign-off by Ary**; until then no article number reaches an agent (tests). Open questions: reform timeline per company size (ADR-019), excess-VAT treatment (ADR-018), non-EU services, supplier SIREN basis |

## H. Phase 7 — course deliverables (master prompt §7)

| Item | Status | Evidence |
|---|---|---|
| `CONCEPT_NOTE.md` ≤ 2 pages | ✅ | 2 pages A4 (10 pt body, ~2 cm margins), `deliverables/pdf/CONCEPT_NOTE.pdf` |
| `DEMO_SCRIPT.md` (2–3 min, who clicks what, fallbacks) | ✅ | Final, 2:35; team placeholders are listed at its top |
| `SLIDES_OUTLINE.md` (6–8 slides, 8–10 min, speaker notes) | ✅ | 7 slides, ≈ 8:45 |
| `QA_PREP.md` (12+ questions) | ✅ | 16 questions + extras |
| `PROMPTS_SUBMISSION.md` | ✅ | `docs/prompts/PROMPTS_SUBMISSION.md` |
| Final `BRIEF_COMPLIANCE.md` | ✅ | This file |
| PDFs of the deliverables | ✅ | `deliverables/pdf/*.pdf` + `.html`, generated by `npm run export:deliverables` (`scripts/export-deliverables.ts`); index with page counts in `deliverables/README.md` |
| Independent review after Phase 7 (prompt #02) | 🟡 | Run by the orchestrator at the end of Phase 7 |
| Team-only items | 🟡 | Roles, backup video, `/operator` reset decision, code word, `{{ASK}}`, slide deck design, two rehearsals, legal sign-off by Ary |
