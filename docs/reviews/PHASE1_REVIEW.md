# Phase 1 review: accounting engine (independent reviewer)

- **Reviewer:** independent reviewer subagent. It did not write the engine. It reviewed as a French expert-comptable / commissaire aux comptes would.
- **Date:** 2026-11-16
- **Scope:** `engine/`, `fixtures/01–13`, `docs/ENGINE.md` (including its open points), `docs/DECISIONS.md` (ADR-008, ADR-014), `docs/LEGAL_REVIEW.md`, and the §5.4 contract.
- **Method:** I ran every fixture with `npm run -s engine -- <fixture> --no-llm` and recomputed each entry by hand. I read `vat.ts`, `pcg.ts`, `mentions.ts`, `legal-basis.ts`, `core.ts` and `entry.ts`. I ran the batch audit on fixtures 01, 03 and 06. I re-ran fixtures 03, 11 and 12 to check determinism. I looked up every fixture SIREN in the public company register (recherche-entreprises.api.gouv.fr) and the German VAT id in VIES.
- **Read-only:** the only file written is this report.

## 0. Verdict at a glance

| Item | Result |
|---|---|
| `npx vitest run` | **5 files, 118 tests passed** |
| `npx tsc --noEmit` | **0 errors** |
| Determinism | Identical output on re-run (03, 11, 12 checked; also covered by the tests) |
| Works without an LLM key | Yes: all 13 fixtures run with `--no-llm`, and `ANTHROPIC_API_KEY` is not set in this container |
| Balance | Every entry balances to the cent |
| Blocking issues | **2**: fixture 03 VAT deduction; real SIRENs in "fictional" data |
| Major issues | **2**: unreviewed article numbers leak in a `fix_hint`; reform-mention start date |
| Minor issues / debatable choices | 14 (see §3) |

## 1. Per-fixture review

Notation: `D` = debit, `C` = credit, amounts in EUR.

