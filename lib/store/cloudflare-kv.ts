import type { InvoiceFingerprint } from "@/engine/types";
import { buildStats, counterKey, fingerprintKey, type Counters } from "./stats";
import type { CreditAccount, ReceiptRecord, Store, StoreStats } from "./types";

/** The subset of the Workers KV binding API used here (avoids a @cloudflare/workers-types dependency). */
export interface KVNamespaceLike {
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

const P = "ajean:";
/** Recent request ids kept for /operator (one JSON list). */
const RECENT_MAX = 100;
/** Receipts / idempotency keys expire after 30 days (free KV: 1 GB, plenty for a PoC). */
const TTL_S = 30 * 24 * 3600;

type StatsDoc = Record<string, { calls: number; atomic: string }>;

/**
 * Cloudflare Workers KV store (binding `AJEAN_KV`, free plan: 100k reads + 1k writes / day).
 *
 * Writes per paid call: receipt, idempotency key (if any), recent list, stats counters (+1 per fingerprint),
 * i.e. ~200 paid calls / day on the free plan — plenty for a demo. Recent list and counters are
 * read-modify-write documents: KV is eventually consistent and has no transactions, so two concurrent
 * calls may lose one counter increment (acceptable for a PoC dashboard; receipts themselves are never lost).
 * Any KV error (quota, 429) is caught by ResilientStore, which serves from memory.
 *
 * Credit accounts (ADR-025): one key per token hash, TTL = expiry + 1 day. A credit call adds one more
 * write (the debited balance). KV is eventually consistent across locations (up to ~60 s): the
 * per-instance lock in lib/payments/credits.ts serialises debits inside one isolate, but two isolates in
 * different locations could both read the same balance — a documented PoC limit (a Durable Object or a
 * SQL `UPDATE … WHERE balance >= price` would make it strict).
 */
export class CloudflareKVStore implements Store {
  readonly kind = "cloudflare-kv" as const;

  /** `kv` is resolved per call so a fresh binding from the current request context is always used. */
  constructor(private readonly kv: () => KVNamespaceLike) {}

  private async getJson<T>(key: string): Promise<T | null> {
    return ((await this.kv().get(P + key, "json")) as T | null) ?? null;
  }

  private put(key: string, value: unknown, ttl?: number): Promise<void> {
    return this.kv().put(P + key, JSON.stringify(value), ttl ? { expirationTtl: ttl } : undefined);
  }

  async saveReceipt(r: ReceiptRecord): Promise<void> {
    if (await this.getJson<ReceiptRecord>(`receipt:${r.request_id}`)) return; // already stored
    const [recent, stats] = await Promise.all([this.getJson<string[]>("recent"), this.getJson<StatsDoc>("stats")]);
    const ids = [r.request_id, ...(recent ?? []).filter((id) => id !== r.request_id)].slice(0, RECENT_MAX);
    const s = stats ?? {};
    const k = counterKey(r);
    const cur = s[k] ?? { calls: 0, atomic: "0" };
    s[k] = { calls: cur.calls + 1, atomic: (BigInt(cur.atomic) + BigInt(r.receipt.amount_atomic)).toString() };
    await Promise.all([
      this.put(`receipt:${r.request_id}`, r, TTL_S),
      r.idempotency_key ? this.put(`idem:${r.idempotency_key}`, r.request_id, TTL_S) : Promise.resolve(),
      this.put("recent", ids),
      this.put("stats", s),
    ]);
  }

  getReceipt(id: string): Promise<ReceiptRecord | null> {
    return this.getJson<ReceiptRecord>(`receipt:${id}`);
  }

  async getByIdempotencyKey(key: string): Promise<ReceiptRecord | null> {
    const id = await this.getJson<string>(`idem:${key}`);
    return id ? this.getReceipt(id) : null;
  }

  async listRecent(limit: number): Promise<ReceiptRecord[]> {
    const n = Math.max(0, Math.min(limit, RECENT_MAX));
    if (n === 0) return [];
    const ids = ((await this.getJson<string[]>("recent")) ?? []).slice(0, n);
    const recs = await Promise.all(ids.map((id) => this.getReceipt(id)));
    return recs.filter((r): r is ReceiptRecord => !!r);
  }

  async stats(): Promise<StoreStats> {
    const doc = (await this.getJson<StatsDoc>("stats")) ?? {};
    const counters: Counters = new Map();
    for (const [key, v] of Object.entries(doc)) counters.set(key, { calls: v.calls, atomic: BigInt(v.atomic) });
    return buildStats(this.kind, counters, await this.listRecent(10));
  }

  async saveFingerprint(siren: string, fp: InvoiceFingerprint): Promise<void> {
    const all = (await this.getJson<Record<string, InvoiceFingerprint>>(`fp:${siren}`)) ?? {};
    all[fingerprintKey(fp)] = fp;
    await this.put(`fp:${siren}`, all);
  }

  async history(siren: string): Promise<InvoiceFingerprint[]> {
    return Object.values((await this.getJson<Record<string, InvoiceFingerprint>>(`fp:${siren}`)) ?? {});
  }

  getCredit(tokenHash: string): Promise<CreditAccount | null> {
    return this.getJson<CreditAccount>(`credit:${tokenHash}`);
  }

  async saveCredit(account: CreditAccount): Promise<void> {
    const ttl = Math.max(60, Math.ceil((Date.parse(account.expires_at) - Date.now()) / 1000) + 24 * 3600);
    await this.put(`credit:${account.token_hash}`, account, ttl);
  }
}
