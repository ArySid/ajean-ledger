/**
 * Duplicate detection (stateless): the caller passes previously processed
 * invoices as fingerprints in ctx.history.
 *  - same supplier_key + same normalised number -> duplicate
 *  - same supplier_key + same total incl. VAT + issue dates within 5 days -> duplicate
 * Documents of different types (invoice vs credit note) never match each other.
 */
import type { InvoiceFingerprint, InvoiceInput } from "../types";
import { alnumKey, daysBetween } from "../text";
import { round2, toCents } from "../money";

export const DUPLICATE_WINDOW_DAYS = 5;

export function supplierKey(p: { siren?: string; vat_id?: string; name: string }): string {
  if (p.siren && /^\d{9}$/.test(p.siren)) return `SIREN:${p.siren}`;
  if (p.vat_id && p.vat_id.trim()) return `VAT:${alnumKey(p.vat_id)}`;
  return `NAME:${alnumKey(p.name.replace(/\([^)]*\)/g, " "))}`;
}

export function fingerprint(inv: InvoiceInput): InvoiceFingerprint {
  return {
    supplier_key: supplierKey(inv.supplier),
    number: inv.number,
    issue_date: inv.issue_date,
    total_incl_vat: round2(Math.abs(inv.totals.total_incl_vat)),
    document_type: inv.document_type,
  };
}

export interface DuplicateMatch {
  reason: "same_number" | "same_amount_close_date";
  other: InvoiceFingerprint;
}

export function compareFingerprints(a: InvoiceFingerprint, b: InvoiceFingerprint): DuplicateMatch | null {
  if (a.supplier_key !== b.supplier_key) return null;
  if ((a.document_type ?? "invoice") !== (b.document_type ?? "invoice")) return null;
  if (alnumKey(a.number) !== "" && alnumKey(a.number) === alnumKey(b.number)) return { reason: "same_number", other: b };
  if (
    toCents(Math.abs(a.total_incl_vat)) === toCents(Math.abs(b.total_incl_vat)) &&
    /^\d{4}-\d{2}-\d{2}$/.test(a.issue_date) && /^\d{4}-\d{2}-\d{2}$/.test(b.issue_date) &&
    daysBetween(a.issue_date, b.issue_date) <= DUPLICATE_WINDOW_DAYS
  ) {
    return { reason: "same_amount_close_date", other: b };
  }
  return null;
}

export function findDuplicates(fp: InvoiceFingerprint, history: InvoiceFingerprint[] = []): DuplicateMatch[] {
  const out: DuplicateMatch[] = [];
  for (const h of history) {
    const m = compareFingerprints(fp, h);
    if (m) out.push(m);
  }
  return out;
}
