/**
 * Core pipeline: input parsing -> classification -> VAT -> entry -> compliance
 * -> anomalies -> confidence -> explanation. Deterministic for structured inputs.
 */
import type {
  Anomaly, BankTransactionInput, CheckResult, ClientProfile, Compliance, EngineContext, EngineInput, EngineMeta, EntryResult,
  InvoiceInput, InvoiceSummary, JournalEntry, OperationNature, VatTreatment,
} from "./types";
import { DISCLAIMER } from "./types";
import { EngineError } from "./errors";
import { DEMO_PROFILE } from "./profile";
import { allocate, formatEur, fromCents, toCents, vatCents } from "./money";
import { auxiliaryCode, sanitiseAux } from "./text";
import { buildEntry, reverseLines, type CentsLine } from "./entry";
import {
  CATEGORY_IDS, CLASSIFICATION_THRESHOLD, FIXED_ASSET_ACCOUNT, FIXED_ASSET_THRESHOLD, LOW_VALUE_EQUIPMENT_ACCOUNT, classifyLine, getCategory,
  type Classification, type ExpenseCategory,
} from "./rules/pcg";
import { VAT_ACCOUNTS, breakdownByRate, decideRegime, isValidRate, rateLabel, supplierLocation, unexpectedRate, type RegimeDecision } from "./rules/vat";
import { checkMentions, totalsConsistency } from "./rules/mentions";
import { findDuplicates, fingerprint } from "./rules/duplicates";
import { validateInvoice, validateTransaction } from "./parsers/json";
import { base64ToBytes, extractFacturxXml } from "./parsers/facturx";
import { parseCii } from "./parsers/cii";
import { looksLikeCii, parseUbl } from "./parsers/ubl";
import { matchTransaction } from "./parsers/bank";

export const ENGINE_VERSION = "0.1.0";
export const LLM_REVIEW_THRESHOLD = 0.9;
export const BANK_ACCOUNT = { account: "512000", label: "Banque" };
export const SUSPENSE_ACCOUNT = { account: "471", label: "Compte d'attente" };

// ---------------------------------------------------------------------------
// Input parsing
// ---------------------------------------------------------------------------

export interface ParsedInput {
  invoice?: InvoiceInput;
  transaction?: BankTransactionInput;
  candidate_invoices?: InvoiceInput[];
  method: EngineMeta["extraction_method"];
  confidence: number;
  llm_used?: boolean;
}

export async function parseInput(input: EngineInput, ctx: EngineContext = {}): Promise<ParsedInput> {
  if (!input || typeof input !== "object" || typeof (input as { format?: unknown }).format !== "string") {
    throw new EngineError("INVALID_INPUT", 'Input must be an object with a "format" field.', [{ path: "format", message: "required" }]);
  }
  switch (input.format) {
    case "json":
      return { invoice: validateInvoice(input.invoice), method: "structured_json", confidence: 1 };
    case "facturx": {
      if (typeof input.document_base64 !== "string" || input.document_base64.length === 0) {
        throw new EngineError("INVALID_INPUT", "document_base64 is required for format facturx.", [{ path: "document_base64", message: "required" }]);
      }
      const xml = await extractFacturxXml(base64ToBytes(input.document_base64));
      return { invoice: validateInvoice(parseCii(xml), "facturx"), method: "facturx_cii", confidence: 1 };
    }
    case "ubl": {
      if (typeof input.xml !== "string" || input.xml.trim().length === 0) {
        throw new EngineError("INVALID_INPUT", "xml is required for format ubl.", [{ path: "xml", message: "required" }]);
      }
      // A CII document sent as "ubl" is accepted (both are XML e-invoice syntaxes).
      if (looksLikeCii(input.xml)) return { invoice: validateInvoice(parseCii(input.xml), "cii"), method: "facturx_cii", confidence: 1 };
      return { invoice: validateInvoice(parseUbl(input.xml), "ubl"), method: "ubl", confidence: 1 };
    }
    case "bank_transaction": {
      const transaction = validateTransaction(input.transaction);
      const candidates = (input.candidate_invoices ?? []).map((c, i) => validateInvoice(c, `candidate_invoices.${i}`));
      return { transaction, candidate_invoices: candidates, method: "bank_transaction", confidence: 1 };
    }
    case "pdf":
    case "image": {
      if (typeof input.document_base64 !== "string" || input.document_base64.length === 0) {
        throw new EngineError("INVALID_INPUT", "document_base64 is required.", [{ path: "document_base64", message: "required" }]);
      }
      const mime = input.mime_type ?? (input.format === "pdf" ? "application/pdf" : "image/png");
      if (input.format === "pdf") {
        // A PDF may still be a Factur-X: prefer the structured attachment when present.
        try {
          const xml = await extractFacturxXml(base64ToBytes(input.document_base64));
          return { invoice: validateInvoice(parseCii(xml), "facturx"), method: "facturx_cii", confidence: 1 };
        } catch (e) {
          if (!(e instanceof EngineError) || e.code !== "FACTURX_XML_NOT_FOUND") throw e;
        }
      }
      if (!ctx.llm) {
        throw new EngineError("LLM_UNAVAILABLE", "Unstructured PDF/image extraction requires the LLM layer, which is not configured. Send JSON, Factur-X or UBL instead.");
      }
      const out = await ctx.llm.extractInvoice({ base64: input.document_base64, mime_type: mime });
      const invoice = validateInvoice(out.invoice, "llm.invoice");
      return { invoice, method: "llm", confidence: Math.max(0, Math.min(1, out.confidence)), llm_used: true };
    }
    default:
      throw new EngineError("UNSUPPORTED_FORMAT", `Unsupported format "${(input as { format: string }).format}".`, {
        supported: ["json", "facturx", "ubl", "bank_transaction", "pdf", "image"],
      });
  }
}

