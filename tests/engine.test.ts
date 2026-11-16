import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  CATEGORY_IDS, DEMO_PROFILE, EngineError, LEGAL_BASES, auditEntries, checkInvoice, classifyLine, createAnthropicAdapter, createEntry,
  fingerprint, parseInput, publicLegalBasis, type AuditEntryInput, type EngineInput, type EntryResult, type InvoiceInput, type LlmAdapter,
} from "@/engine";
import { allocate, round2, toCents, vatCents } from "@/engine/money";
import { buildEntry, isBalanced } from "@/engine/entry";
import { auxiliaryCode, isValidSiren } from "@/engine/text";
import { invoiceToCii } from "@/engine/parsers/cii-writer";
import { parseCii } from "@/engine/parsers/cii";
import { loadFixture } from "@/fixtures/loader";
import path from "node:path";

const FX = (n: string) => loadFixture(path.resolve(__dirname, `../fixtures/${n}.json`));
const inv1 = (): InvoiceInput => structuredClone((FX("01").input as { invoice: InvoiceInput }).invoice);
const inv10 = (): InvoiceInput => structuredClone((FX("10").input as { invoice: InvoiceInput }).invoice);
const inv4 = (): InvoiceInput => structuredClone((FX("04").input as { invoice: InvoiceInput }).invoice);
const entry = (invoice: InvoiceInput, ctx = {}) => createEntry({ format: "json", invoice }, ctx);
const failing = (r: { compliance: { checks: { passed: boolean; rule_id: string; severity: string }[] } }) =>
  r.compliance.checks.filter((c) => !c.passed && c.severity !== "info").map((c) => c.rule_id);
const codes = (r: EntryResult) => r.anomalies.map((a) => a.code);
const sumSide = (r: EntryResult) => ({
  d: r.entry.lines.reduce((a, l) => a + Math.round(l.debit * 100), 0),
  c: r.entry.lines.reduce((a, l) => a + Math.round(l.credit * 100), 0),
});

async function expectEngineError(p: Promise<unknown>, code: string): Promise<EngineError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(EngineError);
    expect((e as EngineError).code).toBe(code);
    return e as EngineError;
  }
  throw new Error(`expected EngineError ${code}`);
}

function mockLlm(over: Partial<LlmAdapter> = {}): LlmAdapter {
  return {
    model: "mock",
    extractInvoice: async () => ({ invoice: inv1(), confidence: 0.82 }),
    classifyExpense: async () => ({ category: "software_subscription", confidence: 0.92 }),
    ...over,
  };
}

// ---------------------------------------------------------------------------
describe("money, rounding and balance", () => {
  it("converts to integer cents without float artefacts", () => {
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(1.005)).toBe(101);
    expect(toCents(-168)).toBe(-16800);
    expect(round2(29.199999)).toBe(29.2);
  });
  it("rounds VAT half away from zero", () => {
    expect(vatCents(2525, 0.2)).toBe(505);
    expect(vatCents(1005, 0.055)).toBe(55); // 55.275 -> 55
    expect(vatCents(1010, 0.055)).toBe(56); // 55.55 -> 56
  });
  it("allocates exactly (largest remainder)", () => {
    const parts = allocate(1000, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(parts).toEqual([334, 333, 333]);
  });
  it("builds balanced entries and detects unbalanced ones", () => {
    const e = buildEntry("HA", "2026-10-01", "X", [
      { account: "6064", label: "a", debit: 1000, credit: 0 },
      { account: "44566", label: "b", debit: 200, credit: 0 },
      { account: "401X", label: "c", debit: 0, credit: 1200 },
    ]);
    expect(e.balanced).toBe(true);
    expect(isBalanced([{ debit: 10.1, credit: 0 }, { debit: 0, credit: 10.09 }])).toBe(false);
  });
  it("every engine entry balances to the cent, including rounding-heavy invoices", async () => {
    const inv = inv1();
    inv.lines = [
      { description: "Ramettes papier", quantity: 3, unit_price_excl_vat: 3.33, vat_rate: 0.2, kind: "goods" },
      { description: "Stylos", quantity: 7, unit_price_excl_vat: 1.17, vat_rate: 0.2, kind: "goods" },
      { description: "Livre de comptabilité", quantity: 1, unit_price_excl_vat: 12.99, vat_rate: 0.055, kind: "goods" },
    ];
    // 9.99 + 8.19 = 18.18 @20% = 3.636 -> 3.64 ; 12.99 @5.5% = 0.71
    inv.totals = { total_excl_vat: 31.17, total_vat: 4.35, total_incl_vat: 35.52 };
    const r = await entry(inv);
    const s = sumSide(r);
    expect(s.d).toBe(s.c);
    expect(r.entry.balanced).toBe(true);
    expect(r.vat.regime).toBe("mixed_rates");
    expect(r.compliance.status).toBe("compliant");
  });
});

