/**
 * Mandatory invoice mentions as checks with stable rule_ids.
 *  - FR-INV-*  : classic mentions (VAT invoice mentions and commercial-code
 *                payment mentions; legal references live in legal-basis.ts)
 *  - FR-EINV-* : e-invoicing reform mentions (buyer SIREN, delivery address,
 *                operation category, VAT-on-debits option)
 * Severity "error" -> non_compliant; only "warning" -> warning; else compliant.
 * Checks that do not apply to an invoice are omitted (e.g. supplier SIREN for a
 * German supplier) and listed in `skipped`.
 */
import type { ComplianceCheck, Compliance, InvoiceInput, OperationNature } from "../types";
import { isValidSiren } from "../text";
import { toCents, vatCents } from "../money";
import { hasExemptionMention, hasReverseChargeMention, isValidRate, rateLabel, supplierLocation, type RegimeDecision } from "./vat";

/**
 * E-invoicing reform timeline (ADR-019, to verify with Ary):
 *  - reception of e-invoices is mandatory for every company from 1 Sept 2026;
 *  - issuance (and the new mentions) is mandatory for large and mid-size
 *    companies (GE/ETI) from 1 Sept 2026, for SMEs and micro-businesses from
 *    1 Sept 2027.
 * Severity of the FR-EINV-* checks: info before REFORM_MENTIONS_FROM; error from
 * REFORM_MENTIONS_ALL_FROM, or from REFORM_MENTIONS_FROM for a large/mid supplier;
 * warning in between (supplier size SME/micro or unknown).
 */
export const REFORM_MENTIONS_FROM = "2026-09-01";
export const REFORM_MENTIONS_ALL_FROM = "2027-09-01";

export const REFORM_TIMELINE_HINT =
  "Timeline: e-invoice reception is mandatory for all companies since 1 Sept 2026; issuance with these mentions is mandatory for large and mid-size companies from 1 Sept 2026 and for SMEs and micro-businesses from 1 Sept 2027. Declare supplier.company_size to refine.";

/** Severity of the reform-mention checks for this invoice (ADR-019). */
export function reformSeverity(inv: InvoiceInput): ComplianceCheck["severity"] {
  const d = inv.issue_date ?? "";
  if (d < REFORM_MENTIONS_FROM) return "info";
  if (d >= REFORM_MENTIONS_ALL_FROM) return "error";
  const size = inv.supplier.company_size;
  return size === "large" || size === "mid" ? "error" : "warning";
}

export interface MentionContext {
  regime: RegimeDecision;
  /** Operation nature derived from line kinds (undefined if line kinds are unknown). */
  derived_nature?: OperationNature;
}

export interface MentionResult {
  compliance: Compliance;
  skipped: string[];
}

const blank = (s?: string) => s === undefined || s.trim().length === 0;