// ---------------------------------------------------------------------------
// Invoice analysis
// ---------------------------------------------------------------------------

interface LineInfo {
  index: number;
  description: string;
  baseCents: number;
  rate: number;
  unitPrice: number;
  classification: Classification;
  category: ExpenseCategory;
  account: string;
  accountLabel: string;
  isAsset: boolean;
  kind: "goods" | "services";
  deductible: boolean;
}

export interface InvoiceAnalysis {
  invoice: InvoiceInput;
  profile: ClientProfile;
  summary: InvoiceSummary;
  lines: LineInfo[];
  regime: RegimeDecision;
  compliance: Compliance;
  vat: VatTreatment;
  entry: JournalEntry;
  anomalies: Anomaly[];
  review_reasons: string[];
  rules_applied: string[];
  llm_used: boolean;
  vat_consistency: { passed: boolean; detail: string };
  derived_nature?: OperationNature;
}

function summaryOf(inv: InvoiceInput, nature?: OperationNature): InvoiceSummary {
  return {
    document_type: inv.document_type,
    number: inv.number,
    date: inv.issue_date,
    supplier: inv.supplier,
    customer: inv.customer,
    ...(inv.operation_nature ?? nature ? { operation_nature: inv.operation_nature ?? nature } : {}),
    totals: inv.totals,
  };
}

function natureOf(kinds: ("goods" | "services")[]): OperationNature | undefined {
  if (kinds.length === 0) return undefined;
  const g = kinds.includes("goods");
  const s = kinds.includes("services");
  return g && s ? "mixed" : g ? "goods" : "services";
}

export function supplierAccount(inv: InvoiceInput): { account: string; label: string } {
  const aux = inv.supplier.account_code ? sanitiseAux(inv.supplier.account_code) : auxiliaryCode(inv.supplier.name);
  return { account: `401${aux || "DIVERS"}`, label: `Fournisseur ${inv.supplier.name}` };
}

async function classifyAll(inv: InvoiceInput, ctx: EngineContext): Promise<{ results: Classification[]; llm_used: boolean }> {
  let llm_used = false;
  const results: Classification[] = [];
  for (const l of inv.lines) {
    let c = classifyLine(l.description, l.category_hint);
    if (c.confidence < CLASSIFICATION_THRESHOLD && ctx.llm) {
      try {
        const out = await ctx.llm.classifyExpense(l.description, [...CATEGORY_IDS]);
        llm_used = true;
        const cat = getCategory(out.category);
        if (cat) c = { category: cat, confidence: Math.max(0, Math.min(1, out.confidence)), method: "llm", matched_keywords: [] };
      } catch {
        // keep the deterministic result; it will be flagged as uncertain
      }
    }
    results.push(c);
  }
  return { results, llm_used };
}

