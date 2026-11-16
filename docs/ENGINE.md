# Ajean Ledger — accounting engine (Phase 1)

Framework-free TypeScript in `engine/`. Same functions are used by the paid API, the MCP server, the demo agent and the CLI.
**Rules first, LLM second:** structured inputs (JSON, Factur-X, UBL, bank transactions) are processed deterministically, with no network call. The LLM is only used for unstructured PDFs/images and for line descriptions the keyword classifier cannot place. In both cases the rules engine re-validates the LLM output.

> Proof of concept on synthetic data. Not a substitute for a chartered accountant's review.

## 1. Public API (`import … from "@/engine"`)

| Export | Purpose |
|---|---|
| `createEntry(input, ctx?) → EntryResult` | `POST /api/v1/entry`: entry + VAT + compliance + anomalies + explanation |
| `checkInvoice(input, ctx?) → CheckResult` | `POST /api/v1/invoice/check`: compliance + VAT consistency (no entry) |
| `auditEntries(items, ctx?) → AuditResult` | `POST /api/v1/audit`: up to 50 items, two expert viewpoints |
| `parseInput(input, ctx?)` | Parsed `{ invoice? , transaction?, candidate_invoices?, method, confidence }` |
| `fingerprint(invoice)` | `InvoiceFingerprint` to store in history for duplicate detection |
| `ENGINE_VERSION` (`"0.1.0"`), `DEMO_PROFILE` | Version; default client "Atelier Lumenor SAS (fictional)", SIREN 000001008 (synthetic: unallocated `000` prefix, Luhn-valid) |
| `EngineError {code, message, details}`, `ENGINE_ERROR_CODES` | Machine-readable errors (see §8) |
| `EXPENSE_CATEGORIES`, `CATEGORY_IDS`, `classifyLine` | Category list and deterministic classifier |
| `LEGAL_BASES`, `publicLegalBasis(id)` | Curated legal-basis table (references hidden until reviewed) |
| `createAnthropicAdapter()` | `LlmAdapter`, or `undefined` when `ANTHROPIC_API_KEY` is absent |

`ctx` (`EngineContext`): `profile` (default `DEMO_PROFILE`), `history` (fingerprints), `llm` (adapter), `materiality_threshold` (audit).

### Contract changes (additive only)
- `InvoiceFingerprint.document_type?` (optional): invoices and credit notes are never flagged as duplicates of each other.
- `EngineContext.materiality_threshold?` (optional): overrides the audit materiality.
- No field was renamed or removed. `EntryResult.review_reasons` holds machine-readable codes (list in §6).

## 2. Pipeline

```
input ─► parseInput (zod / pdf-lib + CII / UBL / bank / LLM)
      ─► classify each line (keywords → hint → LLM if uncertain)
      ─► fixed-asset test (IT equipment ≥ EUR 500 excl. VAT per unit)
      ─► VAT regime + deductibility per line
      ─► entry builder (integer cents, debits = credits, credit notes reversed)
      ─► mandatory-mention checks (FR-INV-*, FR-EINV-*)
      ─► anomalies (rate mismatch, totals, duplicates, …)
      ─► review reasons, confidence, explanation
```

Money: all amounts are integer cents internally (`engine/money.ts`). Outputs are numbers with 2 decimals. The invoiced VAT total is split across lines in proportion to the recomputed VAT (largest-remainder method), so the booked VAT always equals the invoiced VAT to the cent. The supplier is credited with the sum of the debits (minus self-assessed VAT), so every entry balances by construction. Any gap with the invoice's TTC is reported (`TOTALS_INCONSISTENT` / `SUPPLIER_TOTAL_MISMATCH`).

## 3. Accounts (PCG, ANC 2014-03 as amended by ANC 2022-06)