export function checkMentions(inv: InvoiceInput, ctx: MentionContext): MentionResult {
  const checks: ComplianceCheck[] = [];
  const skipped: string[] = [];
  const loc = supplierLocation(inv);
  const domestic = loc === "FR";
  const customerFr = (inv.customer.country || "FR").toUpperCase() === "FR";
  const isCreditNote = inv.document_type === "credit_note";

  const add = (rule_id: string, label: string, passed: boolean, severity: ComplianceCheck["severity"], fix_hint: string, legal_basis_id?: string) => {
    checks.push({ rule_id, label, passed, severity, ...(passed ? {} : { fix_hint }), ...(legal_basis_id ? { legal_basis_id } : {}) });
  };

  // --- Classic mentions -----------------------------------------------------
  add("FR-INV-NUMBER", "Unique invoice number", !blank(inv.number), "error", "Ask the supplier for an invoice bearing a unique sequential number.", "LB-INV-MENTIONS");
  add("FR-INV-DATE", "Issue date", /^\d{4}-\d{2}-\d{2}$/.test(inv.issue_date ?? ""), "error", "The issue date is missing or not in YYYY-MM-DD format.", "LB-INV-MENTIONS");
  add("FR-INV-SUPPLIER-NAME", "Supplier name", !blank(inv.supplier.name), "error", "Supplier name is missing.", "LB-INV-MENTIONS");
  add("FR-INV-SUPPLIER-ADDRESS", "Supplier address", !blank(inv.supplier.address), "error", "Supplier address is missing.", "LB-INV-MENTIONS");
  add("FR-INV-CUSTOMER-NAME", "Customer name", !blank(inv.customer.name), "error", "Customer name is missing.", "LB-INV-MENTIONS");
  add("FR-INV-CUSTOMER-ADDRESS", "Customer billing address", !blank(inv.customer.address), "error", "Customer billing address is missing.", "LB-INV-MENTIONS");

  if (domestic) {
    const s = inv.supplier.siren;
    add("FR-INV-SUPPLIER-SIREN", "Supplier SIREN (valid 9-digit number)", !!s && isValidSiren(s), "error",
      s ? `Supplier SIREN "${s}" is not a valid 9-digit SIREN (Luhn check).` : "Supplier SIREN is missing.", "LB-INV-COMMERCIAL-IDENTIFICATION");
  } else skipped.push("FR-INV-SUPPLIER-SIREN");

  const vatCharged = inv.lines.some((l) => l.vat_rate > 0) || toCents(inv.totals.total_vat) !== 0;
  const franchise = ctx.regime.legal_basis_id === "LB-VAT-FRANCHISE";
  if (loc !== "NON_EU" && !franchise) {
    const v = inv.supplier.vat_id;
    const sev = vatCharged || loc === "EU" ? "error" : "warning";
    add("FR-INV-SUPPLIER-VATID", "Supplier intra-EU VAT number", !blank(v), sev, "Supplier intra-EU VAT number is missing.", "LB-INV-MENTIONS");
  } else skipped.push("FR-INV-SUPPLIER-VATID");

  if (ctx.regime.self_assessed) {
    add("FR-INV-CUSTOMER-VATID", "Customer intra-EU VAT number (required for intra-EU reverse charge)", !blank(inv.customer.vat_id), "error",
      "Intra-EU invoices must show the customer's VAT number; ask the supplier for a corrected invoice.", "LB-INV-MENTIONS");
  } else skipped.push("FR-INV-CUSTOMER-VATID");

  // Lines: description, quantity and unit price are three distinct mentions.
  const badDesc = inv.lines.map((l, i) => (blank(l.description) ? i + 1 : 0)).filter(Boolean);
  const badQty = inv.lines.map((l, i) => (!(typeof l.quantity === "number" && l.quantity !== 0) ? i + 1 : 0)).filter(Boolean);
  const badPrice = inv.lines.map((l, i) => (!(typeof l.unit_price_excl_vat === "number" && Number.isFinite(l.unit_price_excl_vat)) ? i + 1 : 0)).filter(Boolean);
  add("FR-INV-LINES-PRESENT", "At least one invoice line", inv.lines.length > 0, "error", "The invoice has no line.", "LB-INV-MENTIONS");
  add("FR-INV-LINE-DESCRIPTION", "Precise description of each good or service", badDesc.length === 0, "error", `Missing description on line(s) ${badDesc.join(", ")}.`, "LB-INV-MENTIONS");
  add("FR-INV-LINE-QUANTITY", "Quantity on each line", badQty.length === 0, "error", `Missing or zero quantity on line(s) ${badQty.join(", ")}.`, "LB-INV-MENTIONS");
  add("FR-INV-LINE-UNIT-PRICE", "Unit price excl. VAT on each line", badPrice.length === 0, "error", `Missing unit price on line(s) ${badPrice.join(", ")}.`, "LB-INV-MENTIONS");

  const badRates = inv.lines.filter((l) => !isValidRate(l.vat_rate)).map((l) => rateLabel(l.vat_rate));
  add("FR-INV-VAT-RATE", "Valid French VAT rate on each line (20, 10, 5.5, 2.1 or 0%)", badRates.length === 0, "error",
    `Unknown VAT rate(s): ${[...new Set(badRates)].join(", ")}.`, "LB-INV-MENTIONS");

  // Totals consistency (tolerance 0.01 per line / per rate).
  const t = totalsConsistency(inv);
  add("FR-INV-LINE-TOTALS", "Line totals = quantity x unit price", t.lineMismatches.length === 0, "error",
    `Line total(s) inconsistent on line(s) ${t.lineMismatches.join(", ")}.`, "LB-INV-MENTIONS");
  add("FR-INV-TOTAL-EXCL-VAT", "Total excl. VAT = sum of lines", t.htOk, "error",
    `Sum of lines ${(t.linesHtCents / 100).toFixed(2)} differs from total excl. VAT ${inv.totals.total_excl_vat.toFixed(2)}.`, "LB-INV-MENTIONS");
  add("FR-INV-VAT-AMOUNT", "VAT amount consistent with the rates (per rate, 0.01 tolerance)", t.vatOk, "error",
    `Invoiced VAT ${inv.totals.total_vat.toFixed(2)} differs from recomputed VAT ${(t.recomputedVatCents / 100).toFixed(2)}.`, "LB-INV-MENTIONS");
  add("FR-INV-TOTAL-INCL-VAT", "Total incl. VAT = total excl. VAT + VAT", t.ttcOk, "error",
    `Total incl. VAT ${inv.totals.total_incl_vat.toFixed(2)} != ${inv.totals.total_excl_vat.toFixed(2)} + ${inv.totals.total_vat.toFixed(2)}.`, "LB-INV-MENTIONS");

  // Exemption / reverse-charge mentions.
  if (!vatCharged && loc === "FR") {
    add("FR-INV-VAT-EXEMPTION-MENTION", "Exemption mention when no VAT is invoiced", hasExemptionMention(inv), "error",
      "Ask the supplier to add the legal VAT-exemption mention (the exemption ground, or the VAT-franchise mention); see legal_basis_id LB-VAT-EXEMPT-TRAINING / LB-VAT-FRANCHISE.", "LB-INV-MENTIONS");
  } else skipped.push("FR-INV-VAT-EXEMPTION-MENTION");
  if (ctx.regime.self_assessed) {
    add("FR-INV-REVERSE-CHARGE-MENTION", 'Reverse-charge mention ("Autoliquidation" / "Reverse charge")', hasReverseChargeMention(inv), "error",
      'Intra-EU B2B invoices without VAT must state "Autoliquidation" (reverse charge).', "LB-VAT-REVERSE-CHARGE-SERVICES");
  } else skipped.push("FR-INV-REVERSE-CHARGE-MENTION");

  if (isCreditNote) {
    add("FR-INV-CREDIT-NOTE-REFERENCE", "Credit note references the original invoice", !blank(inv.original_invoice_number), "error",
      "A credit note must reference the number of the invoice it corrects.", "LB-VAT-CREDIT-NOTE");
  } else skipped.push("FR-INV-CREDIT-NOTE-REFERENCE");

  // Commercial-code mentions (B2B invoices from a French supplier). They govern
  // payment terms, so they are not required on a credit note.
  if (domestic && !isCreditNote) {
    add("FR-INV-PAYMENT-DUE-DATE", "Payment due date / payment terms", !blank(inv.due_date) || !blank(inv.payment_terms), "error",
      "Add the payment due date and payment terms.", "LB-COM-INVOICE-MENTIONS");
    add("FR-INV-LATE-PENALTIES", "Late-payment penalty rate", !blank(inv.late_payment_penalties), "error",
      'Add the late-payment penalty rate (e.g. "3 fois le taux d\'intérêt légal").', "LB-COM-LATE-PENALTIES");
    add("FR-INV-RECOVERY-INDEMNITY", "EUR 40 fixed recovery indemnity (B2B)", inv.fixed_recovery_indemnity_mention === true, "error",
      'Add "Indemnité forfaitaire pour frais de recouvrement : 40 €".', "LB-COM-LATE-PENALTIES");
  } else skipped.push("FR-INV-PAYMENT-DUE-DATE", "FR-INV-LATE-PENALTIES", "FR-INV-RECOVERY-INDEMNITY");

  // --- E-invoicing reform mentions (domestic B2B) ----------------------------
  if (domestic && customerFr) {
    const sev = reformSeverity(inv);
    const timeline = sev === "warning" ? ` Not yet mandatory for this issuer (size ${inv.supplier.company_size ?? "not declared"}): mandatory by 1 Sept 2027 at the latest. ${REFORM_TIMELINE_HINT}` : "";
    const cs = inv.customer.siren;
    add("FR-EINV-SIREN-BUYER", "Buyer SIREN (e-invoicing reform)", !!cs && isValidSiren(cs), sev,
      (cs ? `Buyer SIREN "${cs}" is not a valid SIREN.` : "Ask the supplier to reissue the invoice with your SIREN.") + timeline, "LB-EINV-REFORM-MENTIONS");

    const declared = inv.operation_nature;
    const derived = ctx.derived_nature;
    const natureOk = !!declared && (!derived || derived === declared);
    add("FR-EINV-OPERATION-NATURE", "Operation category: goods / services / mixed (e-invoicing reform)", natureOk, sev,
      (!declared
        ? `Operation category missing${derived ? `; the lines indicate "${derived}"` : ""}.`
        : `Declared operation category "${declared}" does not match the lines ("${derived}").`) + timeline,
      "LB-EINV-REFORM-MENTIONS");

    const goods = (declared ?? derived) === "goods" || (declared ?? derived) === "mixed";
    if (goods) {
      add("FR-EINV-DELIVERY-ADDRESS", "Delivery address when different from the billing address (e-invoicing reform)", true, "info",
        "", "LB-EINV-REFORM-MENTIONS");
    } else skipped.push("FR-EINV-DELIVERY-ADDRESS");

    const services = (declared ?? derived) === "services" || (declared ?? derived) === "mixed";
    if (services && vatCharged) {
      add("FR-EINV-VAT-ON-DEBITS", "VAT-on-debits option stated when the supplier opted (e-invoicing reform)", true, "info", "", "LB-EINV-REFORM-MENTIONS");
    } else skipped.push("FR-EINV-VAT-ON-DEBITS");
  } else skipped.push("FR-EINV-SIREN-BUYER", "FR-EINV-OPERATION-NATURE", "FR-EINV-DELIVERY-ADDRESS", "FR-EINV-VAT-ON-DEBITS");

  return { compliance: { status: statusOf(checks), checks }, skipped };
}