export async function analyseInvoice(inv: InvoiceInput, ctx: EngineContext, meta: { method: EngineMeta["extraction_method"]; confidence: number }): Promise<InvoiceAnalysis> {
  const profile = ctx.profile ?? DEMO_PROFILE;
  const anomalies: Anomaly[] = [];
  const rules = new Set<string>();
  const isCredit = inv.document_type === "credit_note";
  const loc = supplierLocation(inv);

  // 1. Classification & fixed-asset decision -------------------------------
  const { results, llm_used } = await classifyAll(inv, ctx);
  const foreignVatCharged = loc !== "FR" && inv.lines.some((l) => l.vat_rate > 0);
  const lines: LineInfo[] = inv.lines.map((l, i) => {
    const c = results[i];
    const baseCents = l.total_excl_vat !== undefined ? toCents(l.total_excl_vat) : toCents(l.quantity * l.unit_price_excl_vat);
    let account = c.category.account;
    let accountLabel = c.category.account_label;
    let isAsset = false;
    if (c.category.id === "it_equipment") {
      rules.add("ASSET-THRESHOLD-500");
      if (Math.abs(l.unit_price_excl_vat) >= FIXED_ASSET_THRESHOLD) {
        isAsset = true;
        account = FIXED_ASSET_ACCOUNT.account;
        accountLabel = FIXED_ASSET_ACCOUNT.label;
      } else {
        account = LOW_VALUE_EQUIPMENT_ACCOUNT.account;
        accountLabel = LOW_VALUE_EQUIPMENT_ACCOUNT.label;
      }
    }
    let deductible = true;
    if (profile.vat_regime === "franchise") deductible = false;
    else if (foreignVatCharged) deductible = false;
    else if (c.category.vat_deductibility === "none") deductible = false;
    else if (c.category.vat_deductibility === "conditional") {
      deductible = Math.abs(l.unit_price_excl_vat) * (1 + l.vat_rate) <= 73;
    }
    rules.add(`PCG-MAP-${account}`);
    return {
      index: i, description: l.description, baseCents, rate: l.vat_rate, unitPrice: l.unit_price_excl_vat, classification: c, category: c.category,
      account, accountLabel, isAsset, kind: l.kind ?? c.category.kind, deductible,
    };
  });

  const explicitKinds = inv.lines.every((l) => l.kind) ? natureOf(inv.lines.map((l) => l.kind!)) : undefined;
  const guessedNature = natureOf(lines.map((l) => l.kind));
  const regime = decideRegime(inv, lines.map((l) => l.kind));
  rules.add(`VAT-REGIME-${regime.regime.toUpperCase()}`);

  // 2. Compliance --------------------------------------------------------------
  const { compliance } = checkMentions(inv, { regime, derived_nature: explicitKinds });
  for (const c of compliance.checks) rules.add(c.rule_id);
  if (!inv.operation_nature && !explicitKinds && guessedNature) {
    const chk = compliance.checks.find((c) => c.rule_id === "FR-EINV-OPERATION-NATURE");
    if (chk && !chk.passed) chk.fix_hint = `Operation category missing; the line classification suggests "${guessedNature}".`;
  }

  // 3. VAT amounts ---------------------------------------------------------------
  const tc = totalsConsistency(inv);
  const declaredVat = toCents(inv.totals.total_vat);
  const computedPerLine = lines.map((l) => vatCents(l.baseCents, l.rate));
  const allocWeights = computedPerLine.some((v) => v !== 0) ? computedPerLine : lines.map((l) => (l.rate > 0 ? l.baseCents : 0));
  const vatPerLine = regime.self_assessed ? lines.map(() => 0) : declaredVat === 0 ? lines.map(() => 0) : allocate(declaredVat, allocWeights);

  // Self-assessed VAT (reverse charge): French rate of the category (default 20%).
  const selfRate = (l: LineInfo) => l.category.expected_vat_rates?.find((r) => r > 0) ?? 0.2;
  const selfVatPerLine = regime.self_assessed ? lines.map((l) => vatCents(l.baseCents, selfRate(l))) : lines.map(() => 0);

  // 4. Entry -------------------------------------------------------------------
  const supplier = supplierAccount(inv);
  const debitLines: CentsLine[] = [];
  const vatLines: CentsLine[] = [];
  let due4452 = 0;
  let deductibleVat = 0;
  let nonDeductibleVat = 0;
  lines.forEach((l, i) => {
    const v = regime.self_assessed ? selfVatPerLine[i] : vatPerLine[i];
    const charge = l.baseCents + (l.deductible ? 0 : v);
    if (!l.deductible) nonDeductibleVat += v;
    debitLines.push({ account: l.account, label: l.accountLabel, debit: charge, credit: 0 });
    if (l.deductible && v !== 0) {
      deductibleVat += v;
      const acc = l.isAsset ? VAT_ACCOUNTS.deductibleFixedAssets : VAT_ACCOUNTS.deductibleGoodsServices;
      vatLines.push({ account: acc.account, label: acc.label, debit: v, credit: 0 });
    }
    if (regime.self_assessed) due4452 += v;
  });
  const debitTotal = [...debitLines, ...vatLines].reduce((a, l) => a + l.debit, 0);
  const supplierCredit = debitTotal - due4452;
  let centsLines: CentsLine[] = [...debitLines, ...vatLines];
  if (due4452 !== 0) centsLines.push({ account: VAT_ACCOUNTS.dueIntraCommunity.account, label: VAT_ACCOUNTS.dueIntraCommunity.label, debit: 0, credit: due4452 });
  centsLines.push({ account: supplier.account, label: supplier.label, debit: 0, credit: supplierCredit });
  if (isCredit) centsLines = reverseLines(centsLines);
  const entry = buildEntry("HA", inv.issue_date, inv.number, centsLines);
  rules.add("BALANCE-CHECK");
  if (regime.self_assessed) rules.add("VAT-REVERSE-CHARGE-ENTRY");
  if (isCredit) rules.add("CREDIT-NOTE-REVERSAL");

  // 5. Anomalies ----------------------------------------------------------------
  for (const l of lines) {
    if (!isValidRate(l.rate)) {
      anomalies.push({ code: "VAT_RATE_INVALID", severity: "error", rule_id: "FR-INV-VAT-RATE", detail: `Line ${l.index + 1} ("${l.description}") uses ${rateLabel(l.rate)}, which is not a French VAT rate.` });
    }
  }
  rules.add("VAT-EXPECTED-RATE");
  if (!regime.self_assessed && loc === "FR") {
    for (const l of lines) {
      if (!isValidRate(l.rate) || l.classification.confidence < CLASSIFICATION_THRESHOLD) continue;
      const expected = unexpectedRate(l.category, l.description, l.rate);
      if (expected) {
        const lower = Math.min(...expected);
        const excess = l.rate > lower ? vatPerLine[l.index] - vatCents(l.baseCents, lower) : 0;
        anomalies.push({
          code: "VAT_RATE_MISMATCH", severity: "warning", rule_id: "VAT-EXPECTED-RATE",
          detail: `Line ${l.index + 1} ("${l.description}") is invoiced at ${rateLabel(l.rate)}; the expected rate for this expense (${l.category.description.toLowerCase()}) is ${expected.map(rateLabel).join(" or ")}.` +
            (excess > 0 ? ` Excess VAT: ${formatEur(excess)}.` : "") +
            " The entry books the VAT as invoiced; only the VAT legally due is deductible — request a corrected invoice.",
        });
      }
    }
  }
  if (!tc.htOk || !tc.vatOk || !tc.ttcOk || tc.lineMismatches.length > 0) {
    anomalies.push({ code: "TOTALS_INCONSISTENT", severity: "error", rule_id: "FR-INV-VAT-AMOUNT", detail: "Invoice totals are inconsistent with the lines (see compliance checks); the entry uses the line amounts and the invoiced VAT." });
  }
  const totalsFlagged = anomalies.some((a) => a.code === "TOTALS_INCONSISTENT");
  if (!totalsFlagged && Math.abs(toCents(Math.abs(inv.totals.total_incl_vat)) - supplierCredit) > 1) {
    anomalies.push({ code: "SUPPLIER_TOTAL_MISMATCH", severity: "error", detail: `Supplier credited ${formatEur(supplierCredit)} but the invoice total is ${formatEur(toCents(Math.abs(inv.totals.total_incl_vat)))}.` });
  }
  for (const l of lines) {
    if (l.classification.confidence < CLASSIFICATION_THRESHOLD) {
      anomalies.push({ code: "CLASSIFICATION_UNCERTAIN", severity: "warning", detail: `Line ${l.index + 1} ("${l.description}") could not be classified with confidence (${l.classification.confidence.toFixed(2)}); provisionally booked to ${l.account}.` });
    }
  }
  rules.add("DUPLICATE-CHECK");
  const dups = findDuplicates(fingerprint(inv), ctx.history ?? []);
  for (const d of dups) {
    anomalies.push({
      code: "DUPLICATE_SUSPECTED", severity: "warning", rule_id: "DUPLICATE-CHECK",
      detail: d.reason === "same_number"
        ? `Invoice ${inv.number} from this supplier was already processed (issued ${d.other.issue_date}, ${d.other.total_incl_vat.toFixed(2)} EUR).`
        : `An invoice from this supplier with the same total (${d.other.total_incl_vat.toFixed(2)} EUR) was processed within ${5} days (number ${d.other.number}, ${d.other.issue_date}).`,
    });
  }
  if (inv.customer.siren && profile.siren && inv.customer.siren !== profile.siren) {
    anomalies.push({ code: "CUSTOMER_MISMATCH", severity: "warning", detail: `The invoice is addressed to SIREN ${inv.customer.siren}, not to ${profile.name} (${profile.siren}); VAT is only deductible by the addressee.` });
  }
  if (foreignVatCharged) {
    anomalies.push({ code: "FOREIGN_VAT_CHARGED", severity: "warning", detail: "A non-French supplier charged VAT: foreign VAT is not deductible on the French return (refund procedure in the supplier's country); it is included in the expense." });
  }
  if (loc === "NON_EU") {
    anomalies.push({ code: "NON_EU_SUPPLIER", severity: "warning", detail: "Supplier established outside the EU: import VAT / reverse charge must be reviewed manually." });
  }
  for (const l of lines) {
    if (l.isAsset) {
      anomalies.push({ code: "FIXED_ASSET_CAPITALISED", severity: "info", rule_id: "ASSET-THRESHOLD-500", detail: `Line ${l.index + 1} ("${l.description}", ${l.unitPrice.toFixed(2)} EUR excl. VAT per unit) is at or above the EUR ${FIXED_ASSET_THRESHOLD} threshold: capitalised in ${FIXED_ASSET_ACCOUNT.account}; set up a depreciation schedule.` });
    }
  }
  const nonDed = lines.filter((l) => !l.deductible && (regime.self_assessed ? selfVatPerLine[l.index] : vatPerLine[l.index]) !== 0);
  if (nonDed.length > 0 && profile.vat_regime !== "franchise" && !foreignVatCharged) {
    const gifts = nonDed.filter((l) => l.category.id === "gifts");
    const others = nonDed.filter((l) => l.category.id !== "gifts");
    if (others.length) anomalies.push({ code: "VAT_NOT_DEDUCTIBLE", severity: "info", rule_id: "VAT-DEDUCTIBILITY", detail: `VAT on ${others.map((l) => l.category.account_label).join(", ")} is excluded from deduction and added to the expense.` });
    if (gifts.length) anomalies.push({ code: "GIFT_VAT_THRESHOLD", severity: "warning", rule_id: "VAT-DEDUCTIBILITY", detail: "Gift above the per-beneficiary VAT deduction threshold (EUR 73 incl. VAT): VAT added to the expense. Keep the list of beneficiaries." });
  }
  if (regime.self_assessed) {
    anomalies.push({ code: "REVERSE_CHARGE_SELF_ASSESSED", severity: "info", rule_id: "VAT-REVERSE-CHARGE-ENTRY", detail: `VAT self-assessed at the French rate: ${formatEur(due4452)} due (4452) and deductible (${deductibleVat > 0 ? "44566/44562" : "not deductible"}); report it on the VAT return.` });
  }
  if (profile.accounting_basis === "cash") {
    anomalies.push({ code: "CASH_BASIS_CLIENT", severity: "info", rule_id: "BNC-CASH-BASIS", detail: `${profile.name} keeps cash-basis books (recettes-dépenses): the expense is recorded at the payment date in the receipts-expenses ledger; the entry below is the purchase view to be confirmed at payment.` });
    rules.add("BNC-CASH-BASIS");
  }

  // 6. VAT treatment summary ---------------------------------------------------
  const vatBreakdown = regime.self_assessed
    ? breakdownByRate(lines.map((l) => ({ baseCents: l.baseCents, rate: selfRate(l), computedVatCents: 0 }))).map((b) => ({ rate: b.rate, base: fromCents(b.baseCents), vat: fromCents(b.vatCents) }))
    : (() => {
        const m = new Map<number, { base: number; vat: number }>();
        lines.forEach((l, i) => {
          const cur = m.get(l.rate) ?? { base: 0, vat: 0 };
          m.set(l.rate, { base: cur.base + l.baseCents, vat: cur.vat + vatPerLine[i] });
        });
        return [...m.entries()].sort((a, b) => b[0] - a[0]).map(([rate, v]) => ({ rate, base: fromCents(v.base), vat: fromCents(v.vat) }));
      })();
  const mainRate = [...vatBreakdown].sort((a, b) => b.base - a.base || b.rate - a.rate)[0]?.rate ?? 0;
  const notes: string[] = [];
  if (regime.note) notes.push(regime.note);
  if (nonDed.length > 0 && !foreignVatCharged) notes.push(`${formatEur(nonDed.reduce((a, l) => a + (regime.self_assessed ? selfVatPerLine[l.index] : vatPerLine[l.index]), 0))} of VAT is not deductible and is included in the expense.`);
  const hasServicesVat = !regime.self_assessed && loc === "FR" && lines.some((l) => l.kind === "services" && l.rate > 0 && l.deductible);
  if (hasServicesVat && inv.vat_on_debits_option !== true) {
    notes.push("VAT on the services part becomes deductible when the invoice is paid (supplier has not opted for VAT on debits).");
    rules.add("VAT-SERVICES-EXIGIBILITY");
  }
  const vat: VatTreatment = {
    regime: regime.regime,
    rate: regime.regime === "exempt" || regime.regime === "out_of_scope" ? 0 : mainRate,
    deductible: deductibleVat > 0,
    breakdown: vatBreakdown,
    ...(regime.legal_basis_id ? { legal_basis_id: regime.legal_basis_id } : {}),
    ...(notes.length ? { note: notes.join(" ") } : {}),
  };

  // 7. Review reasons -------------------------------------------------------
  const reasons: string[] = [];
  const pushR = (r: string) => { if (!reasons.includes(r)) reasons.push(r); };
  if (compliance.status === "non_compliant") pushR("NON_COMPLIANT_INVOICE");
  for (const a of anomalies) if (a.severity !== "info") pushR(a.code);
  if (profile.accounting_basis === "cash") pushR("CASH_BASIS_CLIENT");
  if (meta.method === "llm" && meta.confidence < LLM_REVIEW_THRESHOLD) pushR("LLM_EXTRACTION_LOW_CONFIDENCE");
  if (!entry.balanced) pushR("UNBALANCED_ENTRY");

  const vatOk = tc.vatOk && tc.htOk && tc.ttcOk && !anomalies.some((a) => a.code === "VAT_RATE_MISMATCH" || a.code === "VAT_RATE_INVALID");
  const vat_consistency = {
    passed: vatOk,
    detail: vatOk
      ? `VAT ${inv.totals.total_vat.toFixed(2)} EUR is consistent with the lines and the expected rates.`
      : [
          !tc.vatOk ? `invoiced VAT ${inv.totals.total_vat.toFixed(2)} vs recomputed ${fromCents(tc.recomputedVatCents).toFixed(2)}` : "",
          !tc.htOk || !tc.ttcOk ? "totals inconsistent" : "",
          anomalies.some((a) => a.code === "VAT_RATE_MISMATCH") ? "unexpected VAT rate for the nature of the expense" : "",
          anomalies.some((a) => a.code === "VAT_RATE_INVALID") ? "invalid VAT rate" : "",
        ].filter(Boolean).join("; "),
  };

  return {
    invoice: inv, profile, summary: summaryOf(inv, explicitKinds ?? guessedNature), lines, regime, compliance, vat, entry, anomalies,
    review_reasons: reasons, rules_applied: [...rules], llm_used: llm_used || meta.method === "llm", vat_consistency, derived_nature: explicitKinds,
  };
}