| Category id | Account | Label | Default VAT | Deductible |
|---|---|---|---|---|
| office_supplies | 6064 | Fournitures administratives | 20% | yes |
| small_equipment | 6063 | Fournitures d'entretien et de petit équipement | 20% | yes |
| it_equipment | **2183** if unit price > 500 excl. VAT, else **6063** (an item at exactly 500 is expensed) | Matériel de bureau et matériel informatique | 20% | yes (44562 on 2183) |
| professional_fees | 6226 | Honoraires | 20% | yes |
| legal_costs | 6227 | Frais d'actes et de contentieux | 20/0% | yes |
| training | **6228** | Divers — frais de formation externe | 20% or exempt | yes |
| seminars | 6185 | Frais de colloques, séminaires, conférences | 20% | yes |
| travel | 6251 | Voyages et déplacements | 10/20/0% | **no** (passenger transport) |
| missions | 6256 | Missions (staff accommodation) | 10% | **no** |
| receptions | 6257 | Réceptions | **10%** (alcohol 20%) | yes (business interest) |
| gifts | 6234 | Cadeaux à la clientèle | 20/5.5% | only ≤ EUR 73 incl. VAT per unit |
| rent_premises | 6132 | Locations immobilières | 20/0% | yes |
| rent_equipment | 6135 | Locations mobilières | 20% | yes |
| vehicle_rental | 6135 | Locations mobilières — véhicule de tourisme | 20% | **no** |
| software_subscription | **6511** | Redevances pour … solutions informatiques | 20% | yes |
| maintenance | 6156 | Maintenance (incl. web hosting) | 20% | yes |
| repairs | 615 | Entretien et réparation | 20/10% | yes |
| documentation | 6181 | Documentation générale | 20/5.5/2.1% | yes |
| telecom | 626 | Frais postaux et de télécommunications | 20/0% | yes |
| advertising | 6231 | Annonces et insertions | 20% | yes |
| printing | 6236 | Catalogues et imprimés | 20% | yes |
| utilities | 6061 | Fournitures non stockables | 20/5.5% | yes |
| insurance | 616 | Primes d'assurances | 0% | — |
| bank_fees | 627 | Services bancaires et assimilés | 20/0% | yes |
| *(no match)* | 628 | Divers | — | flagged `CLASSIFICATION_UNCERTAIN` |

Other accounts: `44566` TVA déductible sur autres biens et services, `44562` TVA déductible sur immobilisations, `4452` TVA due intracommunautaire, `401` + auxiliary code, `512` Banque, `471` Compte d'attente. Journals: `HA` purchases, `BQ` bank.