// ---------------------------------------------------------------------------
describe("mandatory mentions", () => {
  const cases: [string, (i: InvoiceInput) => void][] = [
    ["FR-INV-NUMBER", (i) => (i.number = "")],
    ["FR-INV-SUPPLIER-ADDRESS", (i) => delete i.supplier.address],
    ["FR-INV-CUSTOMER-ADDRESS", (i) => delete i.customer.address],
    ["FR-INV-SUPPLIER-SIREN", (i) => (i.supplier.siren = "000001017")],
    ["FR-INV-SUPPLIER-VATID", (i) => delete i.supplier.vat_id],
    ["FR-INV-LINE-DESCRIPTION", (i) => (i.lines[1].description = " ")],
    ["FR-INV-LINE-QUANTITY", (i) => (i.lines[0].quantity = 0)],
    ["FR-INV-PAYMENT-DUE-DATE", (i) => { delete i.due_date; delete i.payment_terms; }],
    ["FR-INV-LATE-PENALTIES", (i) => delete i.late_payment_penalties],
    ["FR-INV-RECOVERY-INDEMNITY", (i) => (i.fixed_recovery_indemnity_mention = false)],
    ["FR-EINV-SIREN-BUYER", (i) => delete i.customer.siren],
    ["FR-EINV-OPERATION-NATURE", (i) => delete i.operation_nature],
  ];
  for (const [rule, mutate] of cases) {
    it(`flags ${rule}`, async () => {
      const i = inv1();
      mutate(i);
      const r = await checkInvoice({ format: "json", invoice: i });
      expect(failing(r)).toContain(rule);
      expect(r.compliance.status).toBe("non_compliant");
      const chk = r.compliance.checks.find((c) => c.rule_id === rule)!;
      expect(chk.fix_hint).toBeTruthy();
      expect(chk.legal_basis_id).toBeTruthy();
    });
  }

  it("derives 'mixed' from line kinds and suggests it when the operation category is missing", async () => {
    const i = inv10();
    delete i.operation_nature;
    const r = await checkInvoice({ format: "json", invoice: i });
    const chk = r.compliance.checks.find((c) => c.rule_id === "FR-EINV-OPERATION-NATURE")!;
    expect(chk.passed).toBe(false);
    expect(chk.fix_hint).toMatch(/mixed/);
    expect(r.invoice.operation_nature).toBe("mixed");
  });

  it("rejects a declared category inconsistent with the lines", async () => {
    const i = inv10();
    i.operation_nature = "goods";
    const r = await checkInvoice({ format: "json", invoice: i });
    expect(failing(r)).toContain("FR-EINV-OPERATION-NATURE");
  });

  it("reform mentions are informational before 2026-09-01", async () => {
    const i = inv1();
    delete i.customer.siren;
    i.issue_date = "2026-06-15";
    const r = await checkInvoice({ format: "json", invoice: i });
    const chk = r.compliance.checks.find((c) => c.rule_id === "FR-EINV-SIREN-BUYER")!;
    expect(chk.passed).toBe(false);
    expect(chk.severity).toBe("info");
    expect(r.compliance.status).toBe("compliant");
  });

  it("requires the exemption mention when no VAT is invoiced", async () => {
    const i = structuredClone((FX("05").input as { invoice: InvoiceInput }).invoice);
    i.legal_mentions = [];
    const r = await checkInvoice({ format: "json", invoice: i });
    expect(failing(r)).toContain("FR-INV-VAT-EXEMPTION-MENTION");
  });

  it("requires the reverse-charge mention and customer VAT id for intra-EU services", async () => {
    const i = inv4();
    i.legal_mentions = [];
    delete i.customer.vat_id;
    const r = await checkInvoice({ format: "json", invoice: i });
    expect(failing(r)).toEqual(expect.arrayContaining(["FR-INV-REVERSE-CHARGE-MENTION", "FR-INV-CUSTOMER-VATID"]));
    // French-only mentions do not apply to a German supplier
    expect(r.compliance.checks.map((c) => c.rule_id)).not.toContain("FR-INV-SUPPLIER-SIREN");
    expect(r.compliance.checks.map((c) => c.rule_id)).not.toContain("FR-EINV-SIREN-BUYER");
  });

  it("requires the original invoice reference on a credit note", async () => {
    const i = structuredClone((FX("07").input as { invoice: InvoiceInput }).invoice);
    delete i.original_invoice_number;
    const r = await checkInvoice({ format: "json", invoice: i });
    expect(failing(r)).toContain("FR-INV-CREDIT-NOTE-REFERENCE");
  });

  it("detects inconsistent totals and requires review", async () => {
    const i = inv1();
    i.totals.total_vat = 30;
    i.totals.total_incl_vat = 170;
    const r = await entry(i);
    expect(failing(r)).toContain("FR-INV-VAT-AMOUNT");
    expect(codes(r)).toContain("TOTALS_INCONSISTENT");
    expect(r.human_review_required).toBe(true);
    expect(r.entry.balanced).toBe(true);
  });

  it("flags an invalid VAT rate", async () => {
    const i = inv1();
    i.lines[0].vat_rate = 0.19;
    const r = await entry(i);
    expect(codes(r)).toContain("VAT_RATE_INVALID");
    expect(failing(r)).toContain("FR-INV-VAT-RATE");
  });
});

