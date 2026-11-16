import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { InvoiceFingerprint } from "@/engine/types";
import { buildStats, countersFromRecords, fingerprintKey } from "./stats";
import type { ReceiptRecord, Store, StoreStats } from "./types";

interface FileData {
  receipts: ReceiptRecord[];
  fingerprints: Record<string, Record<string, InvoiceFingerprint>>;
}

export const DEFAULT_FILE_PATH = "data/receipts.local.json";
const MAX_RECORDS = 5000;

/** Local-dev JSON file store (gitignored). Not for serverless (read-only FS → falls back to memory). */
export class FileStore implements Store {
  readonly kind = "file" as const;
  private readonly file: string;

  constructor(file: string | undefined = process.env.STORE_FILE_PATH) {
    // Statically scoped default path, so Next's output tracing does not include the whole project.
    this.file = file
      ? path.resolve(/*turbopackIgnore: true*/ process.cwd(), file)
      : path.join(process.cwd(), "data", "receipts.local.json");
  }

  private read(): FileData {
    if (!existsSync(this.file)) return { receipts: [], fingerprints: {} };
    const data = JSON.parse(readFileSync(this.file, "utf8")) as Partial<FileData>;
    return { receipts: data.receipts ?? [], fingerprints: data.fingerprints ?? {} };
  }

  private write(data: FileData): void {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, this.file);
  }

  async saveReceipt(r: ReceiptRecord): Promise<void> {
    const d = this.read();
    d.receipts = d.receipts.filter((x) => x.request_id !== r.request_id);
    d.receipts.push(r);
    if (d.receipts.length > MAX_RECORDS) d.receipts = d.receipts.slice(-MAX_RECORDS);
    this.write(d);
  }

  async getReceipt(id: string): Promise<ReceiptRecord | null> {
    return this.read().receipts.find((r) => r.request_id === id) ?? null;
  }

  async getByIdempotencyKey(key: string): Promise<ReceiptRecord | null> {
    return this.read().receipts.find((r) => r.idempotency_key === key) ?? null;
  }

  async listRecent(limit: number): Promise<ReceiptRecord[]> {
    return this.read().receipts.slice().reverse().slice(0, Math.max(0, limit));
  }

  async stats(): Promise<StoreStats> {
    const all = this.read().receipts;
    return buildStats(this.kind, countersFromRecords(all), all.slice().reverse().slice(0, 10));
  }

  async saveFingerprint(siren: string, fp: InvoiceFingerprint): Promise<void> {
    const d = this.read();
    (d.fingerprints[siren] ??= {})[fingerprintKey(fp)] = fp;
    this.write(d);
  }

  async history(siren: string): Promise<InvoiceFingerprint[]> {
    return Object.values(this.read().fingerprints[siren] ?? {});
  }
}