**Why these choices.**
- *Training → 6228.* The PCG has no dedicated account for external training purchased from a training body. 6228 ("Divers" under rémunérations d'intermédiaires et honoraires) is the most common practice. 6333 is the employer's *contribution* to vocational training (a tax), not a purchase. 6185 is kept for attendance at conferences and seminars.
- *SaaS → 6511.* Since ANC 2022-06, the label of 651 explicitly covers "solutions informatiques", so it fits software licences and SaaS better than 6135; the engine uses the 4-digit sub-account 6511 (Phase 1 review m9). Web hosting is a service, not a licence fee: "hébergement web" / "hosting" go to 6156.
- *Supplier auxiliary code.* `401` + the first significant word of the supplier name (legal forms, articles and "Cabinet/Maître" removed), extended with the next word while shorter than 4 characters, A–Z0–9, at most 8 characters: `401BURO`, `401BOUCHON`, `401FORMACOM`. A caller-supplied `supplier.account_code` takes precedence.
- *Classifier.* Accent-folded keyword and phrase matching. Phrases count double. A category hint (`category_hint` = category id) gives 0.95, a single matched category 0.9, a clear winner 0.8, ties 0.55, no match 0.3. Below **0.75** the line is "uncertain": with `ctx.llm` the engine asks `classifyExpense`; without it, the line is flagged (`CLASSIFICATION_UNCERTAIN`, human review).

## 4. VAT

Regime detection (`engine/rules/vat.ts`):

| Situation | `vat.regime` | Entry |
|---|---|---|
| FR supplier, single 20% rate | `standard` | expense HT / 44566 (or 44562) / 401 TTC |
| FR supplier, single 10/5.5/2.1% rate | `reduced` | same |
| several positive rates | `mixed_rates` | same, VAT split per line |
| EU supplier, no VAT charged | `reverse_charge_intra_eu` | expense HT / 44566 (44562 for assets) **debit** self-assessed VAT / 4452 **credit** same amount / 401 HT. The self-assessment rate is the category's French rate (20% by default). Services: CGI 283-2; goods: intra-community acquisition (256 bis). |
| FR supplier, all lines 0% | `exempt` | no VAT line. Legal basis: training (261-4-4° a), franchise (293 B) or generic exemption. |
| non-EU supplier, services only, no VAT | `reverse_charge_non_eu` | expense HT / 401 HT; **no** self-assessed VAT lines proposed (4452 is intra-EU only) + `NON_EU_SUPPLIER` warning: the buyer self-assesses the VAT (due and deductible), lines added after review. Legal basis `LB-VAT-REVERSE-CHARGE-SERVICES`. |
| non-EU supplier with goods, no VAT | `out_of_scope` | + `NON_EU_SUPPLIER` warning (import VAT via the customs declaration / VAT return, to be reviewed) |
| bank transaction | `out_of_scope` | no VAT on the payment entry |

- **Expected rate per category.** The engine compares each line's rate with the category's expected rates (exceptions: alcohol in a restaurant may be 20%). A mismatch raises `VAT_RATE_MISMATCH` (warning, human review) and states the excess VAT. **The invoice is never silently corrected** (ADR-008): the supplier is credited with the invoiced total and `vat.breakdown` shows the invoiced VAT. But **only the VAT legally due is deducted** (ADR-018): when the invoiced rate is above the lowest expected rate, 44566 receives `min(VAT at the expected rate on the line base, invoiced VAT)` and the excess is added to the expense line. `vat.legal_basis_id` is then `LB-VAT-DEDUCTION-LEGALLY-DUE`, `vat.note` states the excess, and the explanation says "invoiced at X%, only Y% legally due and deductible; excess Z booked to expense pending a corrected invoice".
- **Non-deductible VAT** (staff accommodation, passenger transport, passenger vehicles, gifts above EUR 73, client under franchise, foreign VAT charged by an EU supplier) is added to the expense line, not to 44566.
- **Services.** When a French supplier invoices services and has not opted for VAT on debits, `vat.note` reminds the agent that the VAT becomes deductible when the invoice is paid (CGI 269-2-c). The entry still uses 44566 (see open point 4).
- **Totals.** Line total = qty × unit price (±0.01). Sum of lines = total excl. VAT (±0.01). Recomputed VAT per rate = invoiced VAT (±0.01 per rate). HT + VAT = TTC (±0.01).

## 5. Mandatory mentions (`engine/rules/mentions.ts`)

Severity `error` → `non_compliant`, only `warning` → `warning`, else `compliant`. Checks that do not apply are omitted (e.g. supplier SIREN for a German supplier).

| rule_id | Check | Applies to |
|---|---|---|
| FR-INV-NUMBER, FR-INV-DATE | number, issue date | all |
| FR-INV-SUPPLIER-NAME/-ADDRESS, FR-INV-CUSTOMER-NAME/-ADDRESS | parties | all |
| FR-INV-SUPPLIER-SIREN | valid SIREN (Luhn); legal basis `LB-INV-COMMERCIAL-IDENTIFICATION` | FR supplier |
| FR-INV-SUPPLIER-VATID | supplier VAT id (error if VAT charged or intra-EU, warning otherwise) | FR/EU supplier, not franchise |
| FR-INV-CUSTOMER-VATID | customer VAT id | intra-EU reverse charge |
| FR-INV-LINES-PRESENT, FR-INV-LINE-DESCRIPTION, FR-INV-LINE-QUANTITY, FR-INV-LINE-UNIT-PRICE | three distinct line mentions | all |
| FR-INV-VAT-RATE | rate ∈ {20, 10, 5.5, 2.1, 0}% | all |
| FR-INV-LINE-TOTALS, FR-INV-TOTAL-EXCL-VAT, FR-INV-VAT-AMOUNT, FR-INV-TOTAL-INCL-VAT | totals consistency | all |
| FR-INV-VAT-EXEMPTION-MENTION | exemption / franchise mention when no VAT | FR supplier, VAT = 0 |
| FR-INV-REVERSE-CHARGE-MENTION | "Autoliquidation" / "Reverse charge" | intra-EU reverse charge |
| FR-INV-CREDIT-NOTE-REFERENCE | original invoice number | credit notes |
| FR-INV-PAYMENT-DUE-DATE, FR-INV-LATE-PENALTIES, FR-INV-RECOVERY-INDEMNITY | commercial-code payment mentions (B2B) | FR supplier, invoices only (not credit notes) |
| FR-EINV-SIREN-BUYER | buyer SIREN | domestic B2B |
| FR-EINV-OPERATION-NATURE | goods / services / mixed declared and consistent with line kinds (derived "mixed" when lines have both kinds) | domestic B2B |
| FR-EINV-DELIVERY-ADDRESS | info only (cannot verify "different from billing address") | domestic, goods |
| FR-EINV-VAT-ON-DEBITS | info only (absence = no option) | domestic, services, VAT charged |

`FR-EINV-*` severity follows the issuer's e-invoicing timeline (ADR-019, optional `supplier.company_size`: `large` | `mid` | `sme` | `micro`):
- issued before 2026-09-01: `info`;
- issued from 2027-09-01, or from 2026-09-01 by a `large` / `mid` supplier: `error`;
- otherwise (SME / micro / size not declared, 2026-09-01 to 2027-08-31): `warning`, with a `fix_hint` explaining the timeline (reception mandatory for all since 1 Sept 2026; issuance mandatory for large and mid-size companies from 1 Sept 2026, SMEs and micro-businesses from 1 Sept 2027).

Fixture 02's supplier is declared `mid` (ETI), so it stays `non_compliant`.

Fix hints and anomaly details never cite article numbers: they point to the `legal_basis_id` only (Phase 1 review M1). `tests/engine.test.ts` checks every output (green fixtures, ~40 failing / mutated invoices, `checkInvoice`, bank, audit) and `tests/discovery.test.ts` checks llms.txt / openapi.json / catalog / agent card against `/\bart(icle)?\.?\s*\d|\bCGI\b|L\d{3}-\d+|BOI-/i`.

## 6. Anomalies, review and confidence

Every anomaly carries a stable `rule_id` (e.g. `TOTALS-CHECK`, `PCG-CLASSIFY`, `CUSTOMER-CHECK`, `VAT-FOREIGN`, `VAT-NON-EU`, `BNC-CASH-BASIS`, and for the audit `BALANCE-CHECK`, `SUSPENSE-ACCOUNT`, `JET-WEEKEND`, `JET-ROUND-AMOUNT`, `AUDIT-VAT-RATIO`, `AUDIT-VAT-ACCOUNT`, `AUDIT-REVERSE-CHARGE`, `COMPLIANCE-MENTIONS`, `VAT-DEDUCTIBILITY`).

Explanations call the entry **proposed** (not "booked") whenever human review is required: "not to be posted until the suspected duplicate is cleared" (duplicate), "proposed purchase view … to be recorded at the payment date" (cash-basis client), "pending review" otherwise.

Anomaly codes: `VAT_RATE_MISMATCH`, `VAT_RATE_INVALID`, `TOTALS_INCONSISTENT`, `SUPPLIER_TOTAL_MISMATCH`, `CLASSIFICATION_UNCERTAIN`, `DUPLICATE_SUSPECTED`, `CUSTOMER_MISMATCH`, `FOREIGN_VAT_CHARGED`, `NON_EU_SUPPLIER`, `GIFT_VAT_THRESHOLD` (warning/error); `FIXED_ASSET_CAPITALISED`, `VAT_NOT_DEDUCTIBLE`, `REVERSE_CHARGE_SELF_ASSESSED`, `CASH_BASIS_CLIENT` (info); bank: `UNMATCHED_TRANSACTION`, `PARTIAL_MATCH`.

`human_review_required` is true when `review_reasons` is non-empty. Possible reasons: `NON_COMPLIANT_INVOICE`, any warning/error anomaly code, `CASH_BASIS_CLIENT`, `LLM_EXTRACTION_LOW_CONFIDENCE` (LLM extraction confidence < 0.9), `UNBALANCED_ENTRY` (never expected).

Duplicates (`ctx.history`): same supplier key (SIREN, else VAT id, else normalised name) + same normalised number, **or** same supplier + same total incl. VAT + issue dates within 5 days. Documents of different types never match.

Confidence (deterministic): start 0.98; −0.04 per failed error check, −0.02 per failed warning check; −0.15 per error anomaly, −0.06 per warning anomaly; −0.15 per uncertain line; LLM extraction: min(score, extraction confidence) − 0.05; clamped to [0.05, 0.98].

## 7. Inputs and parsers (`engine/parsers/`)

| `format` | Parser | `extraction_method` |
|---|---|---|
| `json` | zod schema (`json.ts`). Credit notes may use negative amounts: they are normalised to positive. | `structured_json` |
| `facturx` | pdf-lib reads the `factur-x.xml` (or `zugferd-invoice.xml`, `xrechnung.xml`) attachment from the EmbeddedFiles name tree or the catalog `/AF` array; `cii.ts` maps CII (fast-xml-parser) | `facturx_cii` |
| `ubl` | `ubl.ts` (Invoice / CreditNote). A CII document sent as `ubl` is also accepted. | `ubl` (or `facturx_cii`) |
| `bank_transaction` | `bank.ts` match: amount = invoice TTC (+0.5), invoice number in label/reference (+0.4), counterparty ≈ supplier (+0.2); matched at ≥ 0.6. BQ entry 401xxx / 512 (money out) or 512 / 401xxx (refund); unmatched → 471 + review. | `bank_transaction` |
| `pdf` / `image` | A PDF is first tried as Factur-X. Otherwise it needs `ctx.llm` (else `LLM_UNAVAILABLE`). The LLM output is validated by the same zod schema and rules. | `llm` (+ `extraction_confidence`) |

CII/UBL mapping notes: operation category from BT-23 (CII `BusinessProcessSpecifiedDocumentContextParameter/ID`, UBL `ProfileID`): `B*` goods, `S*` services, `M*` mixed (French framework codes, open point 6). Notes with subject `PMD` → late-payment penalties, `PMT` → EUR 40 indemnity, others → `legal_mentions`. CII `DueDateTypeCode` 5 → VAT-on-debits option, 72 → no option (open point 6).

`fixtures/11.pdf` is generated by `npx tsx scripts/make-facturx.ts` (fixed dates, byte-reproducible): one visible page plus `factur-x.xml` with `AFRelationship /Alternative`. It is **not** a validated PDF/A-3 (no XMP Factur-X extension, no output intent). That is enough for parsing, but a real issuer would use a certified generator.

LLM adapter (`engine/llm/anthropic.ts`): `@anthropic-ai/sdk`, model `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`), structured JSON output (`output_config.format`), refusal handled. It is created only when `ANTHROPIC_API_KEY` is set. Tests use mock adapters (no network).

