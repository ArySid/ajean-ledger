import type { InvoiceFingerprint } from "@/engine/types";
import { buildStats, countersFromRecords, fingerprintKey } from "./stats";
import type { ReceiptRecord, Store, StoreStats } from "./types";

const MAX_RECORDS = 5000;

/** In-process store. Default; also the fallback when a persistent store fails. */
export class MemoryStore implements Store {
  readonly kind = "memory" as const;
  private receipts = new Map<string, ReceiptRecord>();
  private idem = new Map<string, string>();
  private fps = new Map<string, Map<string, InvoiceFingerprint>>();

  async saveReceipt(r: ReceiptRecord): Promise<void> {
    this.receipts.set(r.request_id, r);
    if (r.idempotency_key) this.idem.set(r.idempotency_key, r.request_id);
    if (this.receipts.size > MAX_RECORDS) {
      const oldest = this.receipts.keys().next().value as string;
      const old = this.receipts.get(oldest);
      this.receipts.delete(oldest);
      if (old?.idempotency_key) this.idem.delete(old.idempotency_key);
    }
  }

  async getReceipt(id: string): Promise<ReceiptRecord | null> {
    return this.receipts.get(id) ?? null;
  }

  async getByIdempotencyKey(key: string): Promise<ReceiptRecord | null> {
    const id = this.idem.get(key);
    return id ? (this.receipts.get(id) ?? null) : null;
  }

  async listRecent(limit: number): Promise<ReceiptRecord[]> {
    return [...this.receipts.values()].reverse().slice(0, Math.max(0, limit));
  }

  async stats(): Promise<StoreStats> {
    return buildStats(this.kind, countersFromRecords([...this.receipts.values()]), await this.listRecent(10));
  }

  async saveFingerprint(siren: string, fp: InvoiceFingerprint): Promise<void> {
    const m = this.fps.get(siren) ?? new Map<string, InvoiceFingerprint>();
    m.set(fingerprintKey(fp), fp);
    this.fps.set(siren, m);
  }

  async history(siren: string): Promise<InvoiceFingerprint[]> {
    return [...(this.fps.get(siren)?.values() ?? [])];
  }
}
