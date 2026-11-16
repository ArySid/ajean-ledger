# Phase 5 review: accounting, brief compliance, public demo (independent reviewer)

- **Reviewer:** an independent reviewer subagent that did not build the PoC. It reviewed as a French expert-comptable and as a course juror.
- **Date:** 2026-11-16, 11:25–11:45 UTC.
- **What was reviewed:**
  - commit `1646194` (HEAD);
  - the **deployed** Worker at <https://ajean-ledger.ary-sidoun.workers.dev>, which reports `PAYMENT_MODE=simulated` and store `cloudflare-kv`.
- **Uncommitted work in progress.** During the review, the working tree contained uncommitted Phase 6 changes (28 files: `LiveConsole.tsx`, `lib/console/modes.ts`, `DEMO_SCRIPT.md`, `README.md` and others). They are **not deployed**. Where they already address a finding, this report says so.
- **Read-only.** This review wrote only this report and the screenshots in `docs/reviews/phase5/`.
- **Evidence markers.** **[V]** = a fact I verified by running or reading something. **[O]** = my opinion or recommendation.

## 0. Verdict at a glance

| Item | Result |
|---|---|
| `npx vitest run` / `npx tsc --noEmit` | **[V]** 8 files, 200 tests passed / 0 errors |
| Fixtures 01–13, local engine (`npm run -s engine`) | **[V]** All 13 run. All entries balance. The accounting is correct (see §1). |
| Phase 1 blocking issues | **[V] Fixed.** <br>• Fixture 03 books D 6257 160.60 / D 44566 14.60 / C 401BOUCHON 175.20. <br>• Every SIREN / VAT id in the outputs is in the `000001008…000001073` range. <br>• No article number or `CGI` / `L441-` / `BOI-` string appears in any of the 13 outputs, nor in llms.txt, the catalog, agent.json or openapi. <br>• All 25 legal bases still have an empty `reviewed_by`, and none is exposed. |
| Public `/api/demo/run`, scenarios 01, 03, 04 and 06, compared with the local engine | **[V]** `entry.lines`, compliance, anomalies, confidence, review flag and explanation are **byte-identical** to the local engine output (only `request_id` and `receipt` differ). |
| `npm run warmup -- --url <public>` | **[V]** 15/15 checks green |
| Playwright, 1280×720, whole demo run twice | **[V]** 2 × (4 live runs + 4 replays): every run completed, with no fallback, no page errors, no console errors and no failed requests. Each run took 13.4–15.4 s at 1× animation speed (under 1 s of agent time). All landing-page links return 200. |
| Blocking findings | **0** |
| Major findings | **5** |
| Minor findings | **10** |

## 1. Accounting review of the fixtures (expert-comptable)

Every entry below was recomputed by hand. Notation: D = debit, C = credit, amounts in EUR.

| # | Entry produced (verified) | Verdict |
|---|---|---|
| 01 | HA: D 6064 140.00 / D 44566 28.00 / C 401BURO 168.00. Compliant, confidence 0.98, no review. | OK |
| 02 | Same entry as 01. `non_compliant` because `FR-EINV-SIREN-BUYER` fails (error; supplier declared `mid`, per ADR-019). Review reason `NON_COMPLIANT_INVOICE`. Explanation says "proposed entry … pending review". | OK |
| 03 | D 6257 160.60 / D 44566 14.60 / C 401BOUCHON 175.20. Two `VAT_RATE_MISMATCH` anomalies (excess 13.60 + 1.00). `legal_basis_id` = `LB-VAT-DEDUCTION-LEGALLY-DUE`. The `vat.note` states the 14.60 excess. Review required, confidence 0.86. | **OK. Phase 1 finding B1 is fixed.** 10% is right for food and coffee consumed on site. |
| 04 | D 6226 2200.00 / D 44566 440.00 / C 4452 440.00 / C 401KRANICH 2200.00. Regime `reverse_charge_intra_eu`. Reverse-charge mention and customer VAT id are checked. | OK. The explanation says "2200.00 EUR incl. VAT" for an invoice that carries no VAT (minor, m9). |
| 05 | D 6228 1200.00 / C 401FORMACOM 1200.00. Regime `exempt`, deductible false. `FR-EINV-VAT-ON-DEBITS` is no longer emitted. | OK |
| 06 | Same entry as 01, plus `DUPLICATE_SUSPECTED`. Wording: "proposed entry … not to be posted until the suspected duplicate is cleared". The agent keeps it as a DRAFT. | OK |
| 07 | D 401BURO 54.00 / C 6064 45.00 / C 44566 9.00. The L441 checks are skipped on the credit note. | OK |
| 08 | D 2183 1450.00 / D 6063 29.00 / D 44562 290.00 / D 44566 5.80 / C 401NUMERIA 1774.80. `FIXED_ASSET_CAPITALISED`. | OK |
| 09 | HA "purchase view": D 6226 800 / D 44566 160 / C 401VASQUELI 960. Review reason `CASH_BASIS_CLIENT` (ADR-014). | OK, as accepted in ADR-014 |
| 10 / 13 | D 6064 190 / D 6156 210 / D 44566 80 / C 401COPILAB 480. Nature `mixed`. Fixture 13 (UBL) gives the same entry. | OK |
| 11 | Identical to 01, with `facturx_cii`. | OK |
| 12 | BQ: D 401BURO 168 / C 512000 168. Match score 1. | OK. `vat.regime: out_of_scope` remains (Phase 1, not applied; harmless). |

