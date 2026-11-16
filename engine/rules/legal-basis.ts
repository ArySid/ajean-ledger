/**
 * Curated legal-basis table.
 *
 * RULES (master prompt §5.4, ADR-008):
 * - The API never exposes `reference` while `reviewed_by` is empty: agents only
 *   receive the stable `legal_basis_id`. Use `publicLegalBasis()` for output.
 * - References marked "TO VERIFY" are plausible but not certain: they must be
 *   checked by a qualified reviewer (Ary) before `reviewed_by` is filled.
 * - Never add an article number here without being sure of it, or without the
 *   "TO VERIFY" marker. The checklist lives in docs/LEGAL_REVIEW.md.
 */

export interface LegalBasis {
  id: string;
  label: string;
  /** Legal reference (article, BOFiP...). Internal until reviewed. */
  reference: string;
  /** true when the author was not certain of the exact reference. */
  to_verify: boolean;
  /** Name/initials of the reviewer who validated the reference. Empty = not reviewed. */
  reviewed_by: string;
}

export const LEGAL_BASES: readonly LegalBasis[] = [
  { id: "LB-INV-OBLIGATION", label: "Obligation to issue an invoice for B2B supplies (VAT)", reference: "CGI art. 289", to_verify: false, reviewed_by: "" },
  { id: "LB-INV-MENTIONS", label: "Mandatory invoice mentions (VAT)", reference: "CGI annexe II, art. 242 nonies A", to_verify: false, reviewed_by: "" },
  { id: "LB-EINV-REFORM-MENTIONS", label: "E-invoicing reform: new mentions (buyer SIREN, delivery address, operation category, VAT-on-debits option)", reference: "CGI art. 289 bis and CGI annexe II art. 242 nonies A as amended (loi de finances 2024 art. 91 and implementing decree) — TO VERIFY exact provisions and entry-into-force date per issuer size", to_verify: true, reviewed_by: "" },
  { id: "LB-COM-INVOICE-MENTIONS", label: "Commercial invoice mentions (payment date, payment terms)", reference: "Code de commerce art. L441-9", to_verify: false, reviewed_by: "" },
  { id: "LB-COM-LATE-PENALTIES", label: "Late-payment penalties and EUR 40 fixed recovery indemnity (B2B)", reference: "Code de commerce art. L441-10 (amount of EUR 40: art. D441-5)", to_verify: false, reviewed_by: "" },
  { id: "LB-VAT-RATE-STANDARD", label: "Standard VAT rate 20%", reference: "CGI art. 278", to_verify: false, reviewed_by: "" },
  { id: "LB-VAT-RATE-10", label: "Intermediate VAT rate 10% (incl. food for on-site consumption / restaurants, passenger transport)", reference: "CGI art. 279 (letter for restaurants: 279 m — TO VERIFY)", to_verify: true, reviewed_by: "" },
  { id: "LB-VAT-RATE-5-5", label: "Reduced VAT rate 5.5%", reference: "CGI art. 278-0 bis", to_verify: false, reviewed_by: "" },
  { id: "LB-VAT-RATE-2-1", label: "Super-reduced VAT rate 2.1% (press, certain medicines)", reference: "CGI art. 281 quater to 281 sexies and art. 298 septies — TO VERIFY", to_verify: true, reviewed_by: "" },
  { id: "LB-VAT-INVOICED-VAT-DUE", label: "VAT shown on an invoice is due by the issuer; the buyer may only deduct the VAT legally due", reference: "CGI art. 283-3 (deduction limit: case law — TO VERIFY reference)", to_verify: true, reviewed_by: "" },
  { id: "LB-VAT-DEDUCTION-LEGALLY-DUE", label: "Only the VAT legally due on the transaction is deductible; VAT invoiced in excess (e.g. at a wrong rate) is not deductible by the buyer", reference: "CGI art. 271 (deduction limited to the VAT legally due: case law and BOFiP — TO VERIFY references)", to_verify: true, reviewed_by: "" },
  { id: "LB-INV-COMMERCIAL-IDENTIFICATION", label: "Supplier identification on invoices and commercial documents (SIREN / RCS)", reference: "Code de commerce art. R123-237 — TO VERIFY", to_verify: true, reviewed_by: "" },
  { id: "LB-VAT-REVERSE-CHARGE-SERVICES", label: "Reverse charge on B2B services supplied by a non-established supplier", reference: "CGI art. 283-2 (place of supply: CGI art. 259)", to_verify: false, reviewed_by: "" },
  { id: "LB-VAT-ICA-GOODS", label: "Intra-community acquisition of goods (VAT self-assessed by the buyer)", reference: "CGI art. 256 bis", to_verify: false, reviewed_by: "" },
  { id: "LB-VAT-EXEMPT-TRAINING", label: "VAT exemption for vocational training", reference: "CGI art. 261-4-4° a", to_verify: false, reviewed_by: "" },
  { id: "LB-VAT-FRANCHISE", label: "VAT franchise for small businesses (no VAT invoiced)", reference: "CGI art. 293 B", to_verify: false, reviewed_by: "" },
  { id: "LB-VAT-DEDUCTION-RIGHT", label: "Right to deduct input VAT", reference: "CGI art. 271", to_verify: false, reviewed_by: "" },
  { id: "LB-VAT-DEDUCTION-INVOICE", label: "Input VAT deduction requires a compliant invoice", reference: "CGI art. 271 II-1-a and CGI annexe II art. 230 — TO VERIFY", to_verify: true, reviewed_by: "" },
  { id: "LB-VAT-DEDUCTION-EXCLUSIONS", label: "Exclusions from the right to deduct (passenger vehicles, staff accommodation, passenger transport, gifts above threshold)", reference: "CGI annexe II art. 206 IV-2 (sub-items 1° to 6° — TO VERIFY)", to_verify: true, reviewed_by: "" },
  { id: "LB-VAT-GIFTS-THRESHOLD", label: "Gifts of low value: VAT deductible up to EUR 73 incl. VAT per beneficiary per year", reference: "CGI annexe IV art. 28-00 A — TO VERIFY", to_verify: true, reviewed_by: "" },
  { id: "LB-VAT-SERVICES-EXIGIBILITY", label: "VAT on services becomes chargeable on payment unless the supplier opted for VAT on debits", reference: "CGI art. 269-2-c", to_verify: false, reviewed_by: "" },
  { id: "LB-VAT-CREDIT-NOTE", label: "VAT adjustment on cancelled or reduced transactions (credit notes)", reference: "CGI art. 272-1 — TO VERIFY", to_verify: true, reviewed_by: "" },
  { id: "LB-ASSET-LOW-VALUE", label: "Administrative tolerance: low-value assets (unit value not exceeding EUR 500 excl. VAT) may be expensed", reference: "BOI-BIC-CHG-20-30-10 (paragraph — TO VERIFY)", to_verify: true, reviewed_by: "" },
  { id: "LB-PCG", label: "French chart of accounts (Plan comptable général)", reference: "ANC Regulation No. 2014-03 as amended by ANC Regulation No. 2022-06", to_verify: false, reviewed_by: "" },
  { id: "LB-BNC-CASH-BASIS", label: "BNC profits computed on a receipts-expenses (cash) basis; receipts-expenses ledger", reference: "CGI art. 93 (bookkeeping: CGI art. 99 — TO VERIFY)", to_verify: true, reviewed_by: "" },
];

const BY_ID = new Map(LEGAL_BASES.map((b) => [b.id, b]));

export function getLegalBasis(id: string): LegalBasis | undefined {
  return BY_ID.get(id);
}

/** What may be shown to an agent: the reference only once reviewed. */
export function publicLegalBasis(id: string): { legal_basis_id: string; label?: string; reference?: string } {
  const b = BY_ID.get(id);
  if (!b) return { legal_basis_id: id };
  return b.reviewed_by.trim().length > 0
    ? { legal_basis_id: b.id, label: b.label, reference: b.reference }
    : { legal_basis_id: b.id, label: b.label };
}
