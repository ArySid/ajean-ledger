# Phase 7 review: final independent review (jury member + expert-comptable / CAC)

Reviewer: independent subagent that built nothing in this repo. Date: 2026-11-16, 12:05–12:25 UTC.
Scope: (a) accounting correctness of the 13 fixtures and of what the deliverables say about them, (b) brief compliance and grading, (c) the demo from the public URL, run twice.
Method: `npm run -s engine` on every fixture; `npm test`; reading every deliverable against the code and the live site; Playwright (Chromium, 1280×720) on <https://ajean-ledger.ary-sidoun.workers.dev>; Base Sepolia RPC (`eth_getTransactionReceipt`, `eth_getLogs`); `npm run -s warmup` without `--pay`.
Test-USDC spend: **5 paid attempts** (4 settled at 0.15, 1 failed with no settlement), within the limit of 8.

## 0. Verdict at a glance

| Item | Result |
|---|---|
| `npm test` | **217 / 217 green** (8 files) |
| Fixtures 01–13 | **All accounting-correct**; amounts in DEMO_SCRIPT, CONCEPT_NOTE, SLIDES, QA and the console match the engine exactly |
| `npm run -s warmup` (no `--pay`) | **✔ READY FOR DEMO**: 13 passed, 2 skipped (paid checks) |
| Public pages and discovery | `/`, `/live`, `/operator`, `/office`, `/llms.txt`, `/openapi.json`, `/api/v1/catalog`, `/.well-known/agent.json` all return **200**. The landing's `/mcp` link returns **405** (see m7) |
| Live TESTNET runs of 03 | **4 of 5 settled** (txs checked on chain: status 1, 150000 USDC units from `0xD25E…c1BF` to `0xCB4b…dFeC`). **1 fell back to REPLAY** automatically, and no tx was settled for it (M3) |
| Page errors / console errors | **0** in both passes |
| Time per invoice | 16.0–16.5 s from click to "Run complete" at 1× (agent time 1.1–1.4 s); scenario 90 takes 4.9–5.4 s |
| Blocking (code) | **0** |
| Blocking (team, before hand-in) | **1** (B1) |
| Major | **4** |
| Minor | **11** |

## 1. Accounting review (expert-comptable / CAC view)

| # | Case | Engine output | Assessment |
|---|---|---|---|
| 01 | Office supplies at 20% | HA: D 6064 140.00 / D 44566 28.00 / C 401BURO 168.00; compliant; conf 0.98; no review | ✔ |
| 02 | Buyer SIREN missing | Same entry; `non_compliant` (FR-EINV-SIREN-BUYER, error); review required | ✔ Supplier is "mid" size, so the new mention applies from 1 Sept 2026 (ADR-019). Deduction is kept, but the case goes to review: a sound position. |
| 03 | Restaurant billed at 20% | D 6257 160.60 / D 44566 14.60 / C 401BOUCHON 175.20; 2 × VAT_RATE_MISMATCH (13.60 + 1.00); conf 0.86; review | ✔ Only the VAT legally due is deducted; the excess is charged to the expense; coffee on premises at 10%. See m5 on timing (VAT on services). |
| 04 | Intra-EU B2B service (DE) | D 6226 2200 / D 44566 440 / C 4452 440 / C 401KRANICH 2200 | ✔ Self-assessment correct (4452 / 44566) |
| 05 | Exempt training | D 6228 1200 / C 401FORMACOM 1200; exempt; no VAT | ✔ 6228 is acceptable (618x is also seen in practice) |
| 06 | Duplicate of 01 | Entry as 01 + DUPLICATE_SUSPECTED; "not to be posted until cleared"; review | ✔ |
| 07 | Credit note | C 6064 45 / C 44566 9 / D 401BURO 54 | ✔ Reversal and VAT regularisation correct (6096 is an acceptable alternative) |
| 08 | Laptop + accessory | D 2183 1450 / D 6063 29 / D 44562 290 / D 44566 5.80 / C 401 1774.80; FIXED_ASSET_CAPITALISED | ✔ €500 excl. VAT tolerance; fixed-asset VAT in 44562 |
| 09 | Lawyer (BNC, cash basis) client | D 6226 800 / D 44566 160 / C 401 960; CASH_BASIS_CLIENT; review | ✔ Cash-basis books correctly flagged; VAT deductible on payment |
| 10 | Mixed goods + services | D 6064 190 / D 6156 210 / D 44566 80 / C 401 480; nature `mixed` | ✔ The note on services VAT chargeability is correct |
| 11 | Factur-X PDF of 01 | Identical to 01 | ✔ |
| 12 | Bank payment of 01 | BQ: D 401BURO 168 / C 512000 168; matched on amount, number and name | ✔ (account format, m6) |
| 13 | UBL of 10 | Identical to 10 | ✔ |