**Live endpoints other than `/entry` [V]:**
- `invoice/check` on fixture 02 returns 200, `non_compliant`, failing rule `FR-EINV-SIREN-BUYER`, and a receipt for 0.05.
- `audit` on fixtures 01, 03, 04 and 06 returns 200 for 1.00. It finds 2 × VAT_RATE_MISMATCH and DUPLICATE_SUSPECTED (entry 4 = entry 1). The statutory-auditor view uses materiality 5000; the tax-inspector view is structured JSON. Total debits are 3151.20, which is correct.
- The minimal body published in llms.txt returns a balanced 90 / 18 / 108 entry.

## 2. Brief compliance and grading criteria (live checks on the public URL)

| Requirement (§1 / §6) | Status | Evidence |
|---|---|---|
| Zero sign-up, payment is the authentication | ✅ [V] | No key or header is needed. |
| 402 carries the x402 requirements | ✅ [V] | `curl -X POST /api/v1/entry -d '{}'` returns **402** with a `PAYMENT-REQUIRED` header. Decoded: `x402Version 2`, `resource{url, description, mimeType}`, `accepts[0]{scheme exact, network eip155:84532, amount "150000", asset 0x036C…CF7e, payTo 0xCB4b…dFeC, maxTimeoutSeconds 300, extra{USDC,2}}`. The JSON body is `{error:{code:"PAYMENT_REQUIRED", details{…, mode:"simulated", how_to_pay}}}`. `invoice/check` and `audit` also return 402. |
| PAYMENT-RESPONSE with the tx hash | ✅ [V] | Decoded: `{success, payer, transaction:0x5151…, network, amount, extra{simulated:true, note:"SIMULATED settlement…"}}`. |
| Discovery files | ✅ [V] | catalog, openapi 3.1 (10 paths, `x-x402` on each paid operation), llms.txt (states that the mode is SIMULATED), and agent.json (A2A-style, `payments:["x402"]`). |
| MCP server | ✅ [V] | `initialize` and `tools/list` return `check_invoice`, `create_entry`, `audit_entries`, `get_catalog` and `get_receipt`, each with `_meta["x402/price"]`. An unpaid `create_entry` returns `isError` plus the x402 PaymentRequired (same price and payTo). `GET /mcp` returns 405 as a JSON error. |
| Idempotency and receipts | ✅ [V] | Same `Idempotency-Key` and same body: 200, same `request_id` and tx, `idempotent-replay` header, no second charge. Same key, different body: **409 `IDEMPOTENCY_CONFLICT`**. `GET /receipts/{id}` returns 200 with the receipt and result. An unknown id returns 404 `NOT_FOUND`; a malformed id returns 400 `INVALID_RECEIPT_ID`. |
| Strict JSON and machine-readable errors | ✅ [V] | A paid call with a bad body returns 400 `INVALID_INPUT` with per-path details, and **no settlement** (no PAYMENT-RESPONSE header). Every error uses the `{error:{code,message,details,docs_url}, request_id}` envelope. |
| Agent spending policy | 🟡 [V] | `npm run agent -- --url <public>`: item 90 (audit at 1.00) is refused, with the log line "Price 1.00 USDC > max per call 0.20 USDC … refused … Nothing was signed". **Not visible in the jury UI** (see M3). |
| Payment modes and labels | 🟡 [V] | SIMULATED is labelled everywhere: badge, "SIMULATED tx", operator rows, llms.txt, receipt `mode`. REPLAY has a banner. **TESTNET has never run publicly** (M1). The UI selector disagrees with the server mode (M2). |
| Not a human app with a chatbot attached; shows what the agent requests and receives | ✅ [V] | The landing page says "Built for agents, not humans", "This website is only a window into agent-to-agent traffic", and has a "What the agent sends, what it receives" block. `/live` shows the raw request, the 402 with the decoded header and a requirements check, the PAYMENT-SIGNATURE, and the 200 with the decoded PAYMENT-RESPONSE, next to "What the agent received". [O] This is clearly respected and visible. |
| PoC timing under 60 s per invoice | ✅ [V] | 13–15 s on screen at 1×. Agent time 0.6–0.9 s. |
| Deliverables | 🟡 | Drafts exist. `PROMPTS_SUBMISSION.md` is missing (Phase 7). `BRIEF_COMPLIANCE.md` is still dated "end of Phase 0" (m1). |

