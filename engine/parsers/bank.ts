/**
 * Bank transaction matching against candidate invoices.
 * Score (capped at 1): amount equal to the invoice total incl. VAT (+0.5),
 * invoice number found in label/reference (+0.4), counterparty matches the
 * supplier name (+0.2). Matched when score >= 0.6.
 */
import type { BankTransactionInput, InvoiceInput } from "../types";
import { toCents } from "../money";
import { alnumKey, tokens } from "../text";

export const MATCH_THRESHOLD = 0.6;

export interface BankMatch {
  invoice: InvoiceInput | null;
  score: number;
  detail: string;
}

const STOP = new Set(["sarl", "sas", "sasu", "sa", "eurl", "gmbh", "fictional", "the", "de", "la", "le", "les", "et", "vir", "sepa", "prlv", "cb", "fact", "facture"]);

function nameOverlap(a: string, b: string): number {
  const ta = new Set(tokens(a).filter((t) => t.length > 2 && !STOP.has(t)));
  const tb = new Set(tokens(b).filter((t) => t.length > 2 && !STOP.has(t)));
  if (ta.size === 0 || tb.size === 0) return 0;
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  return common / Math.min(ta.size, tb.size);
}

export function matchTransaction(tx: BankTransactionInput, candidates: InvoiceInput[] = []): BankMatch {
  let best: { inv: InvoiceInput; score: number; reasons: string[] } | null = null;
  const haystack = alnumKey(`${tx.label} ${tx.reference ?? ""}`);
  for (const inv of candidates) {
    const reasons: string[] = [];
    let score = 0;
    const sign = inv.document_type === "credit_note" ? 1 : -1; // payment of an invoice = money out
    if (toCents(tx.amount) === sign * toCents(Math.abs(inv.totals.total_incl_vat))) {
      score += 0.5;
      reasons.push("amount equals the invoice total incl. VAT");
    } else if (Math.abs(toCents(tx.amount)) === toCents(Math.abs(inv.totals.total_incl_vat))) {
      score += 0.3;
      reasons.push("absolute amount equals the invoice total (unexpected direction)");
    }
    const num = alnumKey(inv.number);
    if (num.length >= 3 && haystack.includes(num)) {
      score += 0.4;
      reasons.push(`invoice number ${inv.number} found in the label/reference`);
    }
    const cp = `${tx.counterparty ?? ""} ${tx.label}`;
    if (nameOverlap(cp, inv.supplier.name) >= 0.5) {
      score += 0.2;
      reasons.push("counterparty matches the supplier name");
    }
    score = Math.min(1, Math.round(score * 100) / 100);
    if (!best || score > best.score) best = { inv, score, reasons };
  }
  if (!best || best.score < MATCH_THRESHOLD) {
    return {
      invoice: null,
      score: best?.score ?? 0,
      detail: candidates.length === 0 ? "No candidate invoice provided." : `No candidate invoice reached the matching threshold (${MATCH_THRESHOLD}).`,
    };
  }
  return { invoice: best.inv, score: best.score, detail: `Matched invoice ${best.inv.number}: ${best.reasons.join("; ")}.` };
}