All entries balance. No legal article number is exposed: 25 legal bases, all with `reviewed_by` empty, gated by `engine/rules/legal-basis.ts:62`.
Deliverables against the engine: DEMO_SCRIPT (160.60 / 14.60 / 175.20, 13.60 + 1.00, conf 0.86), CONCEPT_NOTE §2, SLIDES 3 and B5, QA and BRIEF_COMPLIANCE B2 all match. The console's VAT panel ("Deductible: partly · 14.60 of 29.20") matches the ledger.

## 2. Findings

### Blocking (team, before hand-in)

**B1 — The presentation deck does not exist, and the submitted scripts still contain placeholders.**
- `deliverables/DEMO_SCRIPT.md` (and its PDF) contains 11 `{{…}}` placeholders, and `SLIDES_OUTLINE.md` contains 2 (`{{ASK}}`).
- There is no 6–8-slide deck, only an outline.
- **Fix:**
  1. Fill the roles, `{{CODE_WORD}}`, `{{OPERATOR_RESET_DECISION}}` (recommended: reset; see M2) and `{{ASK}}`.
  2. Build the deck from the outline.
  3. Run `npm run export:deliverables` again.
  4. Record the backup video.

### Major

**M1 — A real testnet transaction is labelled "SIMULATED tx" on the timeline. It is visible in every live run and replay of 01/03/04/06.**
- `components/live/TraceStepItem.tsx:153–190`: `DataChips` shows the explorer link only when the step data has `explorer_url`, and otherwise adds the purple **SIMULATED tx** tag.
- The agent's ERP step (`agent/core.ts`) carries `tx_hash` but no `explorer_url`. The result is "tx: 0xc1554772…b23586 **SIMULATED tx**" on a real Base Sepolia transfer. Screenshots: `phase7/p2-*-simtag.png`.
- This is exactly the step the narrator points at, at 2:00 in the demo script, right after saying "it is real".
- **Fix (UI, no re-recording needed):** in `DataChips`, derive the link with:
  `explorer = d.explorer_url ?? (d.simulated !== true && isRealTxHash(tx) && !tx.startsWith(SIMULATED_TX_PREFIX) ? `${BASE_SEPOLIA_EXPLORER}/tx/${tx}` : null)`
  Alternatively, copy `explorer_url` and `simulated` into the ERP step data in `agent/core.ts`. Add a console test, then redeploy.