## 3. Findings

### Blocking

None.

### Major

**M1 — The default demo path (TESTNET) has never run on the public URL, although the agent wallet is now funded.**
- [V] An `eth_call balanceOf` on Base Sepolia at 11:39 UTC shows:
  - agent `0xD25E…c1BF`: **20.000000 test USDC**;
  - service `payTo` `0xCB4b…dFeC`: **0**. No real payment has ever settled.
- `/api/health` still reports `simulated`.
- Master prompt §6 makes testnet "the default for the live demo", and Phase 2's done criterion is a tx visible on the explorer. The demo script's 0:55–1:20 step clicks the explorer link. In simulated mode `explorer_url` is null, so there is no link.
- **Fix:**
  1. Set `PAYMENT_MODE=testnet` on the Worker and redeploy.
  2. Run `npm run pay:testnet -- --url <public>` and check the tx on sepolia.basescan.org.
  3. Re-record `demo/replays/*.json` from real testnet runs (`docs/HOSTING.md` step 5).
  4. Re-run the warmup and this Playwright pass.

**M2 — `/live` (as deployed) shows TESTNET when the server runs SIMULATED.**
- [V] `components/live/LiveConsole.tsx:35` defaults `runMode` to `"testnet"`. The idle screen shows a green **TESTNET** badge and the text "Run scenario calls the real agent (TESTNET)" (`02-live-idle.png`).
- After a run, the TESTNET toggle is still pressed while the badge says **SIMULATED** (`03-live-run-03.png`). Nothing explains the mismatch.
- The server ignores the client's `mode` (`app/api/demo/run/route.ts:76`, `trace.mode = modeLabel`).
- A juror sees "TESTNET" selected and then gets "SIMULATED".
- **Fix:** the uncommitted WIP (`fetchServerMode` plus disabling the unavailable mode) addresses this. Commit and deploy it. M1 makes it moot either way.

**M3 — The spending-policy refusal (§6) is invisible in the jury-facing UI.**
- [V] `/live` offers only scenarios 01, 03, 04 and 06 (`lib/console/scenarios.ts`), all of which are allowed.
- [V] In SIMULATED, each live run starts from a fresh ledger (`route.ts:94`), so it always shows "Spent today 0.00 + 0.15".
- [V] The refusal exists only in the CLI (inbox item 90).
- "Refuses to pay if the price exceeds its policy, and logs why" is a §6 requirement that weighs on the 25% "fit for agents" criterion.
- **Fix:**
  - Add a fifth console scenario, "90 · Batch audit 1.00 USDC > max_per_call 0.20 → REFUSED". The route needs `scenario: "90"` plus a recorded replay. The trace already has `policy` and `review` steps.
  - Or add a backup slide or demo line showing the CLI output.