## 8. Errors

`EngineError.code` ∈ `INVALID_INPUT` (zod details `[{path, message}]`), `UNSUPPORTED_FORMAT`, `INVALID_PDF`, `FACTURX_XML_NOT_FOUND`, `INVALID_XML`, `LLM_UNAVAILABLE`, `LLM_OUTPUT_INVALID`, `BATCH_TOO_LARGE` (> 50), `EMPTY_BATCH`. `error.toJSON()` gives `{code, message, details?}`.

## 9. Audit (`engine/audit.ts`)

Items: `{ invoice }` (booked by the engine) or `{ entry }` (FEC-like, optional `supplier_key`, `invoice_number`, `total_incl_vat` for duplicates). Checks: duplicates across the batch (and `ctx.history`), unbalanced entries, suspense account 471, weekend dates, round amounts (≥ 1,000 and a multiple of 100), VAT ratio matching no French rate, 44566 used for fixed assets, 4452 ≠ deducted VAT, VAT deducted on excluded expenses (6251/6256).

**Materiality choice.** Statutory-auditor materiality is normally set on annual benchmarks (1–2% of revenue, ~5% of pre-tax profit…). A batch of 50 entries carries none of them, and "1% of the batch total" would give absurd thresholds (EUR 5 on a EUR 500 batch). So the engine uses a **fixed overall materiality of EUR 5,000** for a small SME, which can be overridden with `ctx.materiality_threshold`. It also uses a **performance materiality of 75%** (EUR 3,750) and a **clearly-trivial threshold of 5%** (EUR 250). Entries above performance materiality are findings (`high` above overall materiality). The size of an anomaly relative to "clearly trivial" drives the risk.