// ---------------------------------------------------------------------------
// Confidence & explanation
// ---------------------------------------------------------------------------

export function computeConfidence(a: { compliance: Compliance; anomalies: Anomaly[]; method: EngineMeta["extraction_method"]; extraction_confidence: number; uncertain: number }): number {
  let c = 0.98;
  for (const chk of a.compliance.checks) {
    if (chk.passed) continue;
    if (chk.severity === "error") c -= 0.04;
    else if (chk.severity === "warning") c -= 0.02;
  }
  for (const an of a.anomalies) {
    if (an.code === "CLASSIFICATION_UNCERTAIN") continue;
    if (an.severity === "error") c -= 0.15;
    else if (an.severity === "warning") c -= 0.06;
  }
  c -= 0.15 * a.uncertain;
  if (a.method === "llm") c = Math.min(c, a.extraction_confidence) - 0.05;
  return Math.max(0.05, Math.min(0.98, Math.round(c * 100) / 100));
}

const REGIME_TEXT: Record<VatTreatment["regime"], string> = {
  standard: "standard 20% VAT",
  reduced: "reduced-rate VAT",
  mixed_rates: "several VAT rates",
  reverse_charge_intra_eu: "intra-EU reverse charge (VAT self-assessed)",
  exempt: "VAT exempt (no VAT invoiced)",
  out_of_scope: "outside the scope of French VAT",
};

