# Legal-basis review checklist (for Ary)

Source of truth: `engine/rules/legal-basis.ts`. Each entry has `id`, `label`, `reference`, `to_verify` and `reviewed_by`.

**Exposure rule.** The API and the MCP tools only return the stable `legal_basis_id` (e.g. `LB-INV-MENTIONS`). The `reference` (article number) is returned (through `publicLegalBasis()`) **only after `reviewed_by` is filled in**. Today every entry is unreviewed, so no article number reaches an agent. Fix hints, anomaly details and explanations never cite an article number either: they point to the `legal_basis_id` only. Unit tests (`tests/engine.test.ts > no unreviewed legal reference reaches an agent`, `tests/discovery.test.ts`) check every engine output — green fixtures and ~40 failing / mutated invoices, `checkInvoice`, bank and audit — and the discovery documents (llms.txt, openapi.json, catalog, agent card) against `/\bart(icle)?\.?\s*\d|\bCGI\b|L\d{3}-\d+|BOI-/i`.

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
| ☐ | `LB-VAT-DEDUCTION-LEGALLY-DUE` | Only the VAT legally due on the transaction is deductible; VAT invoiced in excess (wrong rate) is not | CGI art. 271 (limit: case law / BOFiP) | **TO VERIFY** (references) | `vat.legal_basis_id` when excess VAT is charged to the expense (fixture 03, ADR-018) |
| ☐ | `LB-INV-COMMERCIAL-IDENTIFICATION` | Supplier identification (SIREN / RCS) on invoices and commercial documents | C. com. art. R123-237 | **TO VERIFY** | `FR-INV-SUPPLIER-SIREN` |
| ☐ | `LB-VAT-REVERSE-CHARGE-SERVICES` | Reverse charge on B2B services from a non-established supplier | CGI art. 283-2 (place of supply: art. 259) | to review | fixture 04, `FR-INV-REVERSE-CHARGE-MENTION`, regime `reverse_charge_non_eu` |
| ☐ | `LB-VAT-ICA-GOODS` | Intra-community acquisition of goods | CGI art. 256 bis | to review | intra-EU goods |
| ☐ | `LB-VAT-EXEMPT-TRAINING` | VAT exemption for vocational training | CGI art. 261-4-4° a | to review | fixture 05 |
| ☐ | `LB-VAT-FRANCHISE` | VAT franchise (no VAT invoiced) | CGI art. 293 B | to review | supplier under franchise |
| ☐ | `LB-VAT-DEDUCTION-RIGHT` | Right to deduct input VAT | CGI art. 271 | to review | mixed-rate invoices |
| ☐ | `LB-VAT-DEDUCTION-INVOICE` | Deduction requires a compliant invoice | CGI art. 271 II-1-a and ann. II art. 230 | **TO VERIFY** | tax-inspector finding `VAT_DEDUCTION_AT_RISK` |
| ☐ | `LB-VAT-DEDUCTION-EXCLUSIONS` | Exclusions: passenger vehicles, staff accommodation, passenger transport, gifts above threshold | CGI ann. II art. 206 IV-2 (sub-items 1° to 6°) | **TO VERIFY** (sub-items) | categories `travel`, `missions`, `vehicle_rental` |
| ☐ | `LB-VAT-GIFTS-THRESHOLD` | Gifts: VAT deductible up to EUR 73 incl. VAT per beneficiary per year | CGI ann. IV art. 28-00 A | **TO VERIFY** | category `gifts` |
| ☐ | `LB-VAT-SERVICES-EXIGIBILITY` | VAT on services chargeable on payment unless VAT-on-debits option | CGI art. 269-2-c | to review | `vat.note` on services |
| ☐ | `LB-VAT-CREDIT-NOTE` | VAT adjustment on credit notes | CGI art. 272-1 | **TO VERIFY** | `FR-INV-CREDIT-NOTE-REFERENCE` |
| ☐ | `LB-ASSET-LOW-VALUE` | Low-value assets (unit value not exceeding EUR 500 excl. VAT) may be expensed | BOI-BIC-CHG-20-30-10 | **TO VERIFY** (paragraph) | `ASSET-THRESHOLD-500` |
| ☐ | `LB-PCG` | Plan comptable général | ANC Regulation 2014-03 as amended by ANC 2022-06 | to review | all account mappings |
| ☐ | `LB-BNC-CASH-BASIS` | BNC on a receipts-expenses basis | CGI art. 93 (bookkeeping: art. 99) | **TO VERIFY** (art. 99) | fixture 09, `CASH_BASIS_CLIENT` |

Rule ids without a legal basis (internal controls, no article cited): `DUPLICATE-CHECK`, `BALANCE-CHECK`, `TOTALS-CHECK`, `PCG-CLASSIFY`, `CUSTOMER-CHECK`, `VAT-EXPECTED-RATE`, `VAT-DEDUCT-LEGALLY-DUE`, `VAT-FOREIGN`, `VAT-NON-EU`, `BQ-MATCH-INVOICE`, audit checks (`SUSPENSE-ACCOUNT`, `JET-ROUND-AMOUNT`, `JET-WEEKEND`, `AUDIT-VAT-RATIO`, `AUDIT-VAT-ACCOUNT`, `AUDIT-REVERSE-CHARGE`, `COMPLIANCE-MENTIONS`, materiality).

## Open questions for Ary

1. **Reform mentions timeline (ADR-019).** The engine treats the new mentions (buyer SIREN, operation category, delivery address, VAT-on-debits option) as mandatory from **1 Sept 2026 for large and mid-size issuers (GE/ETI)** and from **1 Sept 2027 for SMEs and micro-businesses**; in between, an SME issuer's missing mention is a `warning`, not an `error`. Reception is treated as mandatory for everyone from 1 Sept 2026. Please confirm against the decree and the DGFiP FAQ: (a) are the new mentions tied to the issuer's issuance obligation, or mandatory on every B2B invoice from 1 Sept 2026? (b) is the size category the right trigger (and how is it assessed — the issuer's category at which date)? Then fill `reviewed_by` on `LB-EINV-REFORM-MENTIONS`.
2. **Excess VAT at a wrong rate (ADR-018).** Confirm that charging the non-deductible excess to the expense account (fixture 03: 6257 160.60 / 44566 14.60 / 401 175.20) is the treatment you want, and give the reference for `LB-VAT-DEDUCTION-LEGALLY-DUE`.
3. **Non-EU services (`reverse_charge_non_eu`).** The engine proposes no self-assessed VAT lines for services bought from outside the EU (4452 is intra-EU). Which accounts does the firm use for self-assessed VAT on extra-EU services (e.g. a 4457x / 4452x sub-account and 44566)?
4. **Supplier SIREN basis.** Confirm the commercial-code reference for the supplier SIREN / RCS mention (`LB-INV-COMMERCIAL-IDENTIFICATION`).