| # | Scenario | Produced | Expected (reviewer) | Verdict | Severity | Issue / fix |
|---|---|---|---|---|---|---|
| 01 | Office supplies 20% | HA: D 6064 140.00 / D 44566 28.00 / C 401BURO 168.00. Compliant, conf. 0.98 | Same | **OK** | — | Line totals checked (90 + 18.40 + 31.60 = 140.00, VAT 28.00, TTC 168.00). See SIREN finding B2. |
| 02 | Buyer SIREN missing | Same entry; `non_compliant` (FR-EINV-SIREN-BUYER, error); review `NON_COMPLIANT_INVOICE`; conf. 0.94 | Same entry. The status depends on the reform date policy (M2) | **OK (policy caveat)** | Major (M2) | The accounting is right. Making this an `error` from 2026-09-01 for *every* issuer is debatable, because the supplier is an SME SARL (see M2). |
| 03 | Restaurant billed at 20% | D 6257 146.00 / **D 44566 29.20** / C 401BOUCHON 175.20. `VAT_RATE_MISMATCH` ×2 (excess 13.60 + 1.00), review, conf. 0.86. `vat.deductible: true`, `legal_basis_id: LB-VAT-RATE-STANDARD`, explanation "standard 20% VAT" | **D 6257 160.60 / D 44566 14.60 / C 401BOUCHON 175.20.** Alternatively, keep 6257 146.00 and add a second 6257 line of 14.60 labelled "TVA non récupérable (taux erroné)". Keep `VAT_RATE_MISMATCH` and the review flag | **ISSUE** | **BLOCKING** | See B1. The engine's own anomaly text says "only the VAT legally due is deductible", and the audit's tax-inspector viewpoint recommends "reverse the excess from 44566". Yet the entry deducts the full 29.20, so the output contradicts itself. The demo agent posts it to the ERP (`posted_review_pending`). The cafés at 10% (non-alcoholic drinks consumed on site) are correctly expected at 10%. 6257 is an acceptable account for a business lunch with clients. |
| 04 | DE consulting, reverse charge | D 6226 2200.00 / D 44566 440.00 / C 4452 440.00 / C 401KRANICH 2200.00. Regime `reverse_charge_intra_eu`, compliant, conf. 0.98 | Same | **OK** | — | The customer VAT id and the "Autoliquidation / Reverse charge" mention are correctly required. L441-9/L441-10 and the FR-EINV checks are correctly skipped for a non-established supplier. The DE VAT id `DE298765431` is invalid in VIES, so it is not a real company. Optional: add an info rule saying the buyer must e-report this cross-border service acquisition under the reform (to verify). Optional: a sub-account 445662 for intra-EU deductible VAT. |
| 05 | Exempt training | D 6228 1200.00 / C 401FORMACOM 1200.00. Regime `exempt`, compliant | Same | **OK (debatable account)** | Minor | 6228 is acceptable: the PCG has no dedicated account for external training, and 6333 is the training *tax*. `FR-EINV-VAT-ON-DEBITS` is shown on an exempt invoice where no VAT is charged; skip it (m3). |
| 06 | Duplicate of #1 | Same entry as 01. `DUPLICATE_SUSPECTED` (warning), review, conf. 0.92 | Detection is correct. The entry should be returned as "proposed, do not post" | **OK (wording)** | Minor | The explanation says "is booked in journal HA" for a suspected duplicate. Write "Proposed entry, not to be posted until the duplicate is cleared", and consider severity `error` for `DUPLICATE_SUSPECTED`. The demo agent already saves it as a DRAFT, which is good. |
| 07 | Partial credit note (return) | D 401BURO 54.00 / C 6064 45.00 / C 44566 9.00. Compliant | Same | **OK** | — | A return correctly credits the original expense account. A *discount* (rabais/remise) should go to 609x, for example 6096 for supplies bought under 606x (m10). For credit notes, do not require the L441-10 penalty and EUR 40 mentions (m2). |
| 08 | Laptop 1,450 + mouse 29 | D 2183 1450.00 / D 6063 29.00 / D 44562 290.00 / D 44566 5.80 / C 401NUMERIA 1774.80. `FIXED_ASSET_CAPITALISED` (info) | Same | **OK** | Minor (threshold edge) | Capitalisation and VAT on fixed assets (44562) are correct, and the mouse is correctly expensed in 6063. Edge case: the BOFiP tolerance covers items whose unit value "n'excède pas 500 € HT", so a 500.00 item may be expensed. The test should be `> 500`, not `>= 500` (m1). |
| 09 | BNC lawyer (cash basis) | HA: D 6226 800.00 / D 44566 160.00 / C 401VASSEUR 960.00. `CASH_BASIS_CLIENT`, review, conf. 0.98 | Acceptable as a *memo* (ADR-014). The true recognition is at payment: **BQ, payment date: D 6226 800.00 / D 44566 160.00 / C 512 960.00** | **OK (debatable, wording)** | Minor | The treatment matches the accepted ADR-014 and the case is flagged. The explanation, however, says "is booked in journal HA", which contradicts a recettes-dépenses ledger. Write "proposed purchase view, to be recorded at payment". When a bank transaction for a cash-basis client matches an invoice, the bank entry should recognise the expense (6226/44566/512), not settle a 401 account (m7). Whether this is a rétrocession or an ordinary fee in the 2035 return remains an open point for Ary. |
| 10 | Mixed goods + services | D 6064 190.00 / D 6156 210.00 / D 44566 80.00 / C 401COPILAB 480.00. Nature `mixed`; note that VAT on the services part is deductible on payment | Same | **OK** | — | Toner and paper go to 6064 and the maintenance contract to 6156; both are correct. The Q4 2026 maintenance needs no prepaid-expense entry (CCA) if the year ends 31/12. The 42.00 of VAT on the services part becomes deductible only on payment (see m11). |
| 11 | Factur-X of #1 | Identical to 01 (byte-identical JSON except `extraction_method: facturx_cii`) | Same | **OK** | — | — |
| 12 | Bank payment of #1 | BQ 2026-11-04: D 401BURO 168.00 / C 512000 168.00. Match score 1, no review | Same | **OK** | Minor | `vat.regime: "out_of_scope"` is misleading on a payment entry, because "hors champ" is a VAT concept. Prefer `not_applicable`. The output also carries a `compliance` block (status "compliant" from `BQ-MATCH-INVOICE`), which is odd but harmless. |
| 13 | UBL of #10 | Identical to 10 (`ubl`) | Same | **OK** | — | Mapping BT-23 `M1` from `ProfileID` to "mixed" is consistent with the French framework codes (B1/S1/M1). |

## 2. Blocking and major findings