function entryText(entry: JournalEntry): string {
  return entry.lines
    .map((l) => (l.debit > 0 ? `debit ${l.account} ${l.debit.toFixed(2)}` : `credit ${l.account} ${l.credit.toFixed(2)}`))
    .join(", ");
}

export function explainInvoice(a: InvoiceAnalysis, confidence: number, human: boolean): string {
  const inv = a.invoice;
  const doc = inv.document_type === "credit_note" ? "Credit note" : "Purchase invoice";
  const parts: string[] = [];
  parts.push(`${doc} ${inv.number} from ${inv.supplier.name} (${Math.abs(inv.totals.total_incl_vat).toFixed(2)} EUR incl. VAT) is booked in journal ${a.entry.journal}: ${entryText(a.entry)}.`);
  if (inv.document_type === "credit_note") parts.push("The original purchase entry is reversed (supplier debited, expense and VAT credited).");
  parts.push(`VAT treatment: ${REGIME_TEXT[a.vat.regime]}.`);
  const failed = a.compliance.checks.filter((c) => !c.passed && c.severity !== "info");
  parts.push(
    a.compliance.status === "compliant"
      ? "All mandatory invoice mentions checked are present."
      : `Invoice compliance: ${a.compliance.status.replace("_", "-")} (${failed.map((c) => c.rule_id).join(", ")}).`,
  );
  const important = a.anomalies.filter((x) => x.severity !== "info");
  if (important.length) parts.push(`Attention: ${important.map((x) => x.detail).join(" ")}`);
  if (a.profile.accounting_basis === "cash") parts.push(`${a.profile.name} keeps cash-basis (recettes-dépenses) books: record the expense at the payment date; VAT on these services is deductible once paid.`);
  parts.push(human ? `Human review required (${a.review_reasons.join(", ")}); confidence ${confidence.toFixed(2)}.` : `No human review needed; confidence ${confidence.toFixed(2)}.`);
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Public operations
// ---------------------------------------------------------------------------

function meta(rules: string[], llm_used: boolean, method: EngineMeta["extraction_method"], confidence: number): EngineMeta {
  return {
    version: ENGINE_VERSION,
    rules_applied: rules,
    llm_used,
    extraction_method: method,
    ...(method === "llm" ? { extraction_confidence: Math.round(confidence * 100) / 100 } : {}),
  };
}

export async function createEntry(input: EngineInput, ctx: EngineContext = {}): Promise<EntryResult> {
  const parsed = await parseInput(input, ctx);
  if (parsed.transaction) return bankEntry(parsed.transaction, parsed.candidate_invoices ?? [], ctx);
  return entryFromInvoice(parsed.invoice!, ctx, parsed.method, parsed.confidence);
}

export async function entryFromInvoice(inv: InvoiceInput, ctx: EngineContext, method: EngineMeta["extraction_method"] = "structured_json", extractionConfidence = 1): Promise<EntryResult> {
  const a = await analyseInvoice(inv, ctx, { method, confidence: extractionConfidence });
  const uncertain = a.lines.filter((l) => l.classification.confidence < CLASSIFICATION_THRESHOLD).length;
  const confidence = computeConfidence({ compliance: a.compliance, anomalies: a.anomalies, method, extraction_confidence: extractionConfidence, uncertain });
  const human = a.review_reasons.length > 0;
  return {
    invoice: a.summary,
    compliance: a.compliance,
    entry: a.entry,
    vat: a.vat,
    anomalies: a.anomalies,
    confidence,
    human_review_required: human,
    review_reasons: a.review_reasons,
    explanation: explainInvoice(a, confidence, human),
    engine: meta(a.rules_applied, a.llm_used, method, extractionConfidence),
    disclaimer: DISCLAIMER,
  };
}

export async function checkInvoice(input: EngineInput, ctx: EngineContext = {}): Promise<CheckResult> {
  const parsed = await parseInput(input, ctx);
  if (!parsed.invoice) {
    throw new EngineError("UNSUPPORTED_FORMAT", "invoice/check expects an invoice (json, facturx, ubl, pdf or image), not a bank transaction.");
  }
  const a = await analyseInvoice(parsed.invoice, ctx, { method: parsed.method, confidence: parsed.confidence });
  const failed = a.compliance.checks.filter((c) => !c.passed && c.severity !== "info");
  const important = a.anomalies.filter((x) => x.severity !== "info");
  const explanation = [
    `Invoice ${a.invoice.number} from ${a.invoice.supplier.name}: compliance ${a.compliance.status.replace("_", "-")}` +
      (failed.length ? ` — failing rules: ${failed.map((c) => c.rule_id).join(", ")}.` : " — all mandatory mentions checked are present."),
    `VAT consistency: ${a.vat_consistency.passed ? "passed" : "failed"} (${a.vat_consistency.detail.replace(/\.$/, "")}).`,
    important.length ? `Attention: ${important.map((x) => x.detail).join(" ")}` : "",
  ].filter(Boolean).join(" ");
  return {
    invoice: a.summary,
    compliance: a.compliance,
    vat_consistency: a.vat_consistency,
    anomalies: a.anomalies,
    explanation,
    engine: meta(a.rules_applied, a.llm_used, parsed.method, parsed.confidence),
    disclaimer: DISCLAIMER,
  };
}

// ---------------------------------------------------------------------------
// Bank transactions
// ---------------------------------------------------------------------------

function bankEntry(tx: BankTransactionInput, candidates: InvoiceInput[], ctx: EngineContext): EntryResult {
  const profile = ctx.profile ?? DEMO_PROFILE;
  const m = matchTransaction(tx, candidates);
  const amount = toCents(tx.amount);
  const abs = Math.abs(amount);
  const counter = m.invoice ? supplierAccount(m.invoice) : SUSPENSE_ACCOUNT;
  const lines: CentsLine[] =
    amount < 0
      ? [
          { account: counter.account, label: counter.label, debit: abs, credit: 0 },
          { account: BANK_ACCOUNT.account, label: BANK_ACCOUNT.label, debit: 0, credit: abs },
        ]
      : [
          { account: BANK_ACCOUNT.account, label: BANK_ACCOUNT.label, debit: abs, credit: 0 },
          { account: counter.account, label: counter.label, debit: 0, credit: abs },
        ];
  const entry = buildEntry("BQ", tx.date, m.invoice?.number ?? tx.reference ?? tx.label.slice(0, 40), lines);
  const anomalies: Anomaly[] = [];
  const reasons: string[] = [];
  if (!m.invoice) {
    anomalies.push({ code: "UNMATCHED_TRANSACTION", severity: "warning", rule_id: "BQ-MATCH-INVOICE", detail: `${m.detail} The amount is parked in the suspense account ${SUSPENSE_ACCOUNT.account} until the supporting document is found.` });
    reasons.push("UNMATCHED_TRANSACTION");
  } else if (m.score < 0.9) {
    anomalies.push({ code: "PARTIAL_MATCH", severity: "warning", rule_id: "BQ-MATCH-INVOICE", detail: `${m.detail} Match score ${m.score.toFixed(2)}: confirm the allocation.` });
    reasons.push("PARTIAL_MATCH");
  }
  if (profile.accounting_basis === "cash") {
    anomalies.push({ code: "CASH_BASIS_CLIENT", severity: "info", detail: "Cash-basis client: this payment date is the date at which the expense is recognised in the receipts-expenses ledger." });
  }
  const compliance: Compliance = {
    status: m.invoice ? "compliant" : "warning",
    checks: [{ rule_id: "BQ-MATCH-INVOICE", label: "Transaction matched to a candidate invoice", passed: !!m.invoice, severity: "warning", ...(m.invoice ? {} : { fix_hint: "Send the supporting invoice in candidate_invoices." }) }],
  };
  const summary: InvoiceSummary = m.invoice
    ? summaryOf(m.invoice)
    : {
        document_type: "invoice",
        number: "",
        date: tx.date,
        supplier: { name: tx.counterparty ?? "Unknown counterparty", country: "FR" },
        customer: { name: profile.name, siren: profile.siren, country: "FR" },
        totals: { total_excl_vat: 0, total_vat: 0, total_incl_vat: Math.abs(tx.amount) },
      };
  const confidence = Math.max(0.05, Math.min(0.98, Math.round((m.invoice ? 0.98 - (1 - m.score) * 0.5 : 0.5) * 100) / 100));
  const human = reasons.length > 0;
  const explanation = [
    `Bank ${amount < 0 ? "payment" : "receipt"} of ${(abs / 100).toFixed(2)} EUR on ${tx.date} ("${tx.label}") is booked in journal BQ: ${entryText(entry)}.`,
    m.invoice ? `${m.detail} The supplier account is settled.` : m.detail,
    "VAT was handled on the purchase entry; the payment entry carries no VAT.",
    human ? `Human review required (${reasons.join(", ")}); confidence ${confidence.toFixed(2)}.` : `No human review needed; confidence ${confidence.toFixed(2)}.`,
  ].join(" ");
  return {
    invoice: summary,
    compliance,
    entry,
    vat: { regime: "out_of_scope", rate: 0, deductible: false, breakdown: [], note: "Payment entry: VAT is recorded on the purchase entry (accrual basis)." },
    anomalies,
    confidence,
    human_review_required: human,
    review_reasons: reasons,
    explanation,
    match: { matched_invoice_number: m.invoice?.number ?? null, score: m.score, detail: m.detail },
    engine: meta(["BQ-MATCH-INVOICE", "BALANCE-CHECK"], false, "bank_transaction", 1),
    disclaimer: DISCLAIMER,
  };
}
