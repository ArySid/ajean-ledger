import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createEntry, isEngineError, type EntryResult } from "@/engine";
import { inputFromPath } from "@/fixtures/loader";

const DIR = path.resolve(__dirname, "../fixtures");
const EXPECTED = path.join(DIR, "expected");

interface Expected {
  compliance_status: string;
  failing_rule_ids: string[];
  entry: { journal: string; lines: { account: string; debit: number; credit: number }[]; balanced: boolean };
  vat: { regime: string; rate: number };
  anomaly_codes: string[];
  human_review_required: boolean;
  review_reasons: string[];
  extraction_method: string;
  vat_legal_basis_id?: string;
  operation_nature?: string;
  match?: { matched_invoice_number: string | null; score: number };
}

const SOURCES: Record<string, string> = { "13": "13.ubl.xml" };

function sourceFor(n: string): string {
  return path.join(DIR, SOURCES[n] ?? `${n}.json`);
}

const cases = readdirSync(EXPECTED)
  .filter((f) => f.endsWith(".expected.json"))
  .map((f) => f.slice(0, 2))
  .sort();

async function run(n: string): Promise<EntryResult> {
  const fx = inputFromPath(sourceFor(n));
  return createEntry(fx.input, fx.context ?? {});
}

describe("fixtures", () => {
  it("covers the 12 mandatory fixtures (+ UBL bonus)", () => {
    for (const n of ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"]) expect(cases).toContain(n);
  });

  for (const n of cases) {
    it(`fixture ${n} matches its expected output`, async () => {
      const exp = JSON.parse(readFileSync(path.join(EXPECTED, `${n}.expected.json`), "utf8")) as Expected;
      let r: EntryResult;
      try {
        r = await run(n);
      } catch (e) {
        throw new Error(`fixture ${n} threw ${isEngineError(e) ? JSON.stringify(e.toJSON()) : String(e)}`);
      }
      expect(r.compliance.status).toBe(exp.compliance_status);
      const failing = r.compliance.checks.filter((c) => !c.passed && c.severity !== "info").map((c) => c.rule_id).sort();
      expect(failing).toEqual([...exp.failing_rule_ids].sort());
      expect(r.entry.journal).toBe(exp.entry.journal);
      expect(r.entry.lines.map((l) => ({ account: l.account, debit: l.debit, credit: l.credit }))).toEqual(exp.entry.lines);
      expect(r.entry.balanced).toBe(true);
      expect(r.vat.regime).toBe(exp.vat.regime);
      expect(r.vat.rate).toBe(exp.vat.rate);
      expect([...new Set(r.anomalies.map((a) => a.code))].sort()).toEqual(exp.anomaly_codes);
      expect(r.human_review_required).toBe(exp.human_review_required);
      expect(r.review_reasons).toEqual(exp.review_reasons);
      expect(r.engine.extraction_method).toBe(exp.extraction_method);
      expect(r.engine.llm_used).toBe(false);
      if (exp.vat_legal_basis_id) expect(r.vat.legal_basis_id).toBe(exp.vat_legal_basis_id);
      if (exp.operation_nature) expect(r.invoice.operation_nature).toBe(exp.operation_nature);
      if (exp.match) {
        expect(r.match?.matched_invoice_number).toBe(exp.match.matched_invoice_number);
        expect(r.match?.score).toBe(exp.match.score);
      }
      // Contract invariants
      for (const l of r.entry.lines) {
        expect(Math.round(l.debit * 100) / 100).toBe(l.debit);
        expect(Math.round(l.credit * 100) / 100).toBe(l.credit);
        expect(l.debit === 0 || l.credit === 0).toBe(true);
      }
      expect(r.confidence).toBeGreaterThan(0);
      expect(r.confidence).toBeLessThanOrEqual(0.98);
      expect(r.explanation.length).toBeGreaterThan(40);
      expect(r.disclaimer).toMatch(/Not a substitute/);
    });
  }

  it("outputs are deterministic (same input -> byte-identical JSON)", async () => {
    for (const n of cases) {
      const a = JSON.stringify(await run(n));
      const b = JSON.stringify(await run(n));
      expect(a).toBe(b);
    }
  });

  it("fixture 11 (Factur-X) books exactly like fixture 01", async () => {
    const a = await run("01");
    const b = await run("11");
    expect(b.entry).toEqual(a.entry);
    expect(b.vat).toEqual(a.vat);
    expect(b.compliance.status).toBe(a.compliance.status);
  });

  it("fixture 03 tells the agent the excess VAT and never corrects it silently", async () => {
    const r = await run("03");
    const mismatch = r.anomalies.filter((a) => a.code === "VAT_RATE_MISMATCH");
    expect(mismatch).toHaveLength(2);
    expect(mismatch[0].detail).toMatch(/13\.60 EUR/);
    expect(r.entry.lines.find((l) => l.account === "44566")?.debit).toBe(29.2);
  });

  it("fixture 09 explains the cash-basis treatment", async () => {
    const r = await run("09");
    expect(r.explanation).toMatch(/cash-basis/);
    expect(r.vat.note).toMatch(/deductible when the invoice is paid/);
  });
});
