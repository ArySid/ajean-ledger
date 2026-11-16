/**
 * Storage for receipts, idempotency keys, operator stats and invoice fingerprints.
 *
 * Storage is OPTIONAL: any adapter error is logged once and the store falls back
 * to memory, so the paid API keeps working (ADR-010).
 *
 * Selection (STORE_KIND = auto | memory | file | neon | upstash | cloudflare-kv, default auto):
 *   auto → cloudflare-kv when running on Cloudflare Workers with the AJEAN_KV binding (docs/HOSTING.md),
 *          else neon if DATABASE_URL / POSTGRES_URL is set,
 *          else upstash if UPSTASH_REDIS_REST_URL+TOKEN or KV_REST_API_URL+TOKEN are set,
 *          else memory.
 *   file → data/receipts.local.json (local dev, gitignored; override with STORE_FILE_PATH). Never on Workers.
 */
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { InvoiceFingerprint } from "@/engine/types";
import { CloudflareKVStore, type KVNamespaceLike } from "./cloudflare-kv";
import { FileStore } from "./file";
import { MemoryStore } from "./memory";
import { NeonStore } from "./neon";
import { UpstashStore } from "./upstash";
import type { CreditAccount, ReceiptRecord, Store, StoreKind, StoreStats } from "./types";

export type { AssetRevenue, CreditAccount, CreditStats, ReceiptEndpointId, ReceiptRecord, Store, StoreKind, StoreStats, TxSummary, EndpointRevenue } from "./types";
export { MemoryStore } from "./memory";

/** Retry the primary store this long after a failure. */
const RETRY_PRIMARY_AFTER_MS = 60_000;

/** Wraps a primary adapter; on any error logs once and serves from memory. */
export class ResilientStore implements Store {
  private failedAt: number | null = null;
  private logged = false;
  readonly fallback = new MemoryStore();

  constructor(readonly primary: Store) {}

  get kind(): StoreKind {
    return this.degraded ? "memory" : this.primary.kind;
  }

  get configuredKind(): StoreKind {
    return this.primary.kind;
  }

  get degraded(): boolean {
    return this.primary.kind !== "memory" && this.failedAt !== null && Date.now() - this.failedAt < RETRY_PRIMARY_AFTER_MS;
  }

  private async run<T>(op: string, fn: (s: Store) => Promise<T>): Promise<T> {
    if (!this.degraded) {
      try {
        const out = await fn(this.primary);
        this.failedAt = null;
        return out;
      } catch (e) {
        this.failedAt = Date.now();
        if (!this.logged) {
          this.logged = true;
          console.error(
            `[store] ${this.primary.kind} store failed during ${op} (${e instanceof Error ? e.message : String(e)}); falling back to memory.`,
          );
        }
      }
    }
    return fn(this.fallback);
  }

  saveReceipt(r: ReceiptRecord) {
    return this.run("saveReceipt", (s) => s.saveReceipt(r));
  }
  async getReceipt(id: string) {
    const hit = await this.run("getReceipt", (s) => s.getReceipt(id));
    return hit ?? (this.primary.kind !== "memory" ? this.fallback.getReceipt(id) : null);
  }
  async getByIdempotencyKey(k: string) {
    const hit = await this.run("getByIdempotencyKey", (s) => s.getByIdempotencyKey(k));
    return hit ?? (this.primary.kind !== "memory" ? this.fallback.getByIdempotencyKey(k) : null);
  }
  listRecent(limit: number) {
    return this.run("listRecent", (s) => s.listRecent(limit));
  }
  async stats(): Promise<StoreStats> {
    const s = await this.run("stats", (st) => st.stats());
    return { ...s, store: this.kind };
  }
  saveFingerprint(siren: string, fp: InvoiceFingerprint) {
    return this.run("saveFingerprint", (s) => s.saveFingerprint(siren, fp));
  }
  history(siren: string) {
    return this.run("history", (s) => s.history(siren));
  }
  async getCredit(tokenHash: string) {
    const hit = await this.run("getCredit", (s) => s.getCredit(tokenHash));
    return hit ?? (this.primary.kind !== "memory" ? this.fallback.getCredit(tokenHash) : null);
  }
  saveCredit(account: CreditAccount) {
    return this.run("saveCredit", (s) => s.saveCredit(account));
  }
}

/** Cloudflare Workers request context, or null outside Workers (next dev/start, tests, CLI). Never throws. */
function cloudflareEnv(): Record<string, unknown> | null {
  try {
    return getCloudflareContext().env as unknown as Record<string, unknown>;
  } catch {
    return null;
  }
}

function kvBinding(): KVNamespaceLike | null {
  const kv = cloudflareEnv()?.AJEAN_KV as KVNamespaceLike | undefined;
  return kv && typeof kv.get === "function" && typeof kv.put === "function" ? kv : null;
}

function createPrimary(): Store {
  const want = (process.env.STORE_KIND ?? "auto").trim().toLowerCase();
  const onWorkers = cloudflareEnv() !== null;
  if ((want === "auto" || want === "cloudflare-kv") && kvBinding()) {
    return new CloudflareKVStore(() => {
      const kv = kvBinding();
      if (!kv) throw new Error("AJEAN_KV binding unavailable");
      return kv;
    });
  }
  if (onWorkers && want === "file") {
    console.warn('[store] STORE_KIND="file" is not supported on Cloudflare Workers (no persistent disk); using memory.');
    return new MemoryStore();
  }
  const pg = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  const upUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const upToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  if (want === "memory") return new MemoryStore();
  if (want === "file") return new FileStore();
  if ((want === "neon" || want === "auto") && pg) return new NeonStore(pg);
  if ((want === "upstash" || want === "auto") && upUrl && upToken) return new UpstashStore(upUrl, upToken);
  if (want !== "auto") console.warn(`[store] STORE_KIND="${want}" is not configured (missing env); using memory.`);
  return new MemoryStore();
}

type Global = typeof globalThis & { __ajeanStore?: ResilientStore };

/** Process-wide store singleton (on globalThis so every route bundle shares it). */
export function getStore(): ResilientStore {
  const g = globalThis as Global;
  return (g.__ajeanStore ??= new ResilientStore(createPrimary()));
}

/** Effective store kind ("memory" when degraded). */
export function getStoreKind(): StoreKind {
  return getStore().kind;
}

export function getStoreInfo(): { kind: StoreKind; configured: StoreKind; degraded: boolean } {
  const s = getStore();
  return { kind: s.kind, configured: s.configuredKind, degraded: s.degraded };
}

/** Test helper: replace (or reset with `undefined`) the singleton. */
export function setStoreForTests(primary?: Store): ResilientStore | undefined {
  const g = globalThis as Global;
  g.__ajeanStore = primary ? new ResilientStore(primary) : undefined;
  return g.__ajeanStore;
}