**M4 — The demo script says the replays are real testnet runs; they are not.**
- [V] All 4 `demo/replays/*.json` have `recorded_from: "simulated"` and fake `0x5151…` hashes.
- The `/live` banner itself says "recorded from a simulated run".
- `deliverables/DEMO_SCRIPT.md:50` (WIP) has the narrator say "recorded from a real testnet run … with its real transaction hash you can check on the explorer afterwards". The committed version says the same at its level 3.
- On stage, this sentence would contradict the screen.
- **Fix:** re-record the replays on testnet (M1). Until then, change the line to "recorded earlier from the same agent, simulated payment, labelled on screen".

**M5 — The Q&A prep states that the legal references are reviewed; none are.**
- [V] `engine/rules/legal-basis.ts` contains 25 legal bases, and every `reviewed_by` is `""`.
- `deliverables/QA_PREP.md:36` says "Legal references come only from a curated table reviewed by a qualified accountant." That is false today, and a finance or audit juror may ask.
- **Fix:** either have Ary sign off the entries (fill `reviewed_by`, per `LEGAL_REVIEW.md`), or reword the answer to: "a curated table; no article number is exposed until a qualified accountant signs it off (pending)". Also fill in `{{TEST_COUNT}}` with 200.

### Minor

**m1 — Stale compliance checklist.**
- [V] `docs/BRIEF_COMPLIANCE.md:5` still says "end of Phase 0". Most rows are ⬜, and row B5 says "Vercel public URL".
- The brief (§2.4) requires an update at every phase, and this file is evidence for graders.
- **Fix:** update it with the evidence listed in §2 above.

**m2 — The bookkeeper message understates the VAT excess.**
- [V] The fixture-03 bookkeeper message says "(13.60 EUR of VAT too much)", but the entry and the `vat.note` say 14.60.
- Cause: `agent/core.ts:584` passes only the first anomaly's `detail`, and `agent/narrative.ts:93` regex-parses that one line.
- This is a stale amount on the key demo screen.
- **Fix:** sum the excess over all `VAT_RATE_MISMATCH` anomalies, or parse it from `vat.note`.

**m3 — The VAT panel contradicts the ledger for fixture 03.**
- [V] It shows "Deductible: yes · Base / VAT 146.00 / 29.20 at 20%" (`components/live/ResultPanel.tsx:202–206`), next to a ledger line of 44566 14.60.
- **Fix:** add a "Deductible VAT" row computed from the 4456x lines (14.60), or show "partly (14.60 of 29.20)".
- [O] The engine could also expose `vat.deductible_amount` as an additive field.

**m4 — "Compliant" next to a wrong VAT rate.**
- [O] Fixture 03 shows a green **COMPLIANT** chip beside the VAT anomaly, and §5.4 offers a `warning` status.
- **Fix:** relabel the chip "Mentions compliant", or return `warning` when a `VAT_RATE_MISMATCH` is present.

**m5 — Replay spend figures differ from live runs.**
- [V] The replays show "Spent today 0.30 / 0.45 / 0.60" (03, 04, 06), because `scripts/record-replays.ts:112` uses one shared ledger. Live runs always show 0.15.
- **Fix:** use one ledger per scenario when recording, or keep it shared and say so.

**m6 — Odd agent time on replays.**
- [V] Replays show "0.0 s of agent time" (`LiveConsole.tsx:298`).
- **Fix:** hide the figure when it is under 0.1 s, or record replays against the public URL so that real latency is captured.

**m7 — Raw JSON overflows its card.**
- [V] The 402 step's `requirements_check` chip prints raw JSON that overflows the card horizontally (`06-live-03-step402.png`).
- **Fix:** render it as 5 ✓ chips (amount, asset, network, payTo, scheme), or add `overflow-wrap:anywhere`.

**m8 — The operator view has an empty tile.**
- [V] The "Needing human review" tile shows "—" and "not reported by this source" (`04-operator.png`).
- **Fix:** hide the tile, or store `human_review_required` in the receipt record and count it.

