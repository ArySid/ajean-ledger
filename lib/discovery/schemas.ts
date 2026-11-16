/**
 * Zod schemas of the public contract (engine/types.ts + lib/api/envelope.ts + receipt).
 *
 * One definition, three consumers:
 *   - the MCP tools (remote /mcp and the stdio bridge) use the request schemas as tool input schemas;
 *   - openapi.json turns every registered schema into `components.schemas` ($ref'd);
 *   - tests check that fixtures validate against them.
 *
 * IMPORTANT: relative imports only (no "@/…", no "next/…"), because the stdio MCP bridge
 * (mcp/server.ts) imports this file through tsx from any working directory.
 */
import { z } from "zod";
import { AUDIT_MAX_ITEMS, NETWORK_CAIP2, NETWORK_NAME, USDC, X402_VERSION } from "../payments/pricing";

/** Registry of named schemas → OpenAPI `components.schemas` entries. */
export const contractRegistry = z.registry<{ id: string }>();
function named<T extends z.ZodType>(id: string, schema: T): T {
  contractRegistry.add(schema, { id });
  return schema;
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Date, YYYY-MM-DD");
const money = z.number().describe("Amount in EUR, number with 2 decimals");
const severity = named("Severity", z.enum(["error", "warning", "info"]));

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export const PartySchema = named(
  "Party",
  z
    .object({
      name: z.string().min(1),
      siren: z.string().regex(/^\d{9}$/).optional().describe("French SIREN (9 digits). Fictional in all examples."),
      vat_id: z.string().optional().describe('Intra-EU VAT id, e.g. "FR29000001008"'),
      country: z.string().regex(/^[A-Za-z]{2}$/).describe("ISO 3166-1 alpha-2 country code, e.g. FR, DE"),
      address: z.string().optional(),
      account_code: z.string().optional().describe("Auxiliary account code suggested by the caller"),
      company_size: z
        .enum(["large", "mid", "sme", "micro"])
        .optional()
        .describe(
          "Supplier size (large = GE, mid = ETI, sme = PME, micro). Drives the e-invoicing reform timeline: new mentions are errors from 2026-09-01 for large/mid issuers and from 2027-09-01 for everyone; warnings in between.",
        ),
    })
    .describe("Supplier or customer."),
);

export const InvoiceLineSchema = named(
  "InvoiceLine",
  z.object({
    description: z.string(),
    quantity: z.number(),
    unit_price_excl_vat: z.number(),
    vat_rate: z.number().min(0).max(1).describe("0.2, 0.1, 0.055, 0.021 or 0"),
    total_excl_vat: z.number().optional().describe("Line total excl. VAT; computed as quantity × unit price when omitted"),
    category_hint: z.string().optional().describe("Optional hint; the engine classifies the line anyway"),
    kind: z.enum(["goods", "services"]).optional(),
  }),
);

export const InvoiceTotalsSchema = named(
  "InvoiceTotals",
  z.object({ total_excl_vat: money, total_vat: money, total_incl_vat: money }),
);

export const InvoiceInputSchema = named(
  "InvoiceInput",
  z
    .object({
      document_type: z.enum(["invoice", "credit_note"]),
      number: z.string(),
      issue_date: date,
      due_date: date.optional(),
      currency: z.literal("EUR"),
      supplier: PartySchema,
      customer: PartySchema,
      delivery_address: z.string().optional().describe("Only when different from the customer address (2026 reform mention)"),
      operation_nature: z.enum(["goods", "services", "mixed"]).optional().describe("2026 reform mention: nature of the operation"),
      vat_on_debits_option: z.boolean().optional().describe("2026 reform mention: supplier opted to pay VAT on debits"),
      lines: z.array(InvoiceLineSchema).min(1).max(500),
      totals: InvoiceTotalsSchema,
      payment_terms: z.string().optional(),
      late_payment_penalties: z.string().optional(),
      fixed_recovery_indemnity_mention: z.boolean().optional().describe("The €40 fixed recovery indemnity mention is printed (B2B)"),
      legal_mentions: z.array(z.string()).optional().describe("Free-text legal mentions (VAT exemption, reverse charge…)"),
      original_invoice_number: z.string().optional().describe("Credit notes: number of the original invoice"),
    })
    .describe("Structured French invoice or credit note (Ajean Ledger JSON schema)."),
);

export const BankTransactionSchema = named(
  "BankTransactionInput",
  z.object({
    date,
    label: z.string().min(1),
    amount: z.number().describe("Negative = money out of the bank account"),
    currency: z.literal("EUR"),
    counterparty: z.string().optional(),
    reference: z.string().optional().describe("Invoice reference to match against"),
  }),
);

export const ClientProfileSchema = named(
  "ClientProfile",
  z
    .object({
      name: z.string().min(1),
      siren: z.string().regex(/^\d{9}$/),
      legal_form: z.string().optional(),
      activity: z.enum(["commercial", "bnc"]).describe('"commercial" = BIC/IS company, "bnc" = liberal profession'),
      accounting_basis: z.enum(["accrual", "cash"]),
      vat_regime: z.enum(["standard", "franchise"]),
      vat_on_debits: z.boolean().optional(),
    })
    .describe('Entity whose books are kept. Default: the fictional demo SME "Atelier Lumenor SAS (fictional)".'),
);

export const InvoiceFingerprintSchema = named(
  "InvoiceFingerprint",
  z
    .object({
      supplier_key: z.string().min(1).describe("SIREN, VAT id or normalised name"),
      number: z.string().min(1),
      issue_date: z.string().min(1),
      total_incl_vat: z.number(),
      document_type: z.enum(["invoice", "credit_note"]).optional(),
    })
    .describe("Previously booked invoice, for duplicate detection (the engine is stateless)."),
);

const base64 = z.string().min(1).describe("Base64-encoded file");

export const JsonInvoiceInputSchema = named(
  "JsonInvoiceInput",
  z.object({ format: z.literal("json"), invoice: InvoiceInputSchema }).describe("Structured JSON invoice."),
);
export const FacturxInputSchema = named(
  "FacturxInput",
  z
    .object({ format: z.literal("facturx"), document_base64: base64 })
    .describe("Factur-X / ZUGFeRD PDF (base64); the embedded CII XML is extracted."),
);
export const UblInputSchema = named(
  "UblInput",
  z.object({ format: z.literal("ubl"), xml: z.string().min(1).describe("UBL 2.1 Invoice / CreditNote XML") }).describe("UBL 2.1 XML."),
);
export const BankTransactionEngineInputSchema = named(
  "BankTransactionEngineInput",
  z
    .object({
      format: z.literal("bank_transaction"),
      transaction: BankTransactionSchema,
      candidate_invoices: z.array(InvoiceInputSchema).max(200).optional().describe("Invoices to match the transaction against"),
    })
    .describe("Bank transaction (POST /api/v1/entry only)."),
);
export const DocumentInputSchema = named(
  "DocumentInput",
  z
    .object({
      format: z.enum(["pdf", "image"]),
      document_base64: base64,
      mime_type: z.string().optional().describe("e.g. application/pdf, image/png"),
    })
    .describe('Plain PDF or image: best-effort LLM extraction (engine.extraction_method = "llm" + confidence). Needs the LLM layer, else 503 LLM_UNAVAILABLE.'),
);

/** input accepted by POST /api/v1/entry (create_entry). */
export const EntryEngineInputSchema = named(
  "EntryEngineInput",
  z.discriminatedUnion("format", [
    JsonInvoiceInputSchema,
    FacturxInputSchema,
    UblInputSchema,
    BankTransactionEngineInputSchema,
    DocumentInputSchema,
  ]),
);
/** input accepted by POST /api/v1/invoice/check (check_invoice): same without bank_transaction. */
export const CheckEngineInputSchema = named(
  "CheckEngineInput",
  z.discriminatedUnion("format", [JsonInvoiceInputSchema, FacturxInputSchema, UblInputSchema, DocumentInputSchema]),
);

const profile = ClientProfileSchema.optional();
const history = z.array(InvoiceFingerprintSchema).max(5000).optional().describe("Previously booked invoices (duplicate detection)");

export const CheckInvoiceRequestSchema = named(
  "CheckInvoiceRequest",
  z.object({ input: CheckEngineInputSchema, profile, history }).describe("Body of POST /api/v1/invoice/check."),
);

export const CreateEntryRequestSchema = named(
  "CreateEntryRequest",
  z
    .object({
      input: EntryEngineInputSchema,
      profile,
      history,
      use_server_history: z
        .boolean()
        .optional()
        .describe("Opt-in: also use invoices previously booked through this service for the same client SIREN (duplicate detection across calls)"),
    })
    .describe("Body of POST /api/v1/entry."),
);

export const EntryLineSchema = named(
  "EntryLine",
  z.looseObject({ account: z.string().describe("PCG account, e.g. 6064, 44566, 401XXXX"), label: z.string(), debit: money, credit: money }),
);

export const JournalEntrySchema = named(
  "JournalEntry",
  z.looseObject({
    journal: z.enum(["HA", "BQ", "OD"]).describe("HA = purchases, BQ = bank, OD = miscellaneous"),
    date: z.string(),
    reference: z.string(),
    lines: z.array(EntryLineSchema),
    balanced: z.boolean().describe("Total debits = total credits"),
  }),
);

export const AuditEntryInputSchema = named(
  "AuditEntryInput",
  z
    .object({
      entry: JournalEntrySchema.extend({
        supplier_key: z.string().optional(),
        invoice_number: z.string().optional(),
        total_incl_vat: z.number().optional(),
      })
        .optional()
        .describe("Already-booked entry (FEC-like)"),
      invoice: InvoiceInputSchema.optional().describe("Invoice to book and audit"),
    })
    .describe('One audit item: "entry" or "invoice" (at least one).'),
);

export const AuditRequestSchema = named(
  "AuditRequest",
  z
    .object({ items: z.array(AuditEntryInputSchema).min(1).max(AUDIT_MAX_ITEMS), profile })
    .describe(`Body of POST /api/v1/audit (1..${AUDIT_MAX_ITEMS} items).`),
);

// ---------------------------------------------------------------------------
// Outputs (engine/types.ts §5.4)
// ---------------------------------------------------------------------------

export const ComplianceCheckSchema = named(
  "ComplianceCheck",
  z.looseObject({
    rule_id: z.string().describe('Stable rule id, e.g. "FR-EINV-SIREN-BUYER"'),
    label: z.string(),
    passed: z.boolean(),
    severity,
    fix_hint: z.string().optional(),
    legal_basis_id: z.string().optional().describe("Id in the curated legal-basis table of the engine"),
  }),
);

export const ComplianceSchema = named(
  "Compliance",
  z.looseObject({ status: z.enum(["compliant", "non_compliant", "warning"]), checks: z.array(ComplianceCheckSchema) }),
);

export const VatTreatmentSchema = named(
  "VatTreatment",
  z.looseObject({
    regime: z.enum(["standard", "reduced", "reverse_charge_intra_eu", "reverse_charge_non_eu", "exempt", "out_of_scope", "mixed_rates"]),
    rate: z.number().describe("Main rate (highest-weight rate for multi-rate invoices)"),
    deductible: z.boolean(),
    breakdown: z.array(z.looseObject({ rate: z.number(), base: money, vat: money })),
    legal_basis_id: z.string().optional(),
    note: z.string().optional(),
  }),
);

export const AnomalySchema = named(
  "Anomaly",
  z.looseObject({
    code: z.string().describe('e.g. "DUPLICATE_SUSPECTED", "VAT_RATE_MISMATCH"'),
    detail: z.string(),
    severity,
    rule_id: z.string().optional(),
  }),
);

export const InvoiceSummarySchema = named(
  "InvoiceSummary",
  z.looseObject({
    document_type: z.enum(["invoice", "credit_note"]),
    number: z.string(),
    date: z.string(),
    supplier: PartySchema,
    customer: PartySchema,
    operation_nature: z.enum(["goods", "services", "mixed"]).optional(),
    totals: InvoiceTotalsSchema,
  }),
);

export const EngineMetaSchema = named(
  "EngineMeta",
  z.looseObject({
    version: z.string(),
    rules_applied: z.array(z.string()),
    llm_used: z.boolean(),
    extraction_method: z.enum(["structured_json", "facturx_cii", "ubl", "bank_transaction", "llm"]),
    extraction_confidence: z.number().optional(),
  }),
);

export const EntryResultSchema = named(
  "EntryResult",
  z.looseObject({
    invoice: InvoiceSummarySchema,
    compliance: ComplianceSchema,
    entry: JournalEntrySchema,
    vat: VatTreatmentSchema,
    anomalies: z.array(AnomalySchema),
    confidence: z.number().min(0).max(1),
    human_review_required: z.boolean(),
    review_reasons: z.array(z.string()).describe("Machine-readable reasons that triggered human review"),
    explanation: z.string().describe("One short paragraph an agent can relay to its operator"),
    match: z
      .looseObject({ matched_invoice_number: z.string().nullable(), score: z.number(), detail: z.string() })
      .optional()
      .describe("Bank matching result (format = bank_transaction only)"),
    engine: EngineMetaSchema,
    disclaimer: z.string(),
  }),
);

export const CheckResultSchema = named(
  "CheckResult",
  z.looseObject({
    invoice: InvoiceSummarySchema,
    compliance: ComplianceSchema,
    vat_consistency: z.looseObject({ passed: z.boolean(), detail: z.string() }),
    anomalies: z.array(AnomalySchema),
    explanation: z.string(),
    engine: EngineMetaSchema,
    disclaimer: z.string(),
  }),
);

const risk = z.enum(["low", "medium", "high"]);
export const ExpertViewpointSchema = named(
  "ExpertViewpoint",
  z.looseObject({
    role: z.enum(["statutory_auditor", "tax_inspector"]),
    overall_risk: risk,
    materiality_threshold: z.number().optional().describe("EUR (statutory auditor)"),
    findings: z.array(
      z.looseObject({ code: z.string(), entry_ref: z.string(), detail: z.string(), risk, recommendation: z.string() }),
    ),
    summary: z.string(),
  }),
);

export const AuditResultSchema = named(
  "AuditResult",
  z.looseObject({
    entries_audited: z.number().int(),
    totals: z.looseObject({ debit: money, credit: money, balanced: z.boolean() }),
    anomalies: z.array(AnomalySchema.extend({ entry_ref: z.string() })),
    viewpoints: z.looseObject({ statutory_auditor: ExpertViewpointSchema, tax_inspector: ExpertViewpointSchema }),
    human_review_required: z.boolean(),
    explanation: z.string(),
    engine: EngineMetaSchema,
    disclaimer: z.string(),
  }),
);

export const ReceiptSchema = named(
  "Receipt",
  z
    .looseObject({
      amount: z.string().describe('USDC paid, e.g. "0.15"'),
      amount_atomic: z.string().describe('Same in atomic units (6 decimals), e.g. "150000"'),
      asset: z.literal(USDC.symbol),
      network: z.literal(NETWORK_NAME),
      network_caip2: z.literal(NETWORK_CAIP2),
      tx_hash: z.string().describe("Settlement transaction hash (simulated mode: fake 0x5151… hash)"),
      payer: z.string().nullable(),
      pay_to: z.string(),
      explorer_url: z.string().nullable().describe("Base Sepolia explorer link; null in simulated mode"),
      mode: z.enum(["testnet", "simulated"]),
      paid_at: z.string().describe("ISO 8601"),
    })
    .describe("Payment receipt attached to every paid response."),
);

const requestId = z.string().regex(/^req_[0-9A-HJKMNP-TV-Z]{26}$/).describe("req_… (also in the X-Request-Id header)");
const paidEnvelope = { request_id: requestId, receipt: ReceiptSchema };

export const EntryResponseSchema = named("EntryResponse", EntryResultSchema.extend(paidEnvelope).describe("200 of POST /api/v1/entry."));
export const CheckResponseSchema = named("CheckResponse", CheckResultSchema.extend(paidEnvelope).describe("200 of POST /api/v1/invoice/check."));
export const AuditResponseSchema = named("AuditResponse", AuditResultSchema.extend(paidEnvelope).describe("200 of POST /api/v1/audit."));

export const ReceiptLookupSchema = named(
  "ReceiptLookup",
  z
    .looseObject({
      request_id: requestId,
      endpoint: z.enum(["invoice_check", "entry", "audit"]),
      created_at: z.string(),
      idempotency_key_used: z.boolean(),
      receipt: ReceiptSchema,
      result: z.looseObject({}).describe("The original result (EntryResult | CheckResult | AuditResult)"),
    })
    .describe("200 of GET /api/v1/receipts/{id}."),
);

// x402 v2 wire objects (decoded base64 JSON headers)
export const PaymentRequirementsSchema = named(
  "PaymentRequirements",
  z.looseObject({
    scheme: z.literal("exact"),
    network: z.literal(NETWORK_CAIP2),
    amount: z.string().describe("Price in USDC atomic units (6 decimals)"),
    asset: z.literal(USDC.address).describe("USDC contract on Base Sepolia"),
    payTo: z.string().describe("Service wallet"),
    maxTimeoutSeconds: z.number().int(),
    extra: z.looseObject({ name: z.string(), version: z.string() }).describe("EIP-712 domain of the token"),
  }),
);

export const PaymentRequiredSchema = named(
  "PaymentRequired",
  z
    .looseObject({
      x402Version: z.literal(X402_VERSION),
      error: z.string().optional(),
      resource: z.looseObject({ url: z.string(), description: z.string().optional(), mimeType: z.string().optional() }),
      accepts: z.array(PaymentRequirementsSchema).min(1),
      extensions: z.looseObject({}).optional(),
    })
    .describe("Decoded PAYMENT-REQUIRED header (base64 JSON), x402 v2."),
);

export const PaymentPayloadSchema = named(
  "PaymentPayload",
  z
    .looseObject({
      x402Version: z.literal(X402_VERSION),
      resource: z.looseObject({ url: z.string() }).optional(),
      accepted: PaymentRequirementsSchema,
      payload: z.looseObject({}).describe("Exact EVM scheme: { signature, authorization (EIP-3009 transferWithAuthorization) }"),
      extensions: z.looseObject({}).optional(),
    })
    .describe("Decoded PAYMENT-SIGNATURE header (base64 JSON), x402 v2."),
);

export const SettleResponseSchema = named(
  "SettleResponse",
  z
    .looseObject({
      success: z.boolean(),
      transaction: z.string(),
      network: z.string(),
      payer: z.string().optional(),
      amount: z.string().optional(),
      errorReason: z.string().optional(),
    })
    .describe("Decoded PAYMENT-RESPONSE header (base64 JSON), x402 v2."),
);

export const ErrorResponseSchema = named(
  "ErrorResponse",
  z
    .looseObject({
      error: z.looseObject({
        code: z.string(),
        message: z.string(),
        details: z.unknown().optional(),
        docs_url: z.string().describe("/llms.txt#errors"),
      }),
      request_id: requestId.optional(),
    })
    .describe("Every error (status >= 400). The call is never charged."),
);

/** All named schemas as JSON Schema (draft 2020-12 = OpenAPI 3.1), refs to #/components/schemas/<id>. */
export function contractJsonSchemas(): Record<string, Record<string, unknown>> {
  const out = z.toJSONSchema(contractRegistry, {
    target: "draft-2020-12",
    uri: (id) => `#/components/schemas/${id}`,
    unrepresentable: "any",
  }) as { schemas: Record<string, Record<string, unknown>> };
  const clean: Record<string, Record<string, unknown>> = {};
  for (const [id, s] of Object.entries(out.schemas)) {
    const { $schema: _s, $id: _i, ...rest } = s;
    clean[id] = rest;
  }
  return clean;
}