Viewpoints: `statutory_auditor` (existence/accuracy: duplicates, unbalanced, suspense, unmatched bank, non-compliant evidence, JET-style round/weekend, materiality) and `tax_inspector` (excess VAT from a wrong rate, deduction at risk on non-compliant invoices, double deduction from duplicates, VAT on excluded expenses, gifts, receptions, reverse-charge reporting, foreign VAT). `overall_risk` is the highest finding risk.

## 10. Fixture 9 — lawyer client (BNC, cash basis): reasoning

Team decision: the **lawyer is the client whose books we keep** (`activity: "bnc"`, `accounting_basis: "cash"`, standard VAT). She receives a fee invoice from a fellow lawyer (postulation fees, 800.00 + 20% VAT).
- Under BNC, profit is computed on a receipts-expenses basis: the expense is recognised when **paid**, in the receipts-expenses ledger (livre-journal), not when the invoice is received. The engine still proposes the purchase view (6226 Honoraires 800.00 / 44566 160.00 / 401VASQUELI 960.00), because an agent needs a structured result. It flags `human_review_required` with `CASH_BASIS_CLIENT` and explains that the entry is recorded at the payment date (the bank transaction, fixture-12 style, is then the recognition event).
- VAT: these are services and the supplier has not opted for VAT on debits, so the VAT is deductible when the invoice is paid (`vat.note`).
- 6226 is used because a fee for a mandate performed for the client firm is an operating expense. If the amount is a *rétrocession d'honoraires* or a *débours* re-billed to the end client, the 2035 presentation differs (see open point 5).