**m9 — Wording for an invoice without VAT.**
- [V] The fixture 04 explanation and agent text say "2200.00 EUR incl. VAT" for an invoice with no VAT.
- **Fix:** write "total 2200.00 EUR (no VAT invoiced)" when `total_vat = 0`.

**m10 — The data-retention answer understates what is stored.**
- [V] `QA_PREP.md:24` says "the invoice is processed in memory".
- In fact, receipts store the full result for 30 days (KV TTL, `lib/store/cloudflare-kv.ts:15`), and that result includes supplier and customer names, addresses and SIRENs. Supplier fingerprints are also stored with no TTL.
- **Fix:** state this, and set `{{RETENTION_PERIOD}}` to 30 days.

### Notes (no action needed)

- [V] An idempotent replay with the same key and body but **no payment** returns the stored 200. This is consistent with the free receipts endpoint, and it needs the exact key and body. [O] Acceptable.
- [V] `/operator` updated immediately after a run (+1 call, +0.15). A KV read-modify-write can lose an increment when two calls are concurrent; this is documented and acceptable.
- [O] Projector readability:
  - Body text is about 16–17 px with high contrast. It is readable at 1280×720 and better at the 125–150% zoom the script plans.
  - The raw HTTP blocks (about 13 px) need zoom.
  - At the end of a run the timeline scrolls to the last step, so the driver must scroll back up to point at the 402 step. The script should say so.
- [V] No "Atelier Lumen" (without "or"), no old company name, and no non-`000` SIREN appears on any public page, discovery file or replay. Prices are consistent everywhere: 0.05 / 0.15 / 1.00, policy 0.20 / 2.00.
- [V] `deliverables/SLIDES_OUTLINE.md` B2 now says Cloudflare (WIP). The README and the WIP demo script are being updated; re-check them after the Phase 6 commit.

## 4. Screenshots (`docs/reviews/phase5/`, 1280×720, deviceScaleFactor 1)

- **Landing:** `01-landing*.png`.
- **/live, idle:** `02-live-idle.png`.
- **/live, finished runs and replays:** `03-live-run-0{1,3,4,6}.png`, `03-live-replay-0{1,3,4,6}.png`, `03-live-run-03-top.png`.
- **/live, scenario 03 details:**
  - 402 step: `06/07-live-03-step402*.png`;
  - 200 step: `08-live-03-step200.png`;
  - ledger: `09-live-03-ledger.png`;
  - compliance checks: `10-live-03-compliance.png`;
  - spending-policy step: `11-live-03-policy.png`.
- **Operator:** `04-operator*.png`.
- **Office:** `05-office*.png`.

## 5. Resolution (fix workstream, 2026-11-16, after the review)

Not deployed by the fix workstream: the orchestrator deploys and re-records the replays on TESTNET afterwards.
`npx vitest run`: **8 files, 217 tests passed**. `npx tsc --noEmit`: 0 errors.