export function statusOf(checks: ComplianceCheck[]): Compliance["status"] {
  if (checks.some((c) => !c.passed && c.severity === "error")) return "non_compliant";
  if (checks.some((c) => !c.passed && c.severity === "warning")) return "warning";
  return "compliant";
}

export interface TotalsConsistency {
  lineMismatches: number[];
  linesHtCents: number;
  recomputedVatCents: number;
  htOk: boolean;
  vatOk: boolean;
  ttcOk: boolean;
}

/** Totals checks: line totals, sum of lines, VAT per rate (0.01 tolerance per rate), HT + VAT = TTC. */
export function totalsConsistency(inv: InvoiceInput): TotalsConsistency {
  const lineMismatches: number[] = [];
  let linesHt = 0;
  const perRate = new Map<number, number>();
  inv.lines.forEach((l, i) => {
    const computed = toCents(l.quantity * l.unit_price_excl_vat);
    const declared = l.total_excl_vat !== undefined ? toCents(l.total_excl_vat) : computed;
    if (Math.abs(declared - computed) > 1) lineMismatches.push(i + 1);
    linesHt += declared;
    perRate.set(l.vat_rate, (perRate.get(l.vat_rate) ?? 0) + declared);
  });
  let recomputedVat = 0;
  for (const [rate, base] of perRate) recomputedVat += vatCents(base, rate);
  const nRates = Math.max(1, [...perRate.keys()].filter((r) => r > 0).length);
  const ht = toCents(inv.totals.total_excl_vat);
  const vat = toCents(inv.totals.total_vat);
  const ttc = toCents(inv.totals.total_incl_vat);
  return {
    lineMismatches,
    linesHtCents: linesHt,
    recomputedVatCents: recomputedVat,
    htOk: Math.abs(linesHt - ht) <= 1,
    vatOk: Math.abs(recomputedVat - vat) <= nRates,
    ttcOk: Math.abs(ht + vat - ttc) <= 1,
  };
}
