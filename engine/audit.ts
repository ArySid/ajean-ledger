/**
 * Batch audit (POST /api/v1/audit): up to 50 items (invoices to book, or
 * already-booked entries). Detects duplicates across the batch, VAT
 * inconsistencies, unbalanced entries, suspicious accounts and patterns, and
 * builds two structured viewpoints: statutory auditor and tax inspector.
 *
 * Materiality: a batch carries no annual benchmark (revenue, profit, equity),
 * so the statutory-auditor viewpoint uses a fixed overall materiality of
 * EUR 5,000 (overridable with ctx.materiality_threshold), a performance
 * materiality of 75% and a "clearly trivial" threshold of 5%. See docs/ENGINE.md.
 */
import type { Anomaly, AuditEntryInput, AuditResult, EngineContext, EntryResult, ExpertViewpoint, InvoiceFingerprint, JournalEntry } from "./types";
import { DISCLAIMER } from "./types";
import { EngineError } from "./errors";
import { ENGINE_VERSION, entryFromInvoice } from "./core";
import { validateInvoice } from "./parsers/json";
import { compareFingerprints, fingerprint } from "./rules/duplicates";
import { fromCents, toCents } from "./money";
import { dayOfWeek } from "./text";

export const MAX_AUDIT_ITEMS = 50;
export const DEFAULT_MATERIALITY = 5000;
export const PERFORMANCE_MATERIALITY_RATIO = 0.75;
export const CLEARLY_TRIVIAL_RATIO = 0.05;

type Risk = "low" | "medium" | "high";
type Finding = ExpertViewpoint["findings"][number];

interface AuditedItem {
  ref: string;
  entry: JournalEntry;
  result?: EntryResult;
  fp?: InvoiceFingerprint;
  amountCents: number; // gross amount of the entry (sum of debits)
}

const RISK_ORDER: Record<Risk, number> = { low: 0, medium: 1, high: 2 };
const maxRisk = (rs: Risk[]): Risk => rs.reduce<Risk>((a, r) => (RISK_ORDER[r] > RISK_ORDER[a] ? r : a), "low");

const NON_DEDUCTIBLE_PREFIXES = ["6251", "6256"]; // passenger transport, staff accommodation
const VALID_RATES = [0.2, 0.1, 0.055, 0.021];

function sumDebits(e: JournalEntry): number {
  return e.lines.reduce((a, l) => a + toCents(l.debit), 0);
}