| Finding | Status | What changed |
|---|---|---|
| **M1** testnet never run publicly | Left to the orchestrator | Operational (set `PAYMENT_MODE=testnet`, redeploy, `pay:testnet`, re-record). `record:replays` now also records 90 and expects `refused_by_policy` for it (`docs/HOSTING.md` step 5). |
| **M2** TESTNET selected vs SIMULATED server | Already fixed in Phase 6 (ADR-022) | Console reads `/api/health` and disables the other mode. |
| **M3** policy refusal invisible | **Fixed** | Scenario **90 · Audit request 1.00 USDC > max_per_call 0.20 → REFUSED by policy** in `/live` (`lib/console/scenarios.ts`, `agent/scenarios.ts`). `POST /api/demo/run {"scenario":"90"}` runs the real agent: catalog → health → policy REFUSE → escalation; no POST to `/api/v1/audit`, nothing signed, outcome `refused_by_policy` (runs in any mode, ephemeral wallet allowed since nothing is signed). The result column shows a red **REFUSED BY POLICY — no payment made** panel: price vs limit, spent today unchanged, the HTTP calls actually made, the escalation message. Replay `demo/replays/90.json` recorded by `npm run record:replays` (agent code) against a local SIMULATED server; it is not a stored call, so operator stats ignore it. Tests: route, replay, `policyRefusalSummary`. |
| **M4** demo script claims testnet replays | **Fixed (conditional wording)** | `DEMO_SCRIPT.md` level 2: the narrator reads the REPLAY line and says "recorded from a real Base Sepolia testnet run …" **only if** it reads *recorded from a testnet run* (`recorded_from: "testnet"`); otherwise "recorded earlier from the same agent, simulated payment, labelled on screen". The current replays are `recorded_from: "simulated"` until the orchestrator re-records them. Optional 15 s segment for scenario 90 added. |
| **M5** QA_PREP claims reviewed legal references | **Fixed** | Q10 now says the table is curated and hidden from agents until a chartered accountant signs each entry off (pending); `{{TEST_COUNT}}` → 217 (`npx vitest run`), 13 fixtures. `reviewed_by` stays empty: signing off is Ary's decision, not a code fix. |
| **m1** stale BRIEF_COMPLIANCE | Already fixed in Phase 6 | Rows for replays and the spending policy updated with scenario 90. |
| **m2** bookkeeper message 13.60 | **Fixed** | `totalExcessVat()` (`agent/narrative.ts`) sums the excess over all `VAT_RATE_MISMATCH` anomalies (fallback: `vat.note`); `agent/core.ts` passes it. Fixture 03 now says "14.60 EUR of VAT too much". |
| **m3** VAT panel contradicts the ledger | **Fixed** | `vatSummary()` (`lib/console/format.ts`) reads the 4456x / 4452 lines, totals, `vat.breakdown` and anomalies. 03: "Deductible: partly · Invoiced 146.00 + VAT 29.20 at 20% · Deductible VAT booked (44566) 14.60 EUR of 29.20 · Not deducted 14.60 EUR → added to the expense (VAT legally due at 10%)". 01/06: 28.00 of 28.00. 04: none invoiced, 440 self-assessed, due 440 = deductible 440, net 0. Engine unchanged (no `vat.deductible_amount` field added: the ledger already carries it). |
| **m4** COMPLIANT next to a VAT anomaly | **Fixed (label), engine semantics unchanged** | Chip "Invoice mentions: compliant" + separate amber "VAT anomaly: VAT_RATE_MISMATCH" chip; agent 200 step "(invoice mentions compliant, review required)". `compliance.status` keeps meaning "mandatory mentions" (ADR-023). |
| **m5** cumulative spend in replays | **Fixed** | `scripts/record-replays.ts` uses a fresh spend ledger and mock ERP per scenario, like a live run. All replays re-recorded: "Spent today 0.15 / 2.00" (policy step 0.00 + 0.15). |
| **m6** "0.0 s of agent time" | **Fixed** | `agentTimeLabel()` hides the figure under 0.1 s. |
| **m7** JSON chip overflow on the 402 step | **Fixed** | `requirements_check` renders as `amount ✓ / asset (USDC) ✓ / network ✓ / payTo ✓ / scheme ✓`; `.hl` chips wrap (`overflow-wrap: anywhere`). |
| **m8** empty "Needing human review" tile | **Fixed** | Store `recent_transactions[].human_review_required` (read from the stored result); `/api/v1/operator/stats` returns `recent[].human_review_required` and `review_window: {calls, review_required}` (exact count over the recent window, never extrapolated: the old normaliser scaled a ratio to all calls). Tile shows "x of the last N calls", and is hidden when the source reports nothing. A store-wide counter was not added (it would need a schema/counter change in five stores for a PoC tile). |
| **m9** "incl. VAT" on a VAT-free invoice | **Fixed** | Engine explanation "(2200.00 EUR, no VAT invoiced)" when `total_vat = 0`; agent intake "(no VAT invoiced)" / "charged no VAT"; result panel "2,200.00 EUR total payable to the supplier · reverse charge: VAT self-assessed". |
| **m10** retention wording | **Fixed** | QA_PREP Q6: receipts keep the full result (names, addresses, SIRENs) for 30 days (KV TTL); invoice fingerprints are kept with no expiry today (production: retention period to set). |
| Note: scroll back to the 402 step | Already in the demo script | — |

Checked visually with headless Chrome against a scratch `next dev` (SIMULATED): replays 90, 03 and 04 render as described.
