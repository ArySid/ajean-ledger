import type { Redis } from "@upstash/redis";
import type { InvoiceFingerprint } from "@/engine/types";
import { buildStats, fingerprintKey, type Counters } from "./stats";
import type { ReceiptRecord, Store, StoreStats } from "./types";

const P = "ajean:";
const RECENT_MAX = 1000;

/** Upstash Redis (REST) store. Counters are kept in one hash for O(1) stats. */
export class UpstashStore implements Store {
  readonly kind = "upstash" as const;
  private client: Promise<Redis> | null = null;

  constructor(
    private readonly url: string,
    private readonly token: string,
  ) {}

  private redis(): Promise<Redis> {
    this.client ??= import("@upstash/redis").then(({ Redis }) => new Redis({ url: this.url, token: this.token }));
    return this.client;
  }

  async saveReceipt(r: ReceiptRecord): Promise<void> {
    const redis = await this.redis();
    const created = await redis.set(`${P}receipt:${r.request_id}`, r, { nx: true });
    if (created === null) return; // already stored
    const p = redis.pipeline();
    if (r.idempotency_key) p.set(`${P}idem:${r.idempotency_key}`, r.request_id);
    p.lpush(`${P}recent`, r.request_id);
    p.ltrim(`${P}recent`, 0, RECENT_MAX - 1);
    p.hincrby(`${P}stats`, `calls:${r.receipt.mode}:${r.endpoint}`, 1);
    p.hincrby(`${P}stats`, `atomic:${r.receipt.mode}:${r.endpoint}`, Number(r.receipt.amount_atomic));
    await p.exec();
  }

  async getReceipt(id: string): Promise<ReceiptRecord | null> {
    return (await (await this.redis()).get<ReceiptRecord>(`${P}receipt:${id}`)) ?? null;
  }

  async getByIdempotencyKey(key: string): Promise<ReceiptRecord | null> {
    const id = await (await this.redis()).get<string>(`${P}idem:${key}`);
    return id ? this.getReceipt(id) : null;
  }

  async listRecent(limit: number): Promise<ReceiptRecord[]> {
    const redis = await this.redis();
    const n = Math.max(0, Math.min(limit, RECENT_MAX));
    if (n === 0) return [];
    const ids = await redis.lrange<string>(`${P}recent`, 0, n - 1);
    if (ids.length === 0) return [];
    const recs = await redis.mget<(ReceiptRecord | null)[]>(...ids.map((id) => `${P}receipt:${id}`));
    return recs.filter((r): r is ReceiptRecord => !!r);
  }

  async stats(): Promise<StoreStats> {
    const raw = (await (await this.redis()).hgetall<Record<string, string | number>>(`${P}stats`)) ?? {};
    const counters: Counters = new Map();
    for (const [field, value] of Object.entries(raw)) {
      const [kind, mode, endpoint] = field.split(":");
      const key = `${mode}:${endpoint}`;
      const cur = counters.get(key) ?? { calls: 0, atomic: 0n };
      if (kind === "calls") cur.calls = Number(value);
      if (kind === "atomic") cur.atomic = BigInt(String(value));
      counters.set(key, cur);
    }
    return buildStats(this.kind, counters, await this.listRecent(10));
  }

  async saveFingerprint(siren: string, fp: InvoiceFingerprint): Promise<void> {
    await (await this.redis()).hset(`${P}fp:${siren}`, { [fingerprintKey(fp)]: fp });
  }

  async history(siren: string): Promise<InvoiceFingerprint[]> {
    const all = await (await this.redis()).hgetall<Record<string, InvoiceFingerprint>>(`${P}fp:${siren}`);
    return Object.values(all ?? {});
  }
}