### B1. Fixture 03 deducts VAT that is not legally due (BLOCKING)
- **What is wrong.** The engine books all 29.20 of invoiced VAT in 44566 and sets `vat.deductible: true`. Only the VAT legally due (10% = 14.60) is deductible. VAT that is charged only because it appears on the invoice is due by the issuer but cannot be deducted by the buyer (this is the rationale of `LB-VAT-INVOICED-VAT-DUE`).
- **The output contradicts itself.** The anomaly text and the audit's tax-inspector viewpoint ("Deduct only the VAT legally due (reverse the excess from 44566)") both say the opposite of the entry.
- **ADR-008 is still respected by the fix.** ADR-008 says never to *silently correct the invoiced amount*. The fix keeps the supplier credit at the invoiced 175.20 and keeps the flag. It only applies the right to deduct correctly.
- **Correct entry:**
  - D 6257 160.60 (146.00 + 14.60 non-deductible excess VAT)
  - D 44566 14.60
  - C 401BOUCHON 175.20
- **Code fix.** In `core.ts` (`analyseInvoice`), for an FR supplier whose `unexpectedRate` returns expected rates whose minimum is below the invoiced rate:
  - `due = vatCents(baseCents, minExpected)`
  - `deductiblePart = min(due, vatPerLine[i])`
  - `excess = vatPerLine[i] - deductiblePart`, which is added to the charge line
  - Book only `deductiblePart` in 44566
  - Set `vat.legal_basis_id` to `LB-VAT-INVOICED-VAT-DUE`
  - Add to `vat.note`: "14.60 EUR excess VAT (invoiced at 20% instead of 10%) is not deductible and is included in the expense; request a corrected invoice to recover it."
  - Change the explanation from "standard 20% VAT" to "invoiced at 20%; 10% legally due".
- **Files to update:** `fixtures/expected/03.expected.json`, the §11 table in `ENGINE.md` (close open point 2), the anomaly text (replace "The entry books the VAT as invoiced"), and the replay/demo traces for scenario 03.
- **Confidence and review:** keep the confidence and `human_review_required: true` unchanged.

### B2. "Fictional" SIRENs belong to real registered entities (BLOCKING for a public demo)

**Public-register lookup** (recherche-entreprises.api.gouv.fr, 2026-11-16):

| SIREN | Used for | Register |
|---|---|---|
| 902417351 | Demo client "Atelier Lumen SAS" (`engine/profile.ts`, all fixtures) | **Real company (ceased)** |
| 903182640 | Buro Express (01, 02, 06, 07, 11, 12) | **Real company (ceased)** |
| 904521978 | Le Bouchon Lumière (03) | **Real company (active)** |
| 907843262 | Lawyer client (09) | **Real sole trader, a natural person (active)** |
| 908152739 | Cabinet Vasseur (09) | **Real sole trader, a natural person (active)** |
| 909461824 | Copilab (10, 13) | **Real accounting firm (active)** |
| 905736187, 906294517 | Formacompta (05), Numeria (08) | Not found |
| 999000116 / 999000124 / 999000132 | `demo/replays/*` | Not found, **but not Luhn-valid**. Neighbouring 999000xxx numbers are allocated. |

**Why it matters.**
- ADR-015 and `ENGINE.md` state "fictional SIREN", and the brief requires clearly synthetic data.
- Publishing real identifiers next to invented names is a misleading-data and privacy risk, especially for the two natural persons.

**Fix.** Use Luhn-valid SIRENs in the unallocated `000…` prefix. None of these returned a hit in the register, and `isValidSiren` accepts them. Recompute the FR VAT keys as `(12 + 3 × (SIREN mod 97)) mod 97`:

| Party | Replacement SIREN | Replacement VAT id |
|---|---|---|
| Atelier Lumen | 000001008 | FR29000001008 |
| Buro Express | 000001016 | FR53000001016 |
| Le Bouchon Lumière | 000001024 | FR77000001024 |
| Formacompta | 000001032 | FR04000001032 |
| Numeria | 000001040 | FR28000001040 |
| Lawyer client | 000001057 | FR79000001057 |
| Cabinet Vasseur | 000001065 | FR06000001065 |
| Copilab | 000001073 | FR30000001073 |

**Places to update:**
- `fixtures/*.json`
- `fixtures/13.ubl.xml`
- `scripts/make-facturx.ts`, then regenerate `11.pdf`
- `fixtures/expected/*`
- `engine/profile.ts`, `agent/core.ts`, `scripts/pay-common.ts`, `lib/discovery/llms.ts`
- `inbox/`, `demo/replays/`
- the `history.supplier_key` in fixture 06
- docs