// ---------------------------------------------------------------------------
describe("classification, VAT deductibility and accounts", () => {
  it("classifies by keywords, hints and flags unknown lines", () => {
    expect(classifyLine("Ramettes papier A4").category.account).toBe("6064");
    expect(classifyLine("Nuitée hôtel Ibis Lyon").category.account).toBe("6256");
    expect(classifyLine("Abonnement logiciel SaaS").category.account).toBe("6511");
    expect(classifyLine("xyz-42", "training").category.account).toBe("6228");
    expect(classifyLine("Prestation diverse xyz").confidence).toBeLessThan(0.75);
    expect(CATEGORY_IDS.length).toBeGreaterThan(15);
  });

  it("uncertain classification without LLM -> CLASSIFICATION_UNCERTAIN + human review", async () => {
    const i = inv1();
    i.lines = [{ description: "Prestation xyz", quantity: 1, unit_price_excl_vat: 140, vat_rate: 0.2, kind: "goods" }];
    const r = await entry(i);
    expect(codes(r)).toContain("CLASSIFICATION_UNCERTAIN");
    expect(r.review_reasons).toContain("CLASSIFICATION_UNCERTAIN");
    expect(r.engine.llm_used).toBe(false);
  });

  it("uncertain classification with an LLM -> LLM category, rules still decide VAT", async () => {
    const i = inv1();
    i.lines = [{ description: "Prestation xyz", quantity: 1, unit_price_excl_vat: 140, vat_rate: 0.2, kind: "services" }];
    i.operation_nature = "services";
    const r = await entry(i, { llm: mockLlm() });
    expect(r.entry.lines[0].account).toBe("6511");
    expect(r.engine.llm_used).toBe(true);
    expect(codes(r)).not.toContain("CLASSIFICATION_UNCERTAIN");
    expect(r.entry.lines.find((l) => l.account === "44566")?.debit).toBe(28);
  });

  it("IT equipment below EUR 500 per unit is expensed in 6063", async () => {
    const i = structuredClone((FX("08").input as { invoice: InvoiceInput }).invoice);
    i.lines = [{ description: "Écran 24 pouces", quantity: 2, unit_price_excl_vat: 499, vat_rate: 0.2, kind: "goods" }];
    i.totals = { total_excl_vat: 998, total_vat: 199.6, total_incl_vat: 1197.6 };
    const r = await entry(i);
    expect(r.entry.lines.map((l) => l.account)).toEqual(["6063", "44566", "401NUMERIA"]);
  });

  it("staff accommodation VAT is not deductible and is added to the expense", async () => {
    const i = inv1();
    i.operation_nature = "services";
    i.lines = [{ description: "Nuitée hôtel — mission client", quantity: 2, unit_price_excl_vat: 100, vat_rate: 0.1, kind: "services" }];
    i.totals = { total_excl_vat: 200, total_vat: 20, total_incl_vat: 220 };
    const r = await entry(i);
    expect(r.entry.lines.map((l) => [l.account, l.debit, l.credit])).toEqual([["6256", 220, 0], ["401BURO", 0, 220]]);
    expect(codes(r)).toContain("VAT_NOT_DEDUCTIBLE");
    expect(r.vat.deductible).toBe(false);
  });

  it("gift above EUR 73 incl. VAT -> VAT not deductible + warning", async () => {
    const i = inv1();
    i.lines = [{ description: "Coffret cadeau clients", quantity: 2, unit_price_excl_vat: 80, vat_rate: 0.2, kind: "goods" }];
    i.totals = { total_excl_vat: 160, total_vat: 32, total_incl_vat: 192 };
    const r = await entry(i);
    expect(r.entry.lines[0]).toMatchObject({ account: "6234", debit: 192 });
    expect(codes(r)).toContain("GIFT_VAT_THRESHOLD");
  });

  it("restaurant wine at 20% is not a VAT mismatch", async () => {
    const i = structuredClone((FX("03").input as { invoice: InvoiceInput }).invoice);
    i.lines = [
      { description: "Déjeuner — menu du jour", quantity: 2, unit_price_excl_vat: 30, vat_rate: 0.1, kind: "services" },
      { description: "Bouteille de vin rouge", quantity: 1, unit_price_excl_vat: 25, vat_rate: 0.2, kind: "services" },
    ];
    i.totals = { total_excl_vat: 85, total_vat: 11, total_incl_vat: 96 };
    const r = await entry(i);
    expect(codes(r)).not.toContain("VAT_RATE_MISMATCH");
    expect(r.vat.regime).toBe("mixed_rates");
  });

  it("invoice addressed to another company -> CUSTOMER_MISMATCH", async () => {
    const i = inv1();
    i.customer.siren = "000001016";
    const r = await entry(i);
    expect(codes(r)).toContain("CUSTOMER_MISMATCH");
  });

  it("EU supplier charging its own VAT -> foreign VAT not deductible", async () => {
    const i = inv4();
    i.lines[0].vat_rate = 0.19;
    i.totals = { total_excl_vat: 2200, total_vat: 418, total_incl_vat: 2618 };
    const r = await entry(i);
    expect(codes(r)).toContain("FOREIGN_VAT_CHARGED");
    expect(r.entry.lines.some((l) => l.account.startsWith("4456"))).toBe(false);
    expect(r.entry.balanced).toBe(true);
  });

  it("derives supplier auxiliary accounts", () => {
    expect(auxiliaryCode("Buro Velours SARL (fictional)")).toBe("BURO");
    expect(auxiliaryCode("Le Bouchon Lumière SARL")).toBe("BOUCHON");
    expect(auxiliaryCode("Cabinet Vasquelin Avocats SELARL")).toBe("VASQUELI");
    expect(auxiliaryCode("Formacomète Institut SAS")).toBe("FORMACOM");
    expect(auxiliaryCode("A B C X Y")).toBe("ABCX");
  });

  it("uses a caller-supplied account code", async () => {
    const i = inv1();
    i.supplier.account_code = "buro-01";
    const r = await entry(i);
    expect(r.entry.lines.at(-1)?.account).toBe("401BURO01");
  });

  it("validates SIRENs with the Luhn key", () => {
    expect(isValidSiren(DEMO_PROFILE.siren)).toBe(true);
    expect(isValidSiren("000001016")).toBe(true);
    expect(isValidSiren("000001017")).toBe(false);
    expect(isValidSiren("12345")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("duplicates", () => {
  it("same supplier + same amount within 5 days is a duplicate, credit notes are not", async () => {
    const a = inv1();
    const fp = fingerprint(a);
    const b = inv1();
    b.number = "BE-2026-0499";
    b.issue_date = "2026-10-09";
    expect(codes(await entry(b, { history: [fp] }))).toContain("DUPLICATE_SUSPECTED");
    b.issue_date = "2026-10-12";
    expect(codes(await entry(b, { history: [fp] }))).not.toContain("DUPLICATE_SUSPECTED");
    const cn = structuredClone((FX("07").input as { invoice: InvoiceInput }).invoice);
    cn.totals = a.totals;
    expect(codes(await entry(cn, { history: [fp] }))).not.toContain("DUPLICATE_SUSPECTED");
  });
});

// ---------------------------------------------------------------------------
describe("parsers and errors", () => {
  it("rejects malformed JSON invoices with machine-readable details", async () => {
    const bad = { ...inv1(), issue_date: "05/10/2026", lines: [] } as unknown as InvoiceInput;
    const e = await expectEngineError(createEntry({ format: "json", invoice: bad }), "INVALID_INPUT");
    const details = e.details as { path: string }[];
    expect(details.map((d) => d.path)).toEqual(expect.arrayContaining(["invoice.issue_date", "invoice.lines"]));
    expect(e.toJSON().code).toBe("INVALID_INPUT");
  });

  it("rejects unknown formats and bad envelopes", async () => {
    await expectEngineError(createEntry({ format: "csv" } as unknown as EngineInput), "UNSUPPORTED_FORMAT");
    await expectEngineError(createEntry(null as unknown as EngineInput), "INVALID_INPUT");
    await expectEngineError(createEntry({ format: "facturx", document_base64: "!!!" }), "INVALID_INPUT");
  });

  it("accepts credit notes sent with negative amounts", async () => {
    const i = structuredClone((FX("07").input as { invoice: InvoiceInput }).invoice);
    i.lines[0].quantity = -2;
    delete i.lines[0].total_excl_vat;
    i.totals = { total_excl_vat: -45, total_vat: -9, total_incl_vat: -54 };
    const r = await entry(i);
    expect(r.entry.lines.map((l) => [l.account, l.debit, l.credit])).toEqual([["6064", 0, 45], ["44566", 0, 9], ["401BURO", 54, 0]]);
  });

  it("round-trips an invoice through the CII writer and parser", () => {
    const i = inv10();
    const back = parseCii(invoiceToCii(i));
    expect(back.number).toBe(i.number);
    expect(back.supplier).toEqual({ name: i.supplier.name, siren: i.supplier.siren, vat_id: i.supplier.vat_id, country: "FR", address: i.supplier.address });
    expect(back.customer.siren).toBe(i.customer.siren);
    expect(back.operation_nature).toBe("mixed");
    expect(back.vat_on_debits_option).toBe(false);
    expect(back.totals).toEqual(i.totals);
    expect(back.lines.map((l) => [l.description, l.quantity, l.unit_price_excl_vat, l.vat_rate])).toEqual(
      i.lines.map((l) => [l.description, l.quantity, l.unit_price_excl_vat, l.vat_rate]),
    );
    expect(back.fixed_recovery_indemnity_mention).toBe(true);
    expect(back.late_payment_penalties).toBe(i.late_payment_penalties);
  });

  it("accepts a CII document sent under format ubl", async () => {
    const r = await createEntry({ format: "ubl", xml: invoiceToCii(inv1()) });
    expect(r.engine.extraction_method).toBe("facturx_cii");
    expect(r.entry.lines.map((l) => l.account)).toEqual(["6064", "44566", "401BURO"]);
  });

  it("rejects malformed XML", async () => {
    await expectEngineError(createEntry({ format: "ubl", xml: "<Invoice><ID>1</Invoice>" }), "INVALID_XML");
    await expectEngineError(createEntry({ format: "ubl", xml: "<Foo/>" }), "INVALID_XML");
  });

  it("a PDF without Factur-X attachment needs the LLM", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const b64 = Buffer.from(await pdf.save()).toString("base64");
    await expectEngineError(createEntry({ format: "facturx", document_base64: b64 }), "FACTURX_XML_NOT_FOUND");
    await expectEngineError(createEntry({ format: "pdf", document_base64: b64 }), "LLM_UNAVAILABLE");
    await expectEngineError(createEntry({ format: "facturx", document_base64: Buffer.from("not a pdf").toString("base64") }), "INVALID_PDF");
  });

  it("LLM extraction is flagged and reviewed below 0.9 confidence", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const b64 = Buffer.from(await pdf.save()).toString("base64");
    const r = await createEntry({ format: "pdf", document_base64: b64 }, { llm: mockLlm() });
    expect(r.engine.extraction_method).toBe("llm");
    expect(r.engine.extraction_confidence).toBe(0.82);
    expect(r.engine.llm_used).toBe(true);
    expect(r.human_review_required).toBe(true);
    expect(r.review_reasons).toContain("LLM_EXTRACTION_LOW_CONFIDENCE");
    expect(r.confidence).toBeLessThan(0.82);
    // The rules engine re-validates: same entry as the structured fixture.
    expect(r.entry.lines.map((l) => l.account)).toEqual(["6064", "44566", "401BURO"]);
  });

  it("LLM output that breaks the schema is rejected", async () => {
    const llm = mockLlm({ extractInvoice: async () => ({ invoice: { number: 1 } as unknown as InvoiceInput, confidence: 0.99 }) });
    await expectEngineError(createEntry({ format: "image", document_base64: "aGVsbG8=", mime_type: "image/png" }, { llm }), "INVALID_INPUT");
  });

  it("parseInput reports the extraction method", async () => {
    const p = await parseInput({ format: "json", invoice: inv1() }, {});
    expect(p.method).toBe("structured_json");
    expect(p.invoice?.number).toBe("BE-2026-0412");
  });

  it("checkInvoice refuses bank transactions", async () => {
    await expectEngineError(checkInvoice(FX("12").input), "UNSUPPORTED_FORMAT");
  });

  it("no LLM adapter without ANTHROPIC_API_KEY (no network in tests)", () => {
    expect(createAnthropicAdapter({})).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
describe("bank transactions", () => {
  it("unmatched transaction goes to the suspense account with review", async () => {
    const r = await createEntry({
      format: "bank_transaction",
      transaction: { date: "2026-11-05", label: "PRLV SEPA INCONNU", amount: -59.9, currency: "EUR" },
      candidate_invoices: [inv1()],
    });
    expect(r.entry.lines.map((l) => [l.account, l.debit, l.credit])).toEqual([["471", 59.9, 0], ["512", 0, 59.9]]);
    expect(r.match?.matched_invoice_number).toBeNull();
    expect(r.review_reasons).toContain("UNMATCHED_TRANSACTION");
  });

  it("a supplier refund (money in) matched to a credit note debits the bank", async () => {
    const cn = structuredClone((FX("07").input as { invoice: InvoiceInput }).invoice);
    const r = await createEntry({
      format: "bank_transaction",
      transaction: { date: "2026-10-20", label: "VIR BURO VELOURS AVOIR BE-AV-2026-0031", amount: 54, currency: "EUR" },
      candidate_invoices: [inv1(), cn],
    });
    expect(r.match?.matched_invoice_number).toBe("BE-AV-2026-0031");
    expect(r.entry.lines.map((l) => [l.account, l.debit, l.credit])).toEqual([["512", 54, 0], ["401BURO", 0, 54]]);
  });
});

// ---------------------------------------------------------------------------
describe("audit", () => {
  const batch = (): AuditEntryInput[] => ["01", "03", "06"].map((n) => ({ invoice: (FX(n).input as { invoice: InvoiceInput }).invoice }));

  it("audits fixtures 1, 3 and 6: duplicate across the batch, VAT mismatch, two viewpoints", async () => {
    const r = await auditEntries(batch());
    expect(r.entries_audited).toBe(3);
    expect(r.totals).toEqual({ debit: 511.2, credit: 511.2, balanced: true });
    const dup = r.anomalies.find((a) => a.code === "DUPLICATE_SUSPECTED");
    expect(dup?.entry_ref).toBe("3:BE-2026-0412");
    expect(dup?.detail).toMatch(/1:BE-2026-0412/);
    expect(r.anomalies.some((a) => a.code === "VAT_RATE_MISMATCH" && a.entry_ref === "2:LBL-2026-1187")).toBe(true);
    const sa = r.viewpoints.statutory_auditor;
    expect(sa.role).toBe("statutory_auditor");
    expect(sa.materiality_threshold).toBe(5000);
    expect(sa.findings.map((f) => f.code)).toContain("DUPLICATE_SUSPECTED");
    const ti = r.viewpoints.tax_inspector;
    expect(ti.findings.map((f) => f.code)).toEqual(expect.arrayContaining(["VAT_RATE_MISMATCH", "VAT_DOUBLE_DEDUCTION", "RECEPTION_EXPENSES"]));
    expect(ti.overall_risk).toBe("high");
    expect(r.human_review_required).toBe(true);
  });

  it("checks raw entries: unbalanced, suspense account, weekend, round amount, VAT ratio, materiality", async () => {
    const items: AuditEntryInput[] = [
      { entry: { journal: "OD", date: "2026-10-10", reference: "OD-1", balanced: false, lines: [
        { account: "471", label: "Attente", debit: 6000, credit: 0 },
        { account: "512", label: "Banque", debit: 0, credit: 5999.99 },
      ] } },
      { entry: { journal: "HA", date: "2026-10-12", reference: "HA-9", balanced: true, lines: [
        { account: "2183", label: "Matériel", debit: 1000, credit: 0 },
        { account: "44566", label: "TVA", debit: 150, credit: 0 },
        { account: "401X", label: "F", debit: 0, credit: 1150 },
      ] } },
    ];
    const r = await auditEntries(items, { materiality_threshold: 4000 });
    const c = r.anomalies.map((a) => `${a.entry_ref}/${a.code}`);
    expect(c).toEqual(expect.arrayContaining([
      "1:OD-1/UNBALANCED_ENTRY", "1:OD-1/SUSPENSE_ACCOUNT_USED", "1:OD-1/WEEKEND_DATE", "1:OD-1/ROUND_AMOUNT",
      "2:HA-9/VAT_RATIO_UNUSUAL", "2:HA-9/VAT_ACCOUNT_MISMATCH",
    ]));
    expect(r.totals.balanced).toBe(false);
    expect(r.viewpoints.statutory_auditor.materiality_threshold).toBe(4000);
    expect(r.viewpoints.statutory_auditor.findings.some((f) => f.code === "ABOVE_PERFORMANCE_MATERIALITY" && f.risk === "high")).toBe(true);
    expect(r.viewpoints.statutory_auditor.overall_risk).toBe("high");
  });

  it("enforces the batch size", async () => {
    await expectEngineError(auditEntries([]), "EMPTY_BATCH");
    const many = Array.from({ length: 51 }, () => ({ invoice: inv1() }));
    await expectEngineError(auditEntries(many), "BATCH_TOO_LARGE");
  });
});

// ---------------------------------------------------------------------------
describe("legal bases", () => {
  it("references are not exposed until reviewed", () => {
    for (const b of LEGAL_BASES) {
      expect(b.reviewed_by).toBe("");
      expect(publicLegalBasis(b.id).reference).toBeUndefined();
      if (b.reference.includes("TO VERIFY")) expect(b.to_verify).toBe(true);
    }
  });

  it("every legal_basis_id used by the engine exists in the curated table", async () => {
    const ids = new Set(LEGAL_BASES.map((b) => b.id));
    for (const n of ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "12"]) {
      const r = await createEntry(FX(n).input, FX(n).context ?? {});
      for (const c of r.compliance.checks) if (c.legal_basis_id) expect(ids.has(c.legal_basis_id)).toBe(true);
      if (r.vat.legal_basis_id) expect(ids.has(r.vat.legal_basis_id)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// M1 (Phase 1 review): no unreviewed legal reference may reach an agent, on
// green fixtures AND on failing / mutated invoices, through every operation.
const LEAK = /\bart(icle)?\.?\s*\d|\bCGI\b|L\d{3}-\d+|BOI-/i;

function mutatedInvoices(): { name: string; invoice: InvoiceInput; ctx?: object }[] {
  const out: { name: string; invoice: InvoiceInput; ctx?: object }[] = [];
  const fxInv = (n: string) => structuredClone((FX(n).input as { invoice: InvoiceInput }).invoice);
  for (const n of ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10"]) out.push({ name: n, invoice: fxInv(n), ctx: FX(n).context });
  const mutations: [string, (i: InvoiceInput) => void][] = [
    ["no number", (i) => (i.number = "")],
    ["bad date", (i) => (i.issue_date = "2026-13-45")],
    ["no supplier address", (i) => delete i.supplier.address],
    ["no customer address", (i) => delete i.customer.address],
    ["bad supplier siren", (i) => (i.supplier.siren = "000001017")],
    ["no supplier siren", (i) => delete i.supplier.siren],
    ["no supplier vat id", (i) => delete i.supplier.vat_id],
    ["blank description", (i) => (i.lines[0].description = " ")],
    ["zero quantity", (i) => (i.lines[0].quantity = 0)],
    ["invalid rate", (i) => (i.lines[0].vat_rate = 0.19)],
    ["bad line total", (i) => (i.lines[0].total_excl_vat = 1)],
    ["bad totals", (i) => { i.totals.total_vat += 3; i.totals.total_incl_vat += 7; }],
    ["no payment terms", (i) => { delete i.due_date; delete i.payment_terms; }],
    ["no penalties", (i) => delete i.late_payment_penalties],
    ["no indemnity", (i) => (i.fixed_recovery_indemnity_mention = false)],
    ["no buyer siren", (i) => delete i.customer.siren],
    ["bad buyer siren", (i) => (i.customer.siren = "000001017")],
    ["no operation nature", (i) => delete i.operation_nature],
    ["wrong operation nature", (i) => (i.operation_nature = "services")],
    ["sme supplier", (i) => { i.supplier.company_size = "sme"; delete i.customer.siren; delete i.operation_nature; }],
    ["other customer", (i) => (i.customer.siren = "000001016")],
    ["unclassifiable line", (i) => (i.lines = [{ description: "Prestation xyz", quantity: 1, unit_price_excl_vat: 140, vat_rate: 0.2, kind: "goods" }])],
    ["non-EU services", (i) => { i.supplier.country = "US"; i.lines.forEach((l) => { l.vat_rate = 0; l.kind = "services"; }); i.totals.total_vat = 0; i.totals.total_incl_vat = i.totals.total_excl_vat; }],
    ["non-EU goods", (i) => { i.supplier.country = "CN"; i.lines.forEach((l) => (l.vat_rate = 0)); i.totals.total_vat = 0; i.totals.total_incl_vat = i.totals.total_excl_vat; }],
    ["EU supplier with VAT", (i) => (i.supplier.country = "DE")],
  ];
  for (const [name, mutate] of mutations) {
    const i = inv1();
    mutate(i);
    out.push({ name, invoice: i });
  }
  // Exempt invoice without its exemption mention (the original M1 leak), and franchise / training variants.
  const ex = fxInv("05");
  ex.legal_mentions = [];
  out.push({ name: "05 without exemption mention", invoice: ex });
  const fr = fxInv("05");
  fr.legal_mentions = ["TVA non applicable (franchise en base)"];
  out.push({ name: "05 franchise", invoice: fr });
  const rc = inv4();
  rc.legal_mentions = [];
  delete rc.customer.vat_id;
  out.push({ name: "04 without reverse-charge mention", invoice: rc });
  const cn = fxInv("07");
  delete cn.original_invoice_number;
  out.push({ name: "07 without reference", invoice: cn });
  const gift = inv1();
  gift.lines = [{ description: "Coffret cadeau clients", quantity: 2, unit_price_excl_vat: 80, vat_rate: 0.2, kind: "goods" }];
  gift.totals = { total_excl_vat: 160, total_vat: 32, total_incl_vat: 192 };
  out.push({ name: "gift", invoice: gift });
  const hotel = inv1();
  hotel.operation_nature = "services";
  hotel.lines = [{ description: "Nuitée hôtel — mission client", quantity: 2, unit_price_excl_vat: 100, vat_rate: 0.1, kind: "services" }];
  hotel.totals = { total_excl_vat: 200, total_vat: 20, total_incl_vat: 220 };
  out.push({ name: "hotel", invoice: hotel });
  return out;
}

describe("no unreviewed legal reference reaches an agent (M1)", () => {
  it("createEntry and checkInvoice outputs, green and failing invoices", async () => {
    for (const m of mutatedInvoices()) {
      const ctx = (m.ctx ?? {}) as Parameters<typeof createEntry>[1];
      const e = await entry(m.invoice, ctx);
      expect(JSON.stringify(e), m.name).not.toMatch(LEAK);
      const c = await checkInvoice({ format: "json", invoice: m.invoice }, ctx);
      expect(JSON.stringify(c), m.name).not.toMatch(LEAK);
    }
  });

  it("bank, Factur-X, UBL and audit outputs", async () => {
    for (const n of ["11", "12"]) {
      const fx = loadFixture(path.resolve(__dirname, `../fixtures/${n}.json`));
      expect(JSON.stringify(await createEntry(fx.input, fx.context ?? {}))).not.toMatch(LEAK);
    }
    const all = mutatedInvoices().map((m) => ({ invoice: m.invoice }));
    for (let i = 0; i < all.length; i += 50) {
      const r = await auditEntries(all.slice(i, i + 50));
      expect(JSON.stringify(r)).not.toMatch(LEAK);
    }
  });

  it("every anomaly carries a stable rule_id (m5)", async () => {
    for (const m of mutatedInvoices()) {
      const e = await entry(m.invoice, (m.ctx ?? {}) as Parameters<typeof createEntry>[1]);
      for (const a of e.anomalies) expect(a.rule_id, `${m.name}: ${a.code}`).toBeTruthy();
    }
    const fx12 = loadFixture(path.resolve(__dirname, "../fixtures/12.json"));
    const cashProfile = { ...DEMO_PROFILE, accounting_basis: "cash" as const };
    const b = await createEntry(fx12.input, { profile: cashProfile });
    for (const a of b.anomalies) expect(a.rule_id, a.code).toBeTruthy();
    const audit = await auditEntries([
      { entry: { journal: "OD", date: "2026-11-14", reference: "OD-1", balanced: false, lines: [{ account: "471", label: "x", debit: 2000, credit: 0 }, { account: "512", label: "y", debit: 0, credit: 1000 }] } },
      ...mutatedInvoices().slice(0, 20).map((m) => ({ invoice: m.invoice })),
    ]);
    for (const a of audit.anomalies) expect(a.rule_id, a.code).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
describe("Phase 1 review fixes", () => {
  it("M2: reform mentions are warnings for an SME issuer before 2027-09-01, errors for large/mid issuers", async () => {
    const sme = inv1();
    sme.supplier.company_size = "sme";
    delete sme.customer.siren;
    const r1 = await checkInvoice({ format: "json", invoice: sme });
    const c1 = r1.compliance.checks.find((c) => c.rule_id === "FR-EINV-SIREN-BUYER")!;
    expect(c1.severity).toBe("warning");
    expect(c1.fix_hint).toMatch(/1 Sept 2027/);
    expect(c1.fix_hint).toMatch(/reception is mandatory for all companies since 1 Sept 2026/);
    expect(r1.compliance.status).toBe("warning");

    const unknown = structuredClone(sme);
    delete unknown.supplier.company_size;
    expect((await checkInvoice({ format: "json", invoice: unknown })).compliance.checks.find((c) => c.rule_id === "FR-EINV-SIREN-BUYER")!.severity).toBe("warning");

    const later = structuredClone(sme);
    later.issue_date = "2027-09-01";
    later.due_date = "2027-10-01";
    const r2 = await checkInvoice({ format: "json", invoice: later });
    expect(r2.compliance.checks.find((c) => c.rule_id === "FR-EINV-SIREN-BUYER")!.severity).toBe("error");
    expect(r2.compliance.status).toBe("non_compliant");

    for (const size of ["large", "mid"] as const) {
      const big = structuredClone(sme);
      big.supplier.company_size = size;
      const r3 = await checkInvoice({ format: "json", invoice: big });
      expect(r3.compliance.checks.find((c) => c.rule_id === "FR-EINV-SIREN-BUYER")!.severity).toBe("error");
    }

    const op = inv1();
    op.supplier.company_size = "micro";
    delete op.operation_nature;
    const r4 = await checkInvoice({ format: "json", invoice: op });
    const c4 = r4.compliance.checks.find((c) => c.rule_id === "FR-EINV-OPERATION-NATURE")!;
    expect(c4.severity).toBe("warning");
    expect(c4.fix_hint).toMatch(/goods/);
    expect(c4.fix_hint).toMatch(/1 Sept 2027/);
  });

  it("m1: an item at exactly EUR 500 excl. VAT is expensed; above 500 it is capitalised", async () => {
    const i = structuredClone((FX("08").input as { invoice: InvoiceInput }).invoice);
    i.lines = [{ description: "Écran 32 pouces", quantity: 1, unit_price_excl_vat: 500, vat_rate: 0.2, kind: "goods" }];
    i.totals = { total_excl_vat: 500, total_vat: 100, total_incl_vat: 600 };
    expect((await entry(i)).entry.lines.map((l) => l.account)).toEqual(["6063", "44566", "401NUMERIA"]);
    i.lines[0].unit_price_excl_vat = 500.01;
    i.totals = { total_excl_vat: 500.01, total_vat: 100, total_incl_vat: 600.01 };
    expect((await entry(i)).entry.lines.map((l) => l.account)).toEqual(["2183", "44562", "401NUMERIA"]);
  });

  it("m2: a credit note does not need late-payment penalty / EUR 40 / due-date mentions", async () => {
    const cn = structuredClone((FX("07").input as { invoice: InvoiceInput }).invoice);
    delete cn.late_payment_penalties;
    cn.fixed_recovery_indemnity_mention = false;
    delete cn.due_date;
    delete cn.payment_terms;
    const r = await checkInvoice({ format: "json", invoice: cn });
    expect(r.compliance.status).toBe("compliant");
    const ids = r.compliance.checks.map((c) => c.rule_id);
    for (const id of ["FR-INV-LATE-PENALTIES", "FR-INV-RECOVERY-INDEMNITY", "FR-INV-PAYMENT-DUE-DATE"]) expect(ids).not.toContain(id);
  });

  it("m3: no VAT-on-debits check on an invoice that charges no VAT", async () => {
    const r = await createEntry(FX("05").input);
    expect(r.compliance.checks.map((c) => c.rule_id)).not.toContain("FR-EINV-VAT-ON-DEBITS");
  });

  it("m6: B2B services from a non-EU supplier -> reverse_charge_non_eu, no 4452 line, review", async () => {
    const i = inv1();
    i.supplier = { name: "Cloudberry Inc. (fictional)", country: "US", address: "1 Example Street, Austin TX" };
    i.operation_nature = "services";
    i.lines = [{ description: "Abonnement logiciel SaaS — novembre", quantity: 1, unit_price_excl_vat: 300, vat_rate: 0, kind: "services" }];
    i.totals = { total_excl_vat: 300, total_vat: 0, total_incl_vat: 300 };
    const r = await entry(i);
    expect(r.vat.regime).toBe("reverse_charge_non_eu");
    expect(r.vat.legal_basis_id).toBe("LB-VAT-REVERSE-CHARGE-SERVICES");
    expect(r.entry.lines.map((l) => [l.account, l.debit, l.credit])).toEqual([["6511", 300, 0], ["401CLOUDBER", 0, 300]]);
    expect(r.entry.lines.some((l) => l.account === "4452")).toBe(false);
    expect(codes(r)).toContain("NON_EU_SUPPLIER");
    expect(r.human_review_required).toBe(true);
    // Goods from outside the EU stay out_of_scope (import VAT via customs).
    const g = inv1();
    g.supplier.country = "CN";
    g.lines.forEach((l) => (l.vat_rate = 0));
    g.totals.total_vat = 0;
    g.totals.total_incl_vat = g.totals.total_excl_vat;
    expect((await entry(g)).vat.regime).toBe("out_of_scope");
  });

  it("m9: SaaS goes to 6511, web hosting to 6156", () => {
    expect(classifyLine("Abonnement SaaS de comptabilité").category.account).toBe("6511");
    expect(classifyLine("Hébergement web annuel").category.account).toBe("6156");
  });
});
