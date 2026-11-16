/**
 * Ajean Ledger — shared contract types.
 *
 * This file is the single source of truth for the data exchanged between
 * the engine, the paid API, the MCP server, the demo agent and the console.
 * The response shape follows master prompt §5.4. Amounts are numbers rounded
 * to 2 decimals. Every rule has a stable `rule_id`.
 */

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export type Iso2 = string; // ISO 3166-1 alpha-2 country code, e.g. "FR", "DE"

export interface Party {
  name: string;
  /** French SIREN (9 digits). Fictional in all fixtures. */
  siren?: string;
  /** Intra-EU VAT id, e.g. "FR12345678901". */
  vat_id?: string;
  country: Iso2;
  address?: string;
  /** Auxiliary account code suggested by the caller (optional). */
  account_code?: string;
  /**
   * Company size of the party (optional; used for the supplier). Drives the
   * e-invoicing reform timeline: issuance is mandatory for large and mid-size
   * companies from 1 Sept 2026, for SMEs and micro-businesses from 1 Sept 2027
   * (ADR-019). "large" = GE, "mid" = ETI, "sme" = PME, "micro" = micro-entreprise.
   */
  company_size?: "large" | "mid" | "sme" | "micro";
}

export type OperationNature = "goods" | "services" | "mixed";

export interface InvoiceLine {
  description: string;
  quantity: number;
  unit_price_excl_vat: number;
  /** 0.2, 0.1, 0.055, 0.021 or 0 */
  vat_rate: number;
  /** Line total excl. VAT. If omitted it is computed as quantity * unit price. */
  total_excl_vat?: number;
  /** Optional hint from the caller; the engine classifies the line anyway. */
  category_hint?: string;
  /** "goods" or "services" for this line (used to derive the operation nature). */
  kind?: "goods" | "services";
}

export interface InvoiceInput {
  document_type: "invoice" | "credit_note";
  number: string;
  issue_date: string; // YYYY-MM-DD
  due_date?: string;
  currency: "EUR";
  supplier: Party;
  customer: Party;
  /** Delivery address, only when different from the customer address. */
  delivery_address?: string;
  /** New e-invoicing mention: goods / services / mixed. */
  operation_nature?: OperationNature;
  /** New e-invoicing mention: supplier opted to pay VAT on debits. */
  vat_on_debits_option?: boolean;
  lines: InvoiceLine[];
  totals: {
    total_excl_vat: number;
    total_vat: number;
    total_incl_vat: number;
  };
  payment_terms?: string;
  late_payment_penalties?: string;
  /** "Indemnité forfaitaire pour frais de recouvrement de 40 €" mention present. */
  fixed_recovery_indemnity_mention?: boolean;
  /** Free-text legal mentions printed on the invoice (e.g. VAT exemption, reverse charge). */
  legal_mentions?: string[];
  /** For credit notes: number of the original invoice. */
  original_invoice_number?: string;
}

export interface BankTransactionInput {
  date: string; // YYYY-MM-DD
  label: string;
  /** Negative = debit on the bank account (money out). */
  amount: number;
  currency: "EUR";
  counterparty?: string;
  /** Optional invoice reference the agent wants to match against. */
  reference?: string;
}

/**
 * Profile of the entity whose books are kept (the agent's operator's client).
 * Defaults to the fictional demo SME "Atelier Lumenor SAS (fictional)".
 */
export interface ClientProfile {
  name: string;
  siren: string;
  legal_form?: string;
  /** "commercial" = BIC/IS company, "bnc" = liberal profession (e.g. lawyer). */
  activity: "commercial" | "bnc";
  /** accrual = engagement accounting (PCG); cash = recettes-dépenses (typical BNC). */
  accounting_basis: "accrual" | "cash";
  vat_regime: "standard" | "franchise";
  vat_on_debits?: boolean;
}

/** Minimal fingerprint used for duplicate detection (stateless engine). */
export interface InvoiceFingerprint {
  supplier_key: string; // SIREN, VAT id or normalised name
  number: string;
  issue_date: string;
  total_incl_vat: number;
  /** Optional: documents of different types (invoice vs credit note) are never flagged as duplicates of each other. */
  document_type?: "invoice" | "credit_note";
}

export type EngineInput =
  | { format: "json"; invoice: InvoiceInput }
  | { format: "facturx"; document_base64: string }
  | { format: "ubl"; xml: string }
  | { format: "bank_transaction"; transaction: BankTransactionInput; candidate_invoices?: InvoiceInput[] }
  | { format: "pdf" | "image"; document_base64: string; mime_type?: string };

export interface EngineContext {
  profile?: ClientProfile;
  /** Previously processed invoices for duplicate detection. */
  history?: InvoiceFingerprint[];
  /** Optional LLM hook; when absent the engine is fully deterministic. */
  llm?: LlmAdapter;
  /** Optional override of the statutory-auditor materiality threshold used by audit (EUR, default 5000). */
  materiality_threshold?: number;
}