Add a test that every SIREN in `fixtures/` starts with `000`.

### M1. Unreviewed article numbers reach agents through a `fix_hint` (MAJOR, brief §5.4)
- **What leaks.** `engine/rules/mentions.ts`, rule `FR-INV-VAT-EXEMPTION-MENTION`, returns this fix_hint: `'… "Exonération de TVA, article 261-4-4° a du CGI" or "TVA non applicable, art. 293 B du CGI"'`.
- **Confirmed:** removing `legal_mentions` from fixture 05 produces this hint in the API output. Neither `LB-VAT-EXEMPT-TRAINING` nor `LB-VAT-FRANCHISE` is reviewed, so the `publicLegalBasis` gating is bypassed.
- **Why the test misses it.** The leak test regex `/CGI art\.|L441-|242 nonies/` does not match these strings.
- **Fix:**
  - Reword the hint: "Add the legal VAT-exemption mention (exemption ground or VAT-franchise mention); see legal_basis_id LB-VAT-EXEMPT-TRAINING / LB-VAT-FRANCHISE."
  - Broaden the test to something like `/\bart(icle)?\.?\s*\d|\bCGI\b|L\d{3}-\d+|BOI-/i`.
  - Run the test over failing variants of every rule (not only the green fixtures), over `checkInvoice`, and over `auditEntries`.
- The engine outputs for all 13 fixtures and the audit output are otherwise clean: no article numbers.

### M2. Reform-mention start date (open point 1) (MAJOR, debatable)
- **Current behaviour.** `REFORM_MENTIONS_FROM = 2026-09-01` makes buyer SIREN, operation category and so on an `error` for every domestic B2B invoice from that date.
- **Reviewer's reading (TO VERIFY with Ary against the décret and the DGFiP FAQ).** The four new mentions are tied to the issuer's *issuance* obligation:
  - large companies (GE) and mid-size companies (ETI): 1 Sept 2026
  - SMEs (PME) and micro-businesses: 1 Sept 2027
  - Reception has been mandatory for everyone since 1 Sept 2026, but that does not by itself make the new mentions mandatory for an SME issuer.
- **Safest PoC behaviour:**
  - Add an optional `supplier.company_size` (GE/ETI/PME/MICRO).
  - Severity `error` when `issue_date >= 2027-09-01`, or when `issue_date >= 2026-09-01` and the size is GE/ETI.
  - Otherwise, severity `warning` with the hint "mandatory for this issuer by 1 Sept 2027 at the latest".
- **Keeping §5.6 (fixture 02 → non_compliant):** declare the fixture-02 supplier as an ETI (rename it, e.g. "Buro Express Distribution SA (fictional)", with `company_size: "ETI"`). Otherwise keep the current rule but state the assumption in the check label.
- Keep `LB-EINV-REFORM-MENTIONS` unexposed until it is reviewed. It already is.

## 3. Minor findings and debatable policy choices (with recommended PoC behaviour)

