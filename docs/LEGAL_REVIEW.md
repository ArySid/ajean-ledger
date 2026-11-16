# Legal-basis review checklist (for Ary)

Source of truth: `engine/rules/legal-basis.ts`. Each entry has `id`, `label`, `reference`, `to_verify` and `reviewed_by`.

**Exposure rule.** The API and the MCP tools only return the stable `legal_basis_id` (e.g. `LB-INV-MENTIONS`). The `reference` (article number) is returned (through `publicLegalBasis()`) **only after `reviewed_by` is filled in**. Today every entry is unreviewed, so no article number reaches an agent. A unit test (`tests/engine.test.ts > legal bases`) checks that no reference leaks into results.

**How to review.** For each row: check the reference against Légifrance / BOFiP, correct it if needed, and put your initials and the date in `reviewed_by` (e.g. `"AS 2026-11-20"`). Entries marked **TO VERIFY** are ones where the author was not certain of the exact article, paragraph or sub-item. They must be checked before they are signed off.

| ☐ | id | What it covers | Reference (draft) | Status | Used by |
|---|---|---|---|---|---|
| ☐ | `LB-INV-OBLIGATION` | Obligation to issue an invoice for B2B supplies | CGI art. 289 | to review | — (context) |
| ☐ | `LB-INV-MENTIONS` | Mandatory invoice mentions (VAT) | CGI annexe II, art. 242 nonies A | to review | all `FR-INV-*` checks |
| ☐ | `LB-EINV-REFORM-MENTIONS` | New reform mentions: buyer SIREN, delivery address, operation category, VAT-on-debits option | CGI art. 289 bis + ann. II art. 242 nonies A as amended (LF 2024 art. 91 + decree) | **TO VERIFY** (exact provisions and entry-into-force date per issuer size) | `FR-EINV-*` checks |
| ☐ | `LB-COM-INVOICE-MENTIONS` | Commercial mentions (payment date, payment terms) | C. com. art. L441-9 | to review | `FR-INV-PAYMENT-DUE-DATE` |
| ☐ | `LB-COM-LATE-PENALTIES` | Late-payment penalties + EUR 40 recovery indemnity (B2B) | C. com. art. L441-10 (amount: art. D441-5) | to review | `FR-INV-LATE-PENALTIES`, `FR-INV-RECOVERY-INDEMNITY` |
| ☐ | `LB-VAT-RATE-STANDARD` | 20% rate | CGI art. 278 | to review | `vat.legal_basis_id` (standard) |
| ☐ | `LB-VAT-RATE-10` | 10% rate (restaurants / on-site food, passenger transport) | CGI art. 279 (letter m for restaurants) | **TO VERIFY** (letter) | `vat.legal_basis_id` (reduced 10%) |
| ☐ | `LB-VAT-RATE-5-5` | 5.5% rate | CGI art. 278-0 bis | to review | reduced 5.5% |
| ☐ | `LB-VAT-RATE-2-1` | 2.1% rate (press, some medicines) | CGI art. 281 quater to 281 sexies, art. 298 septies | **TO VERIFY** | reduced 2.1% |
| ☐ | `LB-VAT-INVOICED-VAT-DUE` | VAT shown on an invoice is due by the issuer; buyer deducts only the VAT legally due | CGI art. 283-3 (deduction limit from case law) | **TO VERIFY** (case-law reference) | rationale for `VAT_RATE_MISMATCH` |
| ☐ | `LB-VAT-REVERSE-CHARGE-SERVICES` | Reverse charge on B2B services from a non-established supplier | CGI art. 283-2 (place of supply: art. 259) | to review | fixture 04, `FR-INV-REVERSE-CHARGE-MENTION` |
| ☐ | `LB-VAT-ICA-GOODS` | Intra-community acquisition of goods | CGI art. 256 bis | to review | intra-EU goods |
| ☐ | `LB-VAT-EXEMPT-TRAINING` | VAT exemption for vocational training | CGI art. 261-4-4° a | to review | fixture 05 |
| ☐ | `LB-VAT-FRANCHISE` | VAT franchise (no VAT invoiced) | CGI art. 293 B | to review | supplier under franchise |
| ☐ | `LB-VAT-DEDUCTION-RIGHT` | Right to deduct input VAT | CGI art. 271 | to review | mixed-rate invoices |
| ☐ | `LB-VAT-DEDUCTION-INVOICE` | Deduction requires a compliant invoice | CGI art. 271 II-1-a and ann. II art. 230 | **TO VERIFY** | tax-inspector finding `VAT_DEDUCTION_AT_RISK` |
| ☐ | `LB-VAT-DEDUCTION-EXCLUSIONS` | Exclusions: passenger vehicles, staff accommodation, passenger transport, gifts above threshold | CGI ann. II art. 206 IV-2 (sub-items 1° to 6°) | **TO VERIFY** (sub-items) | categories `travel`, `missions`, `vehicle_rental` |
| ☐ | `LB-VAT-GIFTS-THRESHOLD` | Gifts: VAT deductible up to EUR 73 incl. VAT per beneficiary per year | CGI ann. IV art. 28-00 A | **TO VERIFY** | category `gifts` |
| ☐ | `LB-VAT-SERVICES-EXIGIBILITY` | VAT on services chargeable on payment unless VAT-on-debits option | CGI art. 269-2-c | to review | `vat.note` on services |
| ☐ | `LB-VAT-CREDIT-NOTE` | VAT adjustment on credit notes | CGI art. 272-1 | **TO VERIFY** | `FR-INV-CREDIT-NOTE-REFERENCE` |
| ☐ | `LB-ASSET-LOW-VALUE` | Low-value assets (< EUR 500 excl. VAT) may be expensed | BOI-BIC-CHG-20-30-10 | **TO VERIFY** (paragraph) | `ASSET-THRESHOLD-500` |
| ☐ | `LB-PCG` | Plan comptable général | ANC Regulation 2014-03 as amended by ANC 2022-06 | to review | all account mappings |
| ☐ | `LB-BNC-CASH-BASIS` | BNC on a receipts-expenses basis | CGI art. 93 (bookkeeping: art. 99) | **TO VERIFY** (art. 99) | fixture 09, `CASH_BASIS_CLIENT` |

Rule ids without a legal basis (internal controls, no article cited): `DUPLICATE-CHECK`, `BALANCE-CHECK`, `VAT-EXPECTED-RATE`, `BQ-MATCH-INVOICE`, audit checks (`SUSPENSE_ACCOUNT_USED`, `ROUND_AMOUNT`, `WEEKEND_DATE`, materiality).