export interface LlmAdapter {
  model: string;
  /** Extract an InvoiceInput from an unstructured document. */
  extractInvoice(doc: { base64: string; mime_type: string }): Promise<{ invoice: InvoiceInput; confidence: number }>;
  /** Classify an ambiguous description into one of the known expense category ids. */
  classifyExpense(description: string, categories: string[]): Promise<{ category: string; confidence: number }>;
}

// ---------------------------------------------------------------------------
// Outputs (§5.4)
// ---------------------------------------------------------------------------

export type Severity = "error" | "warning" | "info";

export interface ComplianceCheck {
  rule_id: string; // e.g. "FR-EINV-SIREN-BUYER"
  label: string;
  passed: boolean;
  severity: Severity;
  fix_hint?: string;
  /** Id in the curated legal-basis table (engine/rules/legal-basis.ts). */
  legal_basis_id?: string;
}

export interface Compliance {
  status: "compliant" | "non_compliant" | "warning";
  checks: ComplianceCheck[];
}

export interface EntryLine {
  account: string;
  label: string;
  debit: number;
  credit: number;
}

export interface JournalEntry {
  journal: "HA" | "BQ" | "OD";
  date: string;
  reference: string;
  lines: EntryLine[];
  balanced: boolean;
}

export type VatRegime =
  | "standard"
  | "reduced"
  | "reverse_charge_intra_eu"
  /** Services bought from a supplier established outside the EU: VAT self-assessed by the buyer (to be booked after review). */
  | "reverse_charge_non_eu"
  | "exempt"
  | "out_of_scope"
  | "mixed_rates";

export interface VatTreatment {
  regime: VatRegime;
  /** Main rate (the highest-weight rate for multi-rate invoices). */
  rate: number;
  deductible: boolean;
  /** Breakdown per rate. */
  breakdown: { rate: number; base: number; vat: number }[];
  legal_basis_id?: string;
  note?: string;
}

export interface Anomaly {
  code: string; // e.g. "DUPLICATE_SUSPECTED", "VAT_RATE_MISMATCH"
  detail: string;
  severity: Severity;
  rule_id?: string;
}

export interface InvoiceSummary {
  document_type: InvoiceInput["document_type"];
  number: string;
  date: string;
  supplier: Party;
  customer: Party;
  operation_nature?: OperationNature;
  totals: InvoiceInput["totals"];
}

export interface EngineMeta {
  version: string;
  rules_applied: string[];
  llm_used: boolean;
  extraction_method: "structured_json" | "facturx_cii" | "ubl" | "bank_transaction" | "llm";
  extraction_confidence?: number;
}

/** Result of POST /api/v1/entry (without request_id / receipt, added by the API layer). */
export interface EntryResult {
  invoice: InvoiceSummary;
  compliance: Compliance;
  entry: JournalEntry;
  vat: VatTreatment;
  anomalies: Anomaly[];
  confidence: number;
  human_review_required: boolean;
  /** Reasons that triggered human review (machine-readable codes). */
  review_reasons: string[];
  explanation: string;
  /** Bank matching result, only for format = bank_transaction. */
  match?: { matched_invoice_number: string | null; score: number; detail: string };
  engine: EngineMeta;
  disclaimer: string;
}

/** Result of POST /api/v1/invoice/check. */
export interface CheckResult {
  invoice: InvoiceSummary;
  compliance: Compliance;
  vat_consistency: { passed: boolean; detail: string };
  anomalies: Anomaly[];
  explanation: string;
  engine: EngineMeta;
  disclaimer: string;
}

export interface AuditEntryInput {
  /** Either an already-booked entry (FEC-like) or an invoice to book and audit. */
  entry?: JournalEntry & { supplier_key?: string; invoice_number?: string; total_incl_vat?: number };
  invoice?: InvoiceInput;
}

export interface ExpertViewpoint {
  role: "statutory_auditor" | "tax_inspector";
  overall_risk: "low" | "medium" | "high";
  /** Materiality threshold used (statutory auditor) in EUR. */
  materiality_threshold?: number;
  findings: { code: string; entry_ref: string; detail: string; risk: "low" | "medium" | "high"; recommendation: string }[];
  summary: string;
}

/** Result of POST /api/v1/audit. */
export interface AuditResult {
  entries_audited: number;
  totals: { debit: number; credit: number; balanced: boolean };
  anomalies: (Anomaly & { entry_ref: string })[];
  viewpoints: { statutory_auditor: ExpertViewpoint; tax_inspector: ExpertViewpoint };
  human_review_required: boolean;
  explanation: string;
  engine: EngineMeta;
  disclaimer: string;
}

export const DISCLAIMER =
  "Proof of concept on synthetic data. Not a substitute for a chartered accountant's review.";