**M2 — The operator headline overstates the real testnet revenue.**
- `/operator` shows "PAID CALLS SERVED 40 · *each one settled over HTTP 402*" and "USDC EARNED 6.75 · *test USDC on Base Sepolia*".
- Yet `/api/v1/operator/stats` → `by_mode` gives testnet 10 calls / 1.50 USDC and simulated 33 calls / 5.70 USDC (figures after this review's runs). Most of the headline is fake-hash SIMULATED traffic.
- Screenshot: `phase7/p2-operator.png`. The demo shows this tab at 2:00.
- **Fix (either option):**
  - Reset the KV keys `ajean:stats` and `ajean:recent` before the demo (DEMO_SCRIPT `{{OPERATOR_RESET_DECISION}}` = reset).
  - Or, in `components/operator/OperatorDashboard.tsx`, compute the headline tiles from `by_mode.testnet`, with a sub-line "+ N simulated calls (development, not on chain)".

**M3 — One of the five live TESTNET runs fell back to REPLAY, and the cause cannot be diagnosed.**
- Pass 2: "⚠ Live call failed → showing recorded run (REPLAY) · reason: agent run ended in error".
- On chain (`eth_getLogs` over the window): **no transfer** for that attempt, so nobody was charged and the fallback worked as designed. The 4 other runs, including 2 back-to-back runs right after it, settled.
- `lib/console/source.ts:160` throws a generic message and drops the trace's error step, so neither the presenter nor the team can tell whether the cause was a cold-isolate CPU limit, the facilitator or the self-fetch.
- **Fix:**
  - Put the last `error` step's `title`/`detail` in the notice (`agent run ended in error: <detail>`) and log it.
  - In the script, make the T-15 dry run of 01 happen at **≤ 2 min before going on stage** (isolates cool down between T-1h and the demo).
  - Brief the narrator that a REPLAY is an expected outcome, not a failure.

**M4 — "x402 was co-created by Coinbase and Cloudflare" is inaccurate, and a fintech jury can check it.**
- Coinbase created x402 (its engineering team; launched May 2025).
- Cloudflare **co-founded the x402 Foundation with Coinbase** (announced 23 Sept 2025) and supports x402 in its Agents SDK and MCP tooling.
- Locations: `deliverables/CONCEPT_NOTE.md` §7, `SLIDES_OUTLINE.md` slide 5, `QA_PREP.md` Q14, `README.md` (Hosting), `docs/BRIEF_COMPLIANCE.md` C4 and E.
- The wording came from prompt #04, but the deliverables state it as fact.
- **Fix:** "x402 was created by Coinbase, and Cloudflare co-founded the x402 Foundation with Coinbase, so hosting on Cloudflare Workers puts us in the protocol's own ecosystem."
- Sources:
  - [Cloudflare press release](https://www.cloudflare.com/press/press-releases/2025/cloudflare-and-coinbase-will-launch-x402-foundation/)
  - [Cloudflare blog](https://blog.cloudflare.com/x402)
  - [The Block](https://www.theblock.co/post/372064/cloudflare-coinbase-launch-x402-foundation)

### Minor

**m1 — The ledger is below the fold.**
- At 1280×720 the right column shows the header, chips, payment, review banner and anomalies. The **journal entry** needs a scroll, and more so at the 125–150% zoom the script prescribes.
- **Fix:** in `components/live/ResultPanel.tsx`, move the Journal entry card above Anomalies; or add "scroll the right column to JOURNAL ENTRY" at 1:20 in DEMO_SCRIPT.

**m2 — The animation ends before the narration.**
- At 1× the 13 steps finish in about 15 s, before the narrator reaches the 402 (0:35).
- **Fix:** open tab 1 as `/live?scenario=03&speed=0.5` (about 30 s), so the steps appear with the narration and nobody has to scroll back.

**m3 — QA Q1 makes an untested claim.**
- "a generic model would book the 20% restaurant VAT without a warning".
- **Fix:** write "may book it", or test it once and cite the result.

**m4 — CONCEPT_NOTE §7 understates what mainnet changes.**
- "Mainnet means switching the network and the asset" leaves out the facilitator (x402.org is testnet-only).
- **Fix:** add "and a production facilitator", as QA Q5 already says.

**m5 — VAT on services is booked to 44566 before payment (03, 09, 10/13).**
- VAT on services is deductible only once paid (no debits option), but the entries book it straight to 44566. The `vat.note` discloses this.
- **Fix:** a firm would use a waiting sub-account (e.g. 44566x "TVA déductible en attente de règlement") until payment. Add it to `docs/LEGAL_REVIEW.md` open questions, or as an engine option. Not wrong as a disclosed proposal.

**m6 — Inconsistent account format.**
- Fixture 12 uses `512000`, while every other line uses 4–5-digit PCG accounts plus auxiliaries.
- **Fix:** use `512` or `5121`.

**m7 — The landing's `/mcp` link answers 405.**
- `GET /mcp` returns 405 with explanatory JSON. That is correct for a stateless Streamable HTTP endpoint, but a juror clicking the link sees an error.
- **Fix:** link to `/llms.txt` (MCP section) or `docs/MCP.md`, or make GET answer 200 with the same descriptive JSON.

**m8 — The daily budget is tracked per isolate.**
- One run showed "Spent today 0.15 + 0.15 = 0.30"; the next ones showed 0.15. The QA line "Can the agent overspend? No" holds per Worker isolate only.
- **Fix:** add "in the PoC the daily ledger is per instance; in production it is persisted".

**m9 — The prompt log misstates the master prompt's length.**
- `PROMPT_LOG.md` #01 says "≈ 400 lines"; `00_MASTER_PROMPT.md` has 242.

**m10 — Check that the prompt list is complete.**
- `PROMPTS_SUBMISSION.md` lists 4 prompts. The FR originals are verbatim, the EN translations of #02–#04 were checked line by line and are faithful and complete, and the appendix equals `00_MASTER_PROMPT.md`.
- But the team performed hand actions after #04: the Cloudflare account and token, wallet funding, the testnet switch.
- **Fix:** confirm that no further chat message was sent; if any was, add it verbatim with its translation.

**m11 — The concept note has no sourced figure for the size of the problem.**
- The economic relevance (30%) rests on narrative alone.
- **Fix:** add one sourced figure, e.g. the number of companies in the reform's scope (DGFiP) or of accounting firms (Ordre des experts-comptables), with its source. Do not estimate.

### Verified and fine (no action)

- **Brief compliance:**
  - Shareable link ✔.
  - Step-by-step demo script, 2:35, with a fallback ladder ✔.
  - Prompts FR + EN ✔.
  - Concept note: **2 pages** (pdfinfo), all 8 required sections, illustration only (3,400 USDC/month = 0.17/invoice, arithmetic correct; 667 h labelled as an assumption) ✔.
  - Outline: 7 slides, ≈ 8:45, demo 2:45 ✔.
  - Q&A: 16 questions ✔.
  - PDFs newer than their Markdown sources ✔.
- **Claims checked against the code and the site:**
  - 217 tests; per-IP rate limits 120 and 30 (`lib/api/rate-limit.ts`); 5 MB body limit; 30-day KV TTL; 25 legal bases, unreviewed; `llm_configured: false`.
  - Remote MCP `tools/list` lists the 5 tools.
  - 402 with `amount "150000"`, `eip155:84532` and the right payTo.
  - "17 checks" in warmup with `--pay` (15 + receipt + mode).
  - REPLAY banner text, fallback notice text and scenario 90 panel all match the script.
- **Honesty and consistency:**
  - Testnet / PoC / synthetic / "(fictional)" labels on every page and in the catalog disclaimer.
  - "Atelier Lumenor" spelled consistently (69 occurrences, no variant).
  - Prices 0.05 / 0.15 / 1.00 and policy 0.20 / 2.00 consistent everywhere.
  - Legal references explicitly "pending sign-off".
- **Projector readability:** about 16–17 px body text, high contrast, mode badge and chips clear (screenshots `p1-live03.png`, `p1-replay03.png`).

## 3. Jury-style scorecard (estimate)

| Criterion | Weight | Estimate | Strong | Weak | What would raise it |
|---|---|---|---|---|---|
| Economic relevance & innovation | 30% | **24/30** | A real, timely pain (2026–27 reform); the fixture 03 trap is credible and accounting-correct; the "agents as customers" angle is original | Pain not quantified; the edge over generic LLMs is asserted, not shown | One sourced figure (m11); one honest LLM-versus-Ajean comparison on fixture 03, shown only if actually tested (m3) |
| Fit for AI-agent use | 25% | **23/25** | Payment is the authentication (real x402 v2), 4 discovery files, remote and stdio MCP, idempotency, stable rule ids and error codes, spending policy shown refusing (scenario 90) | Policy ledger per isolate (m8) | One line on a persisted budget; show `curl` 402 → MCP in a backup slide |
| Quality of the PoC | 20% | **16/20** | Real end-to-end on testnet, 217 tests, 13 correct fixtures, automatic labelled fallback, 0 page errors | "SIMULATED tx" on a real tx (M1), headline mixing simulated revenue (M2), 1 of 5 live runs fell back without a diagnosable reason (M3) | Fix M1–M3 (about 1 hour of work), redeploy, rerun warmup `--pay` |
| Commercial potential | 15% | **11/15** | Clear caller and payer, simple per-call tiers, concrete 20,000-invoice illustration | No cost side or margin (facilitator fees on mainnet, hosting), no customer evidence, 667 h not converted into a comparable | One pilot conversation or letter of intent with an accounting firm; a line on unit cost; credit packs as the volume answer |
| Final presentation | 10% | **7/10** (pending deck) | Tight 2:35 script, fallback ladder, timing card, Q&A depth | No deck yet, placeholders (B1); animation and narration out of sync (m2); ledger below the fold (m1) | Build the deck, fill the placeholders, 0.5× speed, two timed rehearsals |
| **Total** | | **≈ 81/100** | | | **≈ 86–88** once B1, M1–M4 and m1–m2 are fixed |

## 4. Evidence

- **Live txs this review** (all status 1, 0.15 USDC agent → service):
  - `0xb971b325…f700a41b` (pass 1)
  - `0x06186d7e…f91ef77` (direct `/api/demo/run`)
  - `0x9e6d3d7e…d8bee27`
  - `0x9601be5d…b07bb6d`
- **Recorded proof** `0xc1554772…b23586`: status 1, 150000 units.
- **Screenshots** in `docs/reviews/phase7/`, 1280×720:
  - `p{1,2}-landing`, `-live03`, `-run90`, `-replay0{1,3,4,6}`, `-operator`, `-office`;
  - `p2-*-simtag.png` (M1);
  - `p2-*-ledger.png`. These were meant to capture the ledger, but they only scrolled the left timeline. They are kept because they show the right column with the ledger below the fold (m1).
