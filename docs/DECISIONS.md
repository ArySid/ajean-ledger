# Decisions (ADR log)

Format: **Context → Decision → Why → Alternatives rejected.** Status: `accepted`, `proposed` (awaiting team validation) or `needs-review` (accounting rule to be checked by Ary).

---

## ADR-001 — Prompt log entry #01 references the master prompt instead of duplicating it
- **Status:** accepted
- **Context:** §2 asks for every prompt verbatim in `PROMPT_LOG.md`. Prompt #01 is the ~400-line master prompt, which §2.1 also stores verbatim in `00_MASTER_PROMPT.md`.
- **Decision:** Entry #01 links to `00_MASTER_PROMPT.md` (the unabridged verbatim copy) and quotes only its closing instruction. All later prompts are copied in full in the log.
- **Why:** The same text twice makes the log hard to read for the jury. Nothing is lost, because the verbatim copy is one click away.
- **Rejected:** Duplicating the full text (noise); summarising it (breaks the "verbatim" rule).

## ADR-002 — x402 protocol v2 with the `@x402/*` packages, pinned to 2.31.0
- **Status:** accepted (versions checked on 2026-11-16)
- **Context:** §3 requires checking current official x402 docs before use. The x402 SDK has two generations on npm: legacy v1 (`x402`, `x402-next`, `x402-fetch` at 1.2.0, last updated April 2026) and v2 (`@x402/*`, 2.31.0, published 2026-11-12). GitHub API access to `coinbase/x402` was not enabled in this session, so the facts below come from the official published package tarballs (READMEs + compiled code).
- **Decision:** Use v2, pinned:
  | Package | Version | Role |
  |---|---|---|
  | `@x402/core` | 2.31.0 | protocol types, `HTTPFacilitatorClient`, `x402ResourceServer` |
  | `@x402/next` | 2.31.0 | `withX402()` route wrapper for Next.js API routes (peer: `next >= 16.4.1`, `@x402/paywall`) |
  | `@x402/evm` | 2.31.0 | `ExactEvmScheme` (server + client), EIP-3009 USDC transfers |
  | `@x402/fetch` | 2.31.0 | client: `wrapFetchWithPayment` for the demo agent |
  | `@x402/mcp` | 2.31.0 | `createPaymentWrapper` (server) / `createx402MCPClient` (client) |
  | `next` | 16.4.x | App Router |
  | `viem` | 2.x | wallets for the demo agent |
  | `@modelcontextprotocol/sdk` | 1.32.x | MCP server |
- **Protocol facts confirmed in the v2 code:**
  - Headers: `PAYMENT-REQUIRED` (server → client, on the 402), `PAYMENT-SIGNATURE` (client → server, the signed payment), `PAYMENT-RESPONSE` (server → client, settlement result incl. tx hash). Legacy v1 `X-PAYMENT` / `X-PAYMENT-RESPONSE` are still understood by the SDK.
  - Networks use CAIP-2 ids: Base Sepolia = `eip155:84532`.
  - Public testnet facilitator: `https://x402.org/facilitator` (no API key needed).
  - Test USDC on Base Sepolia: `0x036CbD53842c5426634e7929541eC2318f3dCF7e` (present in `@x402/evm`).
  - `withX402` settles the payment **only after a successful response (status < 400)**, so an agent is never charged for a failed call.
- **Why:** v2 is the maintained line, and has first-party Next.js and MCP integrations, which removes custom protocol code.
- **Rejected:** v1 packages (legacy, lagging); hand-rolled 402 logic (risk of spec drift, the brief says "follow the current spec exactly").

