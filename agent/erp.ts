/**
 * Mock ERP of Atelier Lumenor SAS (fictional): where the agent posts the entries it bought.
 * CLI: data/erp.local.json (gitignored). Serverless route: memory.
 * The ERP also gives the agent its history (fingerprints of invoices already booked),
 * which it sends to Ajean Ledger so the service can spot duplicates.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { InvoiceFingerprint } from "../engine/types";
import type { Erp, ErpRecord } from "./types";

export const ERP_COMPANY = "Atelier Lumenor SAS (fictional)";

function fpKey(fp: InvoiceFingerprint): string {
  return `${fp.supplier_key}|${fp.number}|${fp.issue_date}`;
}

export function mergeFingerprints(...lists: InvoiceFingerprint[][]): InvoiceFingerprint[] {
  const m = new Map<string, InvoiceFingerprint>();
  for (const l of lists) for (const fp of l) m.set(fpKey(fp), fp);
  return [...m.values()];
}

/** Drafts (suspected duplicates) are not "booked": they do not feed the duplicate history. */
function bookedFingerprints(records: ErpRecord[]): InvoiceFingerprint[] {
  return records.filter((r) => r.status !== "draft" && r.fingerprint).map((r) => r.fingerprint!);
}

export class MemoryErp implements Erp {
  readonly label = "mock ERP (in memory)";
  readonly records: ErpRecord[] = [];
  constructor(private seed: InvoiceFingerprint[] = []) {}
  async fingerprints() {
    return mergeFingerprints(this.seed, bookedFingerprints(this.records));
  }
  async post(r: ErpRecord) {
    this.records.push(r);
  }
  async list() {
    return [...this.records];
  }
}

interface ErpFile {
  company: string;
  note: string;
  entries: ErpRecord[];
}

export class FileErp implements Erp {
  readonly label: string;
  constructor(readonly file: string = path.join("data", "erp.local.json")) {
    this.label = file;
  }
  private read(): ErpFile {
    try {
      if (existsSync(this.file)) {
        const j = JSON.parse(readFileSync(this.file, "utf8")) as ErpFile;
        if (Array.isArray(j.entries)) return j;
      }
    } catch {
      /* corrupt: start over */
    }
    return { company: ERP_COMPANY, note: "Mock ERP written by the demo agent (npm run agent). Synthetic data.", entries: [] };
  }
  private write(f: ErpFile) {
    mkdirSync(path.dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(f, null, 2));
  }
  async fingerprints() {
    return bookedFingerprints(this.read().entries);
  }
  async post(r: ErpRecord) {
    const f = this.read();
    f.entries.push(r);
    this.write(f);
  }
  async list() {
    return this.read().entries;
  }
  reset() {
    this.write({ ...this.read(), entries: [] });
  }
}