export async function auditEntries(items: AuditEntryInput[], ctx: EngineContext = {}): Promise<AuditResult> {
  if (!Array.isArray(items)) throw new EngineError("INVALID_INPUT", "items must be an array.", [{ path: "items", message: "expected array" }]);
  if (items.length === 0) throw new EngineError("EMPTY_BATCH", "The audit batch is empty.");
  if (items.length > MAX_AUDIT_ITEMS) {
    throw new EngineError("BATCH_TOO_LARGE", `An audit batch holds at most ${MAX_AUDIT_ITEMS} items (got ${items.length}).`, { max: MAX_AUDIT_ITEMS, received: items.length });
  }
  const materiality = ctx.materiality_threshold && ctx.materiality_threshold > 0 ? ctx.materiality_threshold : DEFAULT_MATERIALITY;
  const performance = Math.round(materiality * PERFORMANCE_MATERIALITY_RATIO * 100) / 100;
  const trivial = Math.round(materiality * CLEARLY_TRIVIAL_RATIO * 100) / 100;

  // 1. Book / normalise every item ---------------------------------------------
  const audited: AuditedItem[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it?.invoice) {
      const inv = validateInvoice(it.invoice, `items.${i}.invoice`);
      const result = await entryFromInvoice(inv, ctx);
      audited.push({ ref: `${i + 1}:${inv.number}`, entry: result.entry, result, fp: fingerprint(inv), amountCents: sumDebits(result.entry) });
    } else if (it?.entry && Array.isArray(it.entry.lines)) {
      const e = it.entry;
      const fp: InvoiceFingerprint | undefined =
        e.supplier_key && (e.invoice_number || e.total_incl_vat !== undefined)
          ? { supplier_key: e.supplier_key, number: e.invoice_number ?? "", issue_date: e.date, total_incl_vat: e.total_incl_vat ?? 0 }
          : undefined;
      audited.push({ ref: `${i + 1}:${e.reference || "entry"}`, entry: e, fp, amountCents: sumDebits(e) });
    } else {
      throw new EngineError("INVALID_INPUT", `Item ${i + 1} must contain either "invoice" or "entry".`, [{ path: `items.${i}`, message: "invoice or entry required" }]);
    }
  }

  const anomalies: (Anomaly & { entry_ref: string })[] = [];
  const sa: Finding[] = [];
  const ti: Finding[] = [];

  // 2. Per-item anomalies propagated from the engine ----------------------------
  for (const a of audited) {
    for (const an of a.result?.anomalies ?? []) {
      if (an.severity === "info" && an.code !== "VAT_NOT_DEDUCTIBLE") continue;
      anomalies.push({ ...an, entry_ref: a.ref });
    }
    if (a.result && a.result.compliance.status === "non_compliant") {
      const failed = a.result.compliance.checks.filter((c) => !c.passed && c.severity === "error").map((c) => c.rule_id);
      anomalies.push({ code: "NON_COMPLIANT_INVOICE", severity: "warning", rule_id: "COMPLIANCE-MENTIONS", entry_ref: a.ref, detail: `Missing or incorrect mandatory mentions: ${failed.join(", ")}.` });
    }
  }

  // 3. Duplicates across the batch ----------------------------------------------
  for (let j = 0; j < audited.length; j++) {
    for (let i = 0; i < j; i++) {
      const a = audited[i].fp;
      const b = audited[j].fp;
      if (!a || !b) continue;
      const m = compareFingerprints(b, a);
      if (m) {
        anomalies.push({
          code: "DUPLICATE_SUSPECTED", severity: "warning", rule_id: "DUPLICATE-CHECK", entry_ref: audited[j].ref,
          detail: `Duplicate of ${audited[i].ref} (${m.reason === "same_number" ? "same supplier and invoice number" : "same supplier, same amount, dates within 5 days"}).`,
        });
      }
    }
  }

  // 4. Entry-level checks ------------------------------------------------------
  for (const a of audited) {
    const e = a.entry;
    const d = e.lines.reduce((s, l) => s + toCents(l.debit), 0);
    const c = e.lines.reduce((s, l) => s + toCents(l.credit), 0);
    if (d !== c) anomalies.push({ code: "UNBALANCED_ENTRY", severity: "error", rule_id: "BALANCE-CHECK", entry_ref: a.ref, detail: `Debits ${fromCents(d).toFixed(2)} != credits ${fromCents(c).toFixed(2)}.` });
    if (e.lines.some((l) => l.account.startsWith("471"))) {
      anomalies.push({ code: "SUSPENSE_ACCOUNT_USED", severity: "warning", rule_id: "SUSPENSE-ACCOUNT", entry_ref: a.ref, detail: "Suspense account 471 used: the entry must be cleared to its final account before closing." });
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(e.date) && [0, 6].includes(dayOfWeek(e.date))) {
      anomalies.push({ code: "WEEKEND_DATE", severity: "info", rule_id: "JET-WEEKEND", entry_ref: a.ref, detail: `Entry dated on a weekend (${e.date}).` });
    }
    if (d >= 100_000 && d % 10_000 === 0) {
      anomalies.push({ code: "ROUND_AMOUNT", severity: "info", rule_id: "JET-ROUND-AMOUNT", entry_ref: a.ref, detail: `Round amount (${fromCents(d).toFixed(2)} EUR): check the supporting document.` });
    }
    // VAT checks on raw entries (engine-built entries are already checked).
    if (!a.result) {
      const base = e.lines.filter((l) => /^(6|2)/.test(l.account)).reduce((s, l) => s + toCents(l.debit) - toCents(l.credit), 0);
      const vat = e.lines.filter((l) => /^4456/.test(l.account)).reduce((s, l) => s + toCents(l.debit) - toCents(l.credit), 0);
      const due = e.lines.filter((l) => /^4452/.test(l.account)).reduce((s, l) => s + toCents(l.credit) - toCents(l.debit), 0);
      if (vat !== 0 && base !== 0) {
        const ratio = vat / base;
        const ok = due !== 0 || VALID_RATES.some((r) => Math.abs(ratio - r) <= Math.max(0.002, 2 / Math.abs(base)));
        if (!ok) anomalies.push({ code: "VAT_RATIO_UNUSUAL", severity: "warning", rule_id: "AUDIT-VAT-RATIO", entry_ref: a.ref, detail: `Deductible VAT is ${(ratio * 100).toFixed(2)}% of the base, which matches no French VAT rate.` });
      }
      if (e.lines.some((l) => l.account.startsWith("2") && toCents(l.debit) > 0) && e.lines.some((l) => l.account === "44566" && toCents(l.debit) > 0) && !e.lines.some((l) => l.account.startsWith("44562"))) {
        anomalies.push({ code: "VAT_ACCOUNT_MISMATCH", severity: "warning", rule_id: "AUDIT-VAT-ACCOUNT", entry_ref: a.ref, detail: "VAT on a fixed asset is booked in 44566 instead of 44562." });
      }
      if (due !== 0 && due !== vat) {
        anomalies.push({ code: "REVERSE_CHARGE_UNBALANCED", severity: "warning", rule_id: "AUDIT-REVERSE-CHARGE", entry_ref: a.ref, detail: `Self-assessed VAT due (4452: ${fromCents(due).toFixed(2)}) differs from the VAT deducted (${fromCents(vat).toFixed(2)}).` });
      }
      if (vat > 0 && e.lines.some((l) => NON_DEDUCTIBLE_PREFIXES.some((p) => l.account.startsWith(p)) && toCents(l.debit) > 0)) {
        anomalies.push({ code: "VAT_DEDUCTED_ON_EXCLUDED_EXPENSE", severity: "warning", rule_id: "VAT-DEDUCTIBILITY", entry_ref: a.ref, detail: "VAT deducted on passenger transport or staff accommodation, which is excluded from the right to deduct." });
      }
    }
  }

  // 5. Statutory auditor viewpoint --------------------------------------------
  const perfCents = toCents(performance);
  const trivialCents = toCents(trivial);
  for (const a of audited) {
    const mine = anomalies.filter((x) => x.entry_ref === a.ref);
    const material = a.amountCents >= perfCents;
    if (material) {
      sa.push({ code: "ABOVE_PERFORMANCE_MATERIALITY", entry_ref: a.ref, risk: a.amountCents >= toCents(materiality) ? "high" : "medium",
        detail: `Entry of ${fromCents(a.amountCents).toFixed(2)} EUR exceeds performance materiality (${performance.toFixed(2)} EUR).`,
        recommendation: "Vouch to the supporting invoice, delivery evidence and payment (existence, accuracy, cut-off)." });
    }
    for (const x of mine) {
      const big = a.amountCents > trivialCents;
      switch (x.code) {
        case "DUPLICATE_SUSPECTED":
          sa.push({ code: x.code, entry_ref: a.ref, risk: big ? "high" : "medium", detail: `${x.detail} Expenses and payables may be overstated.`, recommendation: "Confirm with the supplier statement and reverse the duplicate entry before payment." });
          break;
        case "UNBALANCED_ENTRY":
          sa.push({ code: x.code, entry_ref: a.ref, risk: "high", detail: x.detail, recommendation: "Correct the entry; an unbalanced entry breaks the trial balance and the FEC." });
          break;
        case "SUSPENSE_ACCOUNT_USED":
          sa.push({ code: x.code, entry_ref: a.ref, risk: "medium", detail: x.detail, recommendation: "Clear 471 before closing; unexplained suspense balances are a classic audit finding." });
          break;
        case "UNMATCHED_TRANSACTION":
          sa.push({ code: x.code, entry_ref: a.ref, risk: "medium", detail: x.detail, recommendation: "Obtain the supporting document for the bank movement." });
          break;
        case "NON_COMPLIANT_INVOICE":
          sa.push({ code: x.code, entry_ref: a.ref, risk: "low", detail: x.detail, recommendation: "Request a corrected invoice; keep it as audit evidence." });
          break;
        case "CLASSIFICATION_UNCERTAIN":
          sa.push({ code: x.code, entry_ref: a.ref, risk: big ? "medium" : "low", detail: x.detail, recommendation: "Confirm the account allocation (expense vs fixed asset)." });
          break;
        case "ROUND_AMOUNT":
        case "WEEKEND_DATE":
          sa.push({ code: x.code, entry_ref: a.ref, risk: "low", detail: x.detail, recommendation: "Journal-entry testing: check authorisation and supporting evidence." });
          break;
        case "TOTALS_INCONSISTENT":
        case "SUPPLIER_TOTAL_MISMATCH":
          sa.push({ code: x.code, entry_ref: a.ref, risk: "medium", detail: x.detail, recommendation: "Agree the booked amounts to the invoice; obtain a corrected invoice." });
          break;
        default:
          break;
      }
    }
  }

  // 6. Tax inspector viewpoint -------------------------------------------------
  for (const a of audited) {
    const mine = anomalies.filter((x) => x.entry_ref === a.ref);
    for (const x of mine) {
      switch (x.code) {
        case "VAT_RATE_MISMATCH":
          ti.push({ code: x.code, entry_ref: a.ref, risk: "medium", detail: x.detail,
            recommendation: x.detail.includes("Only the VAT legally due is deducted")
              ? "No excess deduction: the engine deducts only the VAT legally due and charges the excess to the expense. Obtain a corrected invoice to recover the excess."
              : "Deduct only the VAT legally due (reverse any excess from 44566) or obtain a corrected invoice from the supplier." });
          break;
        case "NON_COMPLIANT_INVOICE":
          ti.push({ code: "VAT_DEDUCTION_AT_RISK", entry_ref: a.ref, risk: "medium", detail: `${x.detail} The right to deduct VAT requires an invoice bearing the mandatory mentions.`, recommendation: "Obtain a compliant invoice before deducting the VAT on the return." });
          break;
        case "DUPLICATE_SUSPECTED":
          ti.push({ code: "VAT_DOUBLE_DEDUCTION", entry_ref: a.ref, risk: "high", detail: `${x.detail} The same VAT would be deducted twice.`, recommendation: "Remove the duplicate before filing the VAT return." });
          break;
        case "VAT_RATIO_UNUSUAL":
        case "VAT_ACCOUNT_MISMATCH":
        case "REVERSE_CHARGE_UNBALANCED":
          ti.push({ code: x.code, entry_ref: a.ref, risk: "medium", detail: x.detail, recommendation: "Recompute the VAT from the invoice and correct the VAT accounts." });
          break;
        case "VAT_DEDUCTED_ON_EXCLUDED_EXPENSE":
          ti.push({ code: x.code, entry_ref: a.ref, risk: "high", detail: x.detail, recommendation: "Reverse the VAT into the expense (excluded from deduction)." });
          break;
        case "FOREIGN_VAT_CHARGED":
          ti.push({ code: x.code, entry_ref: a.ref, risk: "low", detail: x.detail, recommendation: "Claim the foreign VAT through the EU refund procedure if material." });
          break;
        case "GIFT_VAT_THRESHOLD":
          ti.push({ code: x.code, entry_ref: a.ref, risk: "medium", detail: x.detail, recommendation: "Keep the list of beneficiaries; deduct VAT only on gifts within the threshold." });
          break;
        default:
          break;
      }
    }
    // Category-based deductibility risks (engine-built entries).
    for (const l of a.result ? a.entry.lines : []) {
      if (l.account === "6257" && l.debit > 0) {
        ti.push({ code: "RECEPTION_EXPENSES", entry_ref: a.ref, risk: "low", detail: `Business meals/receptions (${l.debit.toFixed(2)} EUR): deductible only if incurred in the interest of the business.`, recommendation: "Document attendees and business purpose on the receipt." });
      }
      if (l.account === "6234" && l.debit > 0) {
        ti.push({ code: "BUSINESS_GIFTS", entry_ref: a.ref, risk: "medium", detail: `Business gifts (${l.debit.toFixed(2)} EUR): VAT deductible only within the per-beneficiary threshold; may require disclosure in the overheads statement.`, recommendation: "Keep the list of beneficiaries and amounts." });
      }
    }
    const nonDed = a.result?.anomalies.find((x) => x.code === "VAT_NOT_DEDUCTIBLE");
    if (nonDed) ti.push({ code: "NON_DEDUCTIBLE_VAT_EXCLUDED", entry_ref: a.ref, risk: "low", detail: nonDed.detail, recommendation: "No action: VAT correctly kept out of 44566." });
    if (a.result?.vat.regime === "reverse_charge_intra_eu") {
      ti.push({ code: "REVERSE_CHARGE_REPORTING", entry_ref: a.ref, risk: "low", detail: "Intra-EU reverse charge: VAT due and deductible must both appear on the same VAT return.", recommendation: "Check the return reports the self-assessed VAT (due and deductible)." });
    }
  }

  // 7. Totals & result ------------------------------------------------------------
  const allLines = audited.flatMap((a) => a.entry.lines);
  const td = allLines.reduce((s, l) => s + toCents(l.debit), 0);
  const tc = allLines.reduce((s, l) => s + toCents(l.credit), 0);
  const saRisk = maxRisk(sa.map((f) => f.risk));
  const tiRisk = maxRisk(ti.map((f) => f.risk));
  const statutory_auditor: ExpertViewpoint = {
    role: "statutory_auditor",
    overall_risk: saRisk,
    materiality_threshold: materiality,
    findings: sa,
    summary: `${audited.length} entries audited (${fromCents(td).toFixed(2)} EUR of debits). Overall materiality ${materiality.toFixed(2)} EUR, performance materiality ${performance.toFixed(2)} EUR, clearly trivial ${trivial.toFixed(2)} EUR. ${sa.length} finding(s); overall risk ${saRisk}.`,
  };
  const tax_inspector: ExpertViewpoint = {
    role: "tax_inspector",
    overall_risk: tiRisk,
    findings: ti,
    summary: `${ti.length} VAT/deductibility point(s) identified; overall risk ${tiRisk}.${ti.some((f) => f.code === "VAT_DOUBLE_DEDUCTION") ? " A duplicate would lead to a double VAT deduction." : ""}${ti.some((f) => f.code === "VAT_RATE_MISMATCH") ? " Excess VAT invoiced at the wrong rate is not deductible." : ""}`,
  };
  const human = anomalies.some((x) => x.severity !== "info") || saRisk === "high" || tiRisk === "high";
  const codes = [...new Set(anomalies.filter((x) => x.severity !== "info").map((x) => x.code))];
  return {
    entries_audited: audited.length,
    totals: { debit: fromCents(td), credit: fromCents(tc), balanced: td === tc },
    anomalies,
    viewpoints: { statutory_auditor, tax_inspector },
    human_review_required: human,
    explanation: `Audited ${audited.length} entries: debits ${fromCents(td).toFixed(2)} EUR, credits ${fromCents(tc).toFixed(2)} EUR (${td === tc ? "balanced" : "NOT balanced"}). ` +
      (codes.length ? `Issues found: ${codes.join(", ")}. ` : "No significant issue found. ") +
      `Statutory auditor risk: ${saRisk}; tax inspector risk: ${tiRisk}.` + (human ? " Human review required." : ""),
    engine: { version: ENGINE_VERSION, rules_applied: ["AUDIT-BATCH", "DUPLICATE-CHECK", "BALANCE-CHECK", "SUSPENSE-ACCOUNT", "JET-WEEKEND", "JET-ROUND-AMOUNT", "AUDIT-VAT-RATIO", "AUDIT-VAT-ACCOUNT", "AUDIT-REVERSE-CHARGE", "COMPLIANCE-MENTIONS", "MATERIALITY", "VAT-DEDUCTIBILITY"], llm_used: false, extraction_method: "structured_json" },
    disclaimer: DISCLAIMER,
  };
}