## 11. Fixtures

| # | Scenario | Key result |
|---|---|---|
| 01 | Office supplies 20% | 6064 140.00 / 44566 28.00 / 401BURO 168.00, compliant |
| 02 | #1 without buyer SIREN, supplier declared `mid` (ETI) | non_compliant (FR-EINV-SIREN-BUYER), review |
| 03 | Restaurant at 20% instead of 10% | 6257 160.60 (146.00 + 14.60 excess VAT) / 44566 14.60 / 401BOUCHON 175.20, VAT_RATE_MISMATCH (excess 13.60 + 1.00), review, `LB-VAT-DEDUCTION-LEGALLY-DUE` (ADR-018) |
| 04 | German consulting services, reverse charge | 6226 2200.00 / 44566 440.00 / 4452 (440.00) / 401KRANICH (2200.00) |
| 05 | Exempt training | 6228 1200.00 / 401FORMACOM (1200.00), regime exempt |
| 06 | Duplicate of #1 (history) | DUPLICATE_SUSPECTED, review |
| 07 | Partial credit note on #1 | 401BURO 54.00 / 6064 (45.00) / 44566 (9.00) |
| 08 | Laptop 1,450 + mouse 29 | 2183 1450.00 / 6063 29.00 / 44562 290.00 / 44566 5.80 / 401NUMERIA (1774.80) |
| 09 | Lawyer client, colleague's fees | proposed: 6226 800.00 / 44566 160.00 / 401VASQUELI (960.00), CASH_BASIS_CLIENT review |
| 10 | Mixed goods + services | 6064 190.00 / 6156 210.00 / 44566 80.00 / 401COPILAB (480.00), nature mixed |
| 11 | Factur-X PDF of #1 | identical to #1, `facturx_cii` |
| 12 | Bank payment of #1 | BQ 401BURO 168.00 / 512 (168.00), match score 1 |
| 13 | UBL 2.1 of #10 (bonus) | identical to #10, `ubl` |