## ADR-003 — Stack: one Next.js 16 app + a framework-free engine package
- **Status:** accepted (team validation, prompt #02)
- **Decision:** Next.js 16 App Router + TypeScript, deployed on Vercel. The accounting engine lives in `/engine` as pure TypeScript with zero Next.js imports, so the API routes, the MCP server, the CLI (`npm run engine`) and the demo agent all call the same functions. Tests with Vitest.
- **Why:** One deployable, one URL for the jury, one language end to end (§3).
- **Rejected:** Separate backend (Express/Hono) + frontend (two deployments for no gain); Python engine (breaks "TypeScript end to end").

## ADR-004 — Receipts, idempotency and operator stats storage
- **Status:** superseded by ADR-010 (no Supabase)
- **Context:** Vercel serverless functions have no persistent filesystem and requests can hit different instances. `/api/v1/receipts/{id}`, idempotency keys and the `/operator` dashboard need shared state.
- **Decision (proposed):** A tiny `Store` interface with two adapters: `file` (local dev, `data/*.local.json`) and one hosted adapter for the public URL. Recommended hosted adapter: **one Supabase table** (`receipts`), because the Supabase connector is already available in this workspace.
- **Rejected:** In-memory only (receipts vanish between instances, so the idempotency demo is not credible); SQLite on Vercel (not persistent).

## ADR-005 — Payment modes implemented behind the same x402 server object
- **Status:** accepted
- **Decision:** `PAYMENT_MODE=testnet` registers the real `HTTPFacilitatorClient` (x402.org facilitator, Base Sepolia). `PAYMENT_MODE=simulated` registers a local mock facilitator (same interface: `verify` / `settle`) that returns a clearly fake tx hash (`0xSIMULATED…`). The wire format (402 body + headers) is identical in both modes. **Replay** is not a server mode: the demo console plays back recorded JSON traces from `demo/replays/` (recorded from real testnet runs).
- **Why:** The agent and the console code are the same in all modes, so the fallback cannot diverge from the real thing.

## ADR-006 — Receipt `network` field
- **Status:** accepted
- **Context:** §5.4 shows `"network": "base-sepolia"`; x402 v2 uses CAIP-2 (`eip155:84532`).
- **Decision:** The receipt carries both: `"network": "base-sepolia"` (human-readable, as in the spec) and `"network_caip2": "eip155:84532"` (protocol value), plus `"explorer_url"`.

## ADR-007 — Agent gas: USDC only
- **Status:** accepted
- **Context:** The x402 `exact` EVM scheme uses EIP-3009 `transferWithAuthorization`: the agent signs an off-chain authorisation and the facilitator submits the transaction and pays gas.
- **Decision:** The demo agent wallet needs **test USDC only** (Circle faucet), no Base Sepolia ETH. The service `payTo` wallet needs nothing; its private key is never needed by the server.

## ADR-008 — Accounting defaults
- **Status:** accepted (prompt #02). Legal citations remain gated by `docs/LEGAL_REVIEW.md`.
- Low-value fixed-asset threshold: **€500 excl. VAT** (French administrative tolerance). Above it, IT equipment → `2183` + VAT on fixed assets `44562`; below → expense `6063`/`6064`.
- Supplier accounts: general account `401` + auxiliary code, e.g. `401BURO` (shown as `401XXXX` in §5.4).
- Purchase journal code `HA`; bank journal `BQ`.
- Restaurant: on-site meals are 10%, alcohol 20%. A restaurant invoice at 20% on food → `VAT_RATE_MISMATCH` warning + `human_review_required: true`. The engine **never** silently corrects the VAT amount: it books what was invoiced and flags it. *(Amended by ADR-018: the supplier is still credited with the invoiced total, but only the VAT legally due is deducted; the excess goes to the expense.)*
- Legal bases: only from a curated table in `engine/rules/legal-basis.ts`, each entry with `id`, `label`, `reference` and a `reviewed_by` field (empty until Ary signs it off). No article number is shown to an agent until it is reviewed.

---

## ADR-009 — GitHub repository: user creates it once, then push after every step
- **Status:** accepted (workaround)
- **Context:** Prompt #02 asks for a new private repo `ajean-ledger` on the user's account. The account was identified as `ArySid` (`gh api user`). This cloud session's GitHub credential is scoped to configured repositories only: the repo-creation API path is blocked (HTTP 403) and `add_repo` cannot attach a repo that does not exist.
- **Decision:** The user creates the empty private repo `ArySid/ajean-ledger` once (Action required). The session then attaches it with push access and pushes the full local history; every later step is pushed. Until then, commits are kept locally.
- **Rejected:** Pushing to another existing repo (forbidden: never touch existing assets).
- **Outcome (2026-11-16):** the user created `ArySid/ajean-ledger`; it was attached with push access and the local history was pushed to `main`.

## ADR-010 — Storage: optional, Neon → Upstash → memory (no Supabase)
- **Status:** accepted (prompt #02)
- **Decision:** `lib/store` exposes one `Store` interface with adapters `neon` (`DATABASE_URL`/`POSTGRES_URL`, table `ajean_receipts` created on first use), `upstash` (REST URL/token), `file` (local dev) and `memory`. Any store error falls back to memory, so the API and demo keep working; `/operator` falls back to recorded replays. Nothing is created on Supabase.
- **Note:** The Neon marketplace integration (free plan) is already installed on the Vercel team, but the Vercel MCP exposes no "create integration resource" call, so the database is attached from the Vercel dashboard (Storage → Neon) once the project exists.

## ADR-011 — Vercel: team blocked for fair-use → deployment pending, fallbacks prepared
- **Status:** accepted (workaround)
- **Context:** Creating project `ajean-ledger` on team "arysidoun-5003's projects" (Hobby) returned `402 resource_creation_blocked: Your Team exceeded our fair use limits and has been blocked`. Changing plan/billing is out of bounds (free tiers only) and existing projects (e.g. `ajeanai`) must not be touched.
- **Decision:** Keep building and verifying locally (all flows run from this container: x402.org facilitator and Base Sepolia RPC are reachable). Ask the user to check the block in the Vercel dashboard (Usage). As a guaranteed fallback for the shareable link, the demo console is designed to also run as a static page in **REPLAY / SIMULATED** mode (engine is pure TypeScript and can run in the browser), clearly labelled.
- **Rejected:** Upgrading the Vercel plan (paid); deploying under another account without the user.

## ADR-012 — Throwaway testnet wallets
- **Status:** accepted
- **Decision:** `scripts/gen-wallets.ts` generates two Base Sepolia wallets (service `payTo`, demo agent) into `.env.local` (gitignored, mode 600); keys are never printed. Public addresses: service `0xCB4b84079B1dd19828c3d5733f9e0D2DcB26dFeC`, agent `0xD25Eb53E57bCF0DE8785d9a0D0722CC98BB0c1BF`. The agent needs only test USDC (ADR-007). If the container is recycled before keys are stored in Vercel env vars, new wallets are generated (only faucet funds are lost).

## ADR-013 — Anthropic key optional; scripted mode first
- **Status:** accepted (prompt #02)
- **Decision:** Everything is built and tested without an LLM (structured inputs, scripted demo agent). The key is requested once via the secure form; when present, `createAnthropicAdapter()` enables LLM extraction/classification and the agent's LLM reasoning. Default model `claude-sonnet-5-5` (env `ANTHROPIC_MODEL`).
- **Outcome:** the session's secure credential form refuses Anthropic hosts (they are authenticated by the session itself), so the key cannot be collected that way. The key is therefore added by the user directly as the `ANTHROPIC_API_KEY` environment variable of the Vercel project (sensitive). Until then the deployed service runs in scripted / rules-only mode, which is the designed default.

## ADR-014 — Fixture 9: the lawyer is the BNC client whose books we keep
- **Status:** accepted (prompt #02)
- **Decision:** Client profile `activity: "bnc"`, `accounting_basis: "cash"`. The engine proposes the entry but returns `human_review_required: true` (reason `CASH_BASIS_CLIENT`), since a recettes-dépenses ledger records it at payment date.

## ADR-015 — Fictional demo SME and language
- **Status:** accepted (prompt #02)
- **Decision:** Demo client "Atelier Lumenor SAS (fictional)", fictional SIREN. *(Phase 1 review B2: every SIREN / VAT id in fixtures, replays, scripts and docs now uses the unallocated, Luhn-valid `000…` range — 000001008 to 000001073 — because the earlier "fictional" SIRENs belonged to registered entities, two of them natural persons. Party names that matched real register entries exactly were also changed: Atelier Lumen → Atelier Lumenor, Buro Express → Buro Velours, Formacompta → Formacomète, Numeria Solutions → Numeria Pixelune, Cabinet Vasseur → Cabinet Vasquelin. All keep the "(fictional)" suffix.)* Course deliverables (concept note, slides, demo script, Q&A) in English. Bonuses (credit packs, EURC) only after Phases 1–7 are complete and verified.

## ADR-016 — Autonomous orchestrator mode
- **Status:** accepted (prompt #02)
- **Decision:** No more stops between phases. Independent workstreams are delegated to subagents with explicit file ownership (engine / payments-API / deliverables first; then discovery+MCP, demo agent, console). Independent reviewer subagents (that did not write the code) after Phases 1, 5 and 7 check accounting correctness of the 12 fixtures, brief compliance and an error-free demo from the public URL. User reports in French, ≤ 15 lines; technical detail stays in `docs/`.

## ADR-017 — Hosting: Cloudflare Workers (OpenNext), Netlify as fallback — Vercel abandoned
- **Status:** accepted (prompt #04) — supersedes the Vercel part of ADR-003 and ADR-011
- **Context:** The user's Vercel account is paused until 2026-12-12 (Fast Origin Transfer overage). No Vercel deployment, repo import or Marketplace integration may be used, and no existing Vercel project may be touched.
- **Decision:** Host on a free plan, tested in order, keeping the first one that runs the full demo without errors from a public URL: (1) **Cloudflare Workers** via `@opennextjs/cloudflare` (free plan: 100,000 requests/day, 10 ms CPU per request, worker size limit); (2) **Netlify** free plan. Storage: the host's native free option (Cloudflare KV/D1), else Neon free directly; never Supabase; storage remains optional (memory + replay fallback).
- **Mitigations for the free limits:** heavy steps that could exceed 10 ms CPU (Factur-X PDF parsing, large audits) are measured; if needed they move client-side or the demo uses precomputed results, clearly labelled. Details and measurements: `docs/HOSTING.md`.
- **Pitch argument (if Cloudflare is kept):** x402 was co-created by Coinbase and Cloudflare, so hosting the agent-payment service on Cloudflare is coherent with the protocol's ecosystem.
- **Correction (Phase 7 review M4, 2026-11-16):** the wording above, taken from prompt #04, is inaccurate. Coinbase created x402 (launched May 2025); Cloudflare co-founded the **x402 Foundation** with Coinbase (announced September 2025) and supports x402 in its Agents SDK and MCP tooling. The argument stands in that form (Cloudflare hosting is coherent with the x402 ecosystem) and the deliverables now say so. Sources: Cloudflare press release and blog ("x402 Foundation"), The Block.
- **Rejected:** Vercel (paused, forbidden by the user); paid plans of any host.

## ADR-018 — Excess VAT invoiced at a wrong rate is not deducted
- **Status:** accepted (Phase 1 review, finding B1) — amends ADR-008
- **Context:** Fixture 03: a restaurant invoices a business lunch and coffees (on-site consumption, 10%) at 20%. The engine booked the full invoiced VAT (29.20) in 44566 while its own anomaly said "only the VAT legally due is deductible". The independent reviewer flagged the contradiction as blocking: VAT shown on an invoice is due by the issuer, but the buyer may deduct only the VAT legally due on the transaction.
- **Decision:** For a French supplier, when a line's invoiced rate is above the lowest rate expected for its expense category, the engine deducts `min(VAT at the expected rate on the line base, invoiced VAT)` in 44566 (44562 for fixed assets) and adds the excess to the expense line. The supplier is still credited with the invoiced total; `vat.breakdown` still shows the invoiced VAT; `VAT_RATE_MISMATCH` and `human_review_required` are kept; `vat.legal_basis_id` = `LB-VAT-DEDUCTION-LEGALLY-DUE` (unreviewed); the explanation reads "invoiced at 20%, only 10% legally due and deductible; excess 14.60 EUR booked to expense pending a corrected invoice". Fixture 03: D 6257 160.60 / D 44566 14.60 / C 401BOUCHON 175.20 (excess 13.60 on the meal + 1.00 on the coffees).
- **Why:** It is the deduction a tax inspector would accept, and it keeps ADR-008's principle (the invoice amount is never silently corrected: the payable equals the invoice and the anomaly is visible). When the supplier issues a corrected invoice (or a credit note for the excess VAT), the excess is cleared from the expense.
- **Rejected:** (a) booking the full invoiced VAT and only flagging it (contradicts the right to deduct; the demo agent posts the entry); (b) booking the excess on a separate "TVA non récupérable" 6257 line (equivalent, but two lines on the same account add noise for an agent; possible later via a sub-account); (c) crediting the supplier with the corrected amount (silent correction of a third-party document, against ADR-008); (d) parking the excess in 4458x / 471 pending the corrected invoice (a suspense balance an SME would forget to clear).

## ADR-019 — E-invoicing reform mentions follow the issuer's timeline
- **Status:** accepted for the PoC (Phase 1 review, finding M2) — **to verify with Ary** (`docs/LEGAL_REVIEW.md`, open questions)
- **Context:** The new mentions (buyer SIREN, operation category, delivery address, VAT-on-debits option) were `error` for every domestic B2B invoice from 2026-09-01. The reviewer's reading: reception is mandatory for every company from 1 Sept 2026, but issuance — and with it the new mentions — is mandatory for large companies (GE) and mid-size companies (ETI) from 1 Sept 2026 and for SMEs (PME) and micro-businesses from 1 Sept 2027.
- **Decision:** Optional `supplier.company_size` (`large` | `mid` | `sme` | `micro`) on `Party` (additive contract change, also in the discovery zod schema). `FR-EINV-*` checks: `info` before 2026-09-01; `error` from 2027-09-01, or from 2026-09-01 when the supplier is `large` / `mid`; `warning` otherwise, with a `fix_hint` stating the timeline. Fixture 02's supplier is declared `mid` (ETI) so it stays `non_compliant`, as the brief requires.
- **Why:** An SME issuer that omits the buyer SIREN in October 2026 is not (yet) in breach; calling its invoice non-compliant would push agents to reject valid invoices. Unknown size defaults to the lenient reading (warning) but still triggers a review.
- **Rejected:** `error` for every issuer from 2026-09-01 (over-strict for SMEs); `info` until 2027-09-01 for everyone (hides a real breach by GE/ETI issuers); inferring the size from the legal form or the SIREN (unreliable, no register call in a deterministic engine).

## ADR-020 — Cloudflare retained; static assets embedded in the Worker for deploys from the cloud session
- **Status:** accepted
- **Outcome of ADR-017:** Cloudflare Workers (free plan) is **retained**: the full demo passes from the public URL `https://ajean-ledger.ary-sidoun.workers.dev` (warmup 15/15 green: pages, discovery files, 402 on the three paid endpoints, paid `/entry` 200 + receipt, receipts lookup, `/api/demo/run`, KV-backed operator stats). Netlify was not needed.
- **Context:** `wrangler deploy` uploads Workers static assets with a short-lived JWT in the `Authorization` header. This session's egress proxy injects the stored Cloudflare API token into every request to `api.cloudflare.com`, overwriting that JWT → `401 Unauthorized` on `/workers/assets/upload`.
- **Decision:** `scripts/cf-embed-assets.mjs` embeds `.open-next/assets` (~1.1 MiB, 22 files) into the Worker bundle and generates `.open-next/entry.mjs`, which serves them and passes an `ASSETS`-compatible shim to the OpenNext worker. Deploy with `npm run cf:deploy:embedded` (`wrangler.embedded.jsonc`, same name/vars/KV as `wrangler.jsonc`). From a normal terminal, the standard `npm run cf:deploy` (Workers Assets) also works.
- **Free-plan impact:** bundle 12.6 MiB raw / 2.8 MiB gzip (limit 64 MiB uncompressed on Workers Free per current docs; also under the historical 3 MiB gzip limit), startup 14 ms. Static files are served by the Worker, so each page view costs a few extra requests out of the 100,000/day: negligible for a demo.
- **Secrets:** `SERVICE_PAY_TO_ADDRESS` and `AGENT_PRIVATE_KEY` are set with `wrangler secret put` (piped from `.env.local`, never printed). Storage: free KV namespace `AJEAN_KV` bound.
- **Rejected:** asking the user to deploy from their own machine (slower loop); Netlify (not needed); Cloudflare Workers Builds via the GitHub integration (needs a dashboard step from the user; possible later for automatic deploys on push).

## ADR-021 — Demo SME renamed "Atelier Lumenor SAS (fictional)"; SIRENs from the unallocated 000 range
- **Status:** accepted (safety rule §4 overrides ADR-015's name)
- **Context:** The Phase 1 independent review found that six "fictional" SIRENs belonged to real registered entities (including two individuals), and five fictional company names (among them "Atelier Lumen") exactly matched real register entries.
- **Decision:** All identifiers now use valid-checksum SIRENs from the unallocated `000…` range (000001008 → 000001073, VAT keys recomputed); a test enforces the prefix. Names matching real entries were altered and keep the "(fictional)" suffix: Atelier Lumen → **Atelier Lumenor**, Buro Express → Buro Velours, Formacompta → Formacomète, Numeria Solutions → Numeria Pixelune, Cabinet Vasseur → Cabinet Vasquelin.
- **Why:** "No real client data, ever" (§4) — a real company name or SIREN on a public demo page is exactly what the rule forbids.

## ADR-022 — Phase 6: per-IP rate limits, and the server (not the console) decides the payment mode
- **Status:** accepted (Phase 6 hardening)
- **Context:** The public demo runs on Workers Free (100k requests/day). The `/live` console offered a TESTNET / SIMULATED selector, but `/api/demo/run` always pays in the deployment's `PAYMENT_MODE`, so on a testnet deployment "SIMULATED" silently did nothing — and the demo script's level-2 fallback relied on it.
- **Decision:** (1) In-process fixed-window limits per client IP (`CF-Connecting-IP` first): 120/min on the paid endpoints and `/mcp`, 30/min on `/api/demo/run` (separate bucket, 429 + `Retry-After` + `fallback_hint: "replay"`), per isolate, published in the catalog and `llms.txt`. Sized so that two warmups and two full demos in one minute use about a third of each limit. (2) The console reads `/api/health` and selects the deployment's mode; the other button is disabled with an explanation. The badge tooltip and a click-to-open legend explain TESTNET / SIMULATED / REPLAY. The demo fallback ladder becomes TESTNET → REPLAY (automatic).
- **Why:** A shared counter (KV) would cost writes from the 1,000/day KV quota for little gain in a PoC. A per-request "simulated" override on a testnet deployment would hand out free results (anyone could ask for fake payment), so it is not offered.
- **Rejected:** KV-backed global rate limit (quota, eventual consistency); a client-chosen payment mode; a second always-simulated Worker by default (possible later, optional note in `docs/HOSTING.md` §7).

## ADR-023 — `compliance.status` stays "invoice mentions only"; the console labels it so
- **Status:** accepted (Phase 5 review fixes, m4)
- **Context:** On fixture 03 the `/live` result panel showed a green **COMPLIANT** chip next to a `VAT_RATE_MISMATCH` anomaly. The reviewer suggested either relabelling the chip or returning `warning` when a VAT mismatch is present.
- **Decision:** The engine contract is unchanged: `compliance.status` reports the mandatory invoice mentions (e-invoicing / commercial-code rules) and nothing else; VAT and accounting problems are `anomalies` and drive `human_review_required` / `review_reasons`. The console chip reads "Invoice mentions: compliant" (tooltip explains the split), a separate amber "VAT anomaly: …" chip appears when one is reported, and the agent's 200 step reads "(invoice mentions compliant, review required)".
- **Why:** An invoice can carry every mandatory mention and still charge the wrong VAT rate: those are two different facts, and agents consuming the API (and `/invoice/check`, which is mentions-only) rely on `compliance.status` meaning one thing. Mixing VAT anomalies in would change the §5.4 contract and the 13 fixture expectations for no new information.
- **Rejected:** `warning` status on `VAT_RATE_MISMATCH` (contract change, duplicates the anomaly list).

## ADR-024 — EURC as a second accepted stablecoin, priced at a fixed demo rate
- **Status:** accepted (Phase 6 bonus)
- **Context:** The master prompt (§7 Phase 6) lists "EURC as a second accepted stablecoin" as a bonus. x402 v2 lets a route offer several `accepts`; the client picks one. Circle publishes test EURC on Base Sepolia. Prices are set in USDC (§5.2).
- **Checks:** On-chain (`sepolia.base.org`, `eth_call`): `0x808456652fdb597867f38412077A9182bf77359F` answers `name()` "EURC", `version()` "2", `decimals()` 6, a `DOMAIN_SEPARATOR()` equal to the EIP-712 hash of {EURC, 2, 84532, address}, and the EIP-3009 `TRANSFER_WITH_AUTHORIZATION_TYPEHASH`. The x402.org facilitator advertises `exact` on `eip155:84532` without an asset list; a `/verify` probe signed by an unfunded throwaway key for EURC fails only on balance (`invalid_exact_evm_insufficient_balance`, the same as USDC; a non-token address gives `asset_not_deployed_contract`). So EURC works in TESTNET as well as SIMULATED.
- **Decision:** `ACCEPTED_ASSETS = ["USDC", "EURC"]` in `lib/payments/pricing.ts`; every 402 lists USDC first (default) and EURC second. EURC prices are **derived** from the USDC prices with a fixed demo rate `1 EURC = 1.08 USDC`, rounded half-up to the cent (entry 0.14, check 0.05, audit 0.93, packs 0.93 / 9.26 EURC). The rate is an assumption shown in the catalog, `llms.txt`, OpenAPI and the landing page. Receipts carry the asset actually paid (read from `PaymentPayload.accepted.asset`), and the operator stats split cash per asset (`usdc_earned` stays USDC-only). Clients keep paying USDC by default: the x402 SDK picks `accepts[0]` and filters out non-default assets; `--asset EURC` (scripts) and `AJEAN_PAY_ASSET=EURC` (stdio MCP bridge, budgeted at its USDC value) opt in.
- **Why:** A European SME agent may hold euros; a euro stablecoin removes an FX step for the payer and is a credible extension of "pay per call". A fixed derived rate keeps one price list (USDC) and makes the demo deterministic.
- **Rejected:** same nominal price in EURC (would make EURC ~8 % more expensive, misleading); a live FX oracle (network dependency, non-deterministic discovery files, out of scope for a testnet PoC); EURC first (would change every existing client's default and the recorded replays).

## ADR-025 — Prepaid credit packs: an x402-bought bearer token, hash-only storage
- **Status:** accepted (Phase 6 bonus, master prompt §5.2 "optional credit packs")
- **Context:** Pay-per-call needs one signature and one settlement per call. Volume pricing (e.g. 10 USDC → 12 USDC of calls) is the classic way to reward heavy agents, and it lowers per-call latency (no facilitator round trip). The spirit "payment is the authentication" must be kept: no account, no API key.
- **Decision:** `POST /api/v1/credits {"pack"}` is itself x402-paid (USDC or EURC; packs `starter` 1.00 → 1.20 USDC, `pro` 10.00 → 12.00 USDC, +20 %, valid 30 days, from `CREDIT_PACKS`). After settlement the service issues an opaque bearer token `ajc_…` = base64url(HMAC-SHA256(secret, purchase request_id)) and stores only its SHA-256 with the balance (USDC atomic), mode and expiry. Any paid endpoint accepts `X-Credit-Token` instead of `PAYMENT-SIGNATURE`: the USDC price is reserved under a per-token lock, the engine runs, the receipt says `{method: "credits", amount, remaining_balance}`; an error refunds the reservation. A low balance or an unknown token answers 402 with the normal `PAYMENT-REQUIRED` header plus `details.credits`, so the agent can always fall back to x402. `GET /api/v1/credits/balance` is free. Idempotent replays are checked first, so nothing is debited twice; a purchase replay re-derives the same token (with `CREDIT_TOKEN_SECRET` set, on any instance).
- **Why:** The token *is* a prepaid payment (bought with x402, bound to one deployment mode, expiring), not an identity: the service still never learns who the agent is. Hash-only storage means a store leak does not leak spendable tokens. HMAC derivation gives retry-safety without persisting the secret value.
- **Limits (documented):** the lock is per instance; Workers KV is eventually consistent, so two isolates in different locations could overspend the last cents of a token (production: Durable Object or a conditional SQL `UPDATE`). Without `CREDIT_TOKEN_SECRET` a purchase replay served by another isolate returns the receipt without the token. KV writes per credit call: 5 (receipt, idempotency, recent, stats, balance). The remote `/mcp` endpoint stays x402-only.
- **Rejected:** storing the token (or an encrypted copy) for replays; accounts / API keys (contradicts §2); on-chain prepaid escrow (`upto` / batch-settlement schemes: newer, more moving parts for a course PoC); per-call settlement of credits.