| id | Finding | Kind | Recommendation |
|---|---|---|---|
| m1 | Fixed-asset test `>= 500` | Debatable edge case | The tolerance is "valeur unitaire HT n'excédant pas 500 €", so capitalise only when `> 500`. Capitalising at exactly 500 is not wrong, because the tolerance is optional. |
| m2 | L441-9/L441-10 checks (due date, penalties, EUR 40) are applied to credit notes | Wrong scope | Skip them, or make them `info`, for `credit_note`. Otherwise a valid credit note without penalties becomes `non_compliant`. |
| m3 | `FR-EINV-VAT-ON-DEBITS` is emitted when no VAT is charged (05) | Noise | Emit it only when services carry VAT. |
| m4 | Classic mentions not checked: supplier legal form, share capital and RCS (C. com. commercial mentions); date of supply when it differs from the issue date; discount terms (escompte, L441-9); buyer's purchase-order number | Gap | Add `warning` checks with stable ids, e.g. `FR-INV-SUPPLIER-LEGAL-FORM`, `FR-INV-SUPPLY-DATE` (info), `FR-INV-DISCOUNT-TERMS`. Do not expose article numbers. |
| m5 | Some anomalies have no `rule_id`: `SUPPLIER_TOTAL_MISMATCH`, `CLASSIFICATION_UNCERTAIN`, `CUSTOMER_MISMATCH`, `FOREIGN_VAT_CHARGED`, `NON_EU_SUPPLIER`, and the bank `CASH_BASIS_CLIENT` | Contract (§5.4: every rule has a stable rule_id) | Add ids, e.g. `TOTALS-CHECK`, `PCG-CLASSIFY`, `CUSTOMER-CHECK`, `VAT-FOREIGN`, `VAT-NON-EU`, `BNC-CASH-BASIS`. |
| m6 | Non-EU supplier with no VAT → regime `out_of_scope` | Wrong label (flagged for review) | B2B services from a non-EU supplier are taxable in France and self-assessed by the buyer. Use a regime such as `reverse_charge_non_eu` or `to_review`, and propose no 4452 line (4452 is intra-EU only). Keep the human review. |
| m7 | Bank entry for a cash-basis profile settles 401 | Debatable | When `accounting_basis = cash` and the transaction matches an invoice, book expense + VAT / 512 at the payment date. |
| m8 | `FR-EINV-DELIVERY-ADDRESS` and `FR-EINV-VAT-ON-DEBITS` always return `passed: true` | Cosmetic | Add "(not verifiable from the data)" to the label, or add a `verifiable: false` field (additive change). |
| m9 | SaaS → 651 | Debatable, acceptable | 651 now covers "solutions informatiques" (ANC 2022-06). Prefer the 4-digit sub-account 6511. Web hosting ("hosting", "hébergement web") is a service, not a licence fee, so map it to 6156 or 628 instead. |
| m10 | Credit notes always credit the original expense account | Debatable | That is fine for returns (fixture 07). For discounts and rebates, add an optional `credit_reason` and use 609x (6096 for 606x). |
| m11 | VAT on unpaid services booked in 44566 at invoice date (09, 10: 42.00) | Accepted practice + note | Fine for the PoC, because the note warns that the VAT is deductible only on payment. For production, use an internal "TVA déductible en attente" sub-account, transferred to 44566 at payment (open point 4). |
| m12 | Explanations say "is booked" for 06 (duplicate) and 09 (cash basis) | Wording | Say "proposed entry" whenever `human_review_required` is true for duplicate or cash-basis reasons. |
| m13 | `FR-INV-SUPPLIER-SIREN` cites `LB-INV-MENTIONS` (the VAT mentions) | Basis mismatch | The supplier SIREN is a commercial-code mention. Add a separate unreviewed id. |
| m14 | `demo/replays/*` are stale | Consistency (Phase 5) | The replays show 401BRAS, 120.00/24.00 for scenario 03 and non-Luhn SIRENs, yet "compliant". Re-record them after B1 and B2. |

**Other open points from `ENGINE.md`, reviewer position:**
- **Training account (6228):** acceptable.
- **Materiality:** EUR 5,000, with 75% performance materiality and 5% clearly trivial, is reasonable for a small SME demo.
- **Gifts threshold:** EUR 73 incl. VAT per unit is acceptable as a proxy, as long as the beneficiary caveat is kept.
- **Self-assessment rate:** the category's French rate is fine.
- **BT-23 codes:** B1/S1/M1 are consistent with the French framework.
- **CII codes 5/72 for the VAT-on-debits option:** consistent with BT-8 (5 = invoice date / debits, 72 = paid to date). Still to confirm against the final French specifications.

## 4. Brief compliance (Phase 1)

| Requirement | Status |
|---|---|
| Stable rule_ids | Yes for checks; partly for anomalies (m5) |
| No invented or unreviewed article numbers exposed | **No.** One leak (M1). Otherwise `publicLegalBasis` gating works and every `reviewed_by` is empty. |
| Determinism | Yes |
| Engine without an LLM key | Yes (JSON, Factur-X, UBL and bank inputs) |
| Synthetic data clearly labelled | Names carry "(fictional)", but **6 SIRENs are real** (B2) |
| §5.4 contract | Matches `engine/types.ts`: `request_id` and `receipt` are added by the API layer; `review_reasons`, `disclaimer`, `match` and `vat.breakdown` are additive. Amounts have 2 decimals and entries balance. |
| Tests and typecheck | 118/118 green; `tsc` clean. After B1 and M1, update `fixtures/expected/03` and the leak test. |