Expected outputs: `fixtures/expected/NN.expected.json`. Tests: `tests/fixtures.test.ts` (each fixture + determinism) and `tests/engine.test.ts` (money/balance, mentions, classification, VAT deductibility, duplicates, parsers/errors, LLM mocks, bank, audit, legal bases).

## 12. CLI

```bash
npm run engine -- fixtures/03.json                   # EntryResult
npm run engine -- fixtures/02.json --check           # CheckResult
npm run engine -- --audit fixtures/01.json fixtures/03.json fixtures/06.json
npm run engine -- fixtures/11.pdf                    # Factur-X PDF
npm run engine -- fixtures/13.ubl.xml                # UBL (or CII) XML
npx tsx scripts/make-facturx.ts                      # regenerate fixtures/11.pdf
```
A fixture's `context` (profile, history) is applied. `--no-llm` disables the LLM even when `ANTHROPIC_API_KEY` is set. Engine errors are printed as `{"error": {code, message, details}}` with exit code 2.

## 13. Open points for Ary

1. **Reform mentions: start date.** Implemented per issuer size (ADR-019): `error` from 2026-09-01 for large/mid issuers and from 2027-09-01 for all, `warning` in between for SME/micro or undeclared size. Please confirm this reading against the decree and the DGFiP FAQ (see `docs/LEGAL_REVIEW.md`, open questions).
2. ~~**Wrong-rate restaurant invoice (fixture 03).**~~ **Closed (Phase 1 review B1, ADR-018):** the engine deducts only the VAT legally due (44566 14.60), adds the 14.60 excess to 6257 (160.60), still credits the supplier with 175.20 and keeps the `VAT_RATE_MISMATCH` flag and the review.
3. **Training account.** 6228 vs 6185 / 618x for external training: confirm the firm's preferred account.
4. **VAT on services not yet paid.** Accrual entries use 44566 directly. Some firms use a "TVA déductible en attente" sub-account (e.g. 44568x) until payment. Should a sub-account be added for services from suppliers taxed on receipts?
5. **Fixture 09 (BNC).** Confirm the treatment of fees invoiced by a fellow lawyer: operating expense (6226 / 2035 "honoraires") vs *rétrocession* deducted from receipts, or *débours*. Also confirm that proposing an accrual-style entry with review is the right output for a cash-basis client, rather than waiting for the payment.
6. **Factur-X / UBL codes.** BT-23 framework codes (B1/S1/M1) for the operation category, and CII `DueDateTypeCode` 5/72 for the VAT-on-debits option: to verify against the final French external specifications.
7. **Credit notes.** Returns and cancellations credit the original expense account (6064). Should commercial discounts (rabais/remises) go to 609x instead? The engine cannot tell them apart today.
8. **Gifts.** The EUR 73 threshold is applied per unit, not per beneficiary per year (the engine cannot know the beneficiary).
9. **SaaS.** 6511 (sub-account of 651, new PCG label) vs 6135 / 6156: confirm. Web hosting → 6156.
10. **Self-assessment rate (reverse charge).** The engine uses the category's French rate (20% by default). Reduced-rate services from EU suppliers would need a hint.
11. **Materiality.** Fixed EUR 5,000 (override per call). Confirm the default for the demo SME.
12. Every legal reference is listed in `docs/LEGAL_REVIEW.md`. None is exposed until `reviewed_by` is filled.
