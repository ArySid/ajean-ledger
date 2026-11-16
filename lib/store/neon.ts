import type { InvoiceFingerprint } from "@/engine/types";
import { buildStats, type Counters } from "./stats";
import type { CreditAccount, ReceiptRecord, Store, StoreStats } from "./types";

type Row = Record<string, unknown>;
type Sql = (strings: TemplateStringsArray, ...params: unknown[]) => Promise<Row[]>;

/**
 * Neon Postgres store (optional, Neon free plan via DATABASE_URL). Tables are created
 * IF NOT EXISTS on first use: `ajean_receipts` and `ajean_fingerprints`.
 */
export class NeonStore implements Store {
  readonly kind = "neon" as const;
  private sqlPromise: Promise<Sql> | null = null;
  private ready: Promise<void> | null = null;

  constructor(private readonly url: string) {}

  private async sql(): Promise<Sql> {
    this.sqlPromise ??= import("@neondatabase/serverless").then(({ neon }) => neon(this.url) as unknown as Sql);
    const sql = await this.sqlPromise;
    this.ready ??= (async () => {
      await sql`CREATE TABLE IF NOT EXISTS ajean_receipts (
        request_id TEXT PRIMARY KEY,
        endpoint TEXT NOT NULL,
        idempotency_key TEXT UNIQUE,
        request_hash TEXT NOT NULL,
        mode TEXT NOT NULL,
        amount_atomic BIGINT NOT NULL,
        tx_hash TEXT,
        payer TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        record JSONB NOT NULL
      )`;
      await sql`CREATE TABLE IF NOT EXISTS ajean_fingerprints (
        profile_siren TEXT NOT NULL,
        fp_key TEXT NOT NULL,
        fingerprint JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (profile_siren, fp_key)
      )`;
      await sql`CREATE TABLE IF NOT EXISTS ajean_credits (
        token_hash TEXT PRIMARY KEY,
        account JSONB NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
    })().catch((e) => {
      this.ready = null;
      throw e;
    });
    await this.ready;
    return sql;
  }

  async saveReceipt(r: ReceiptRecord): Promise<void> {
    const sql = await this.sql();
    await sql`INSERT INTO ajean_receipts
      (request_id, endpoint, idempotency_key, request_hash, mode, amount_atomic, tx_hash, payer, created_at, record)
      VALUES (${r.request_id}, ${r.endpoint}, ${r.idempotency_key}, ${r.request_hash}, ${r.receipt.mode},
              ${r.receipt.amount_atomic}, ${r.receipt.tx_hash}, ${r.receipt.payer}, ${r.created_at}, ${JSON.stringify(r)}::jsonb)
      ON CONFLICT (request_id) DO NOTHING`;
  }

  async getReceipt(id: string): Promise<ReceiptRecord | null> {
    const sql = await this.sql();
    const rows = await sql`SELECT record FROM ajean_receipts WHERE request_id = ${id} LIMIT 1`;
    return (rows[0]?.record as ReceiptRecord | undefined) ?? null;
  }

  async getByIdempotencyKey(key: string): Promise<ReceiptRecord | null> {
    const sql = await this.sql();
    const rows = await sql`SELECT record FROM ajean_receipts WHERE idempotency_key = ${key} LIMIT 1`;
    return (rows[0]?.record as ReceiptRecord | undefined) ?? null;
  }

  async listRecent(limit: number): Promise<ReceiptRecord[]> {
    const sql = await this.sql();
    const rows = await sql`SELECT record FROM ajean_receipts ORDER BY created_at DESC LIMIT ${Math.max(0, Math.min(limit, 500))}`;
    return rows.map((r) => r.record as ReceiptRecord);
  }

  async stats(): Promise<StoreStats> {
    const sql = await this.sql();
    // Channel = the asset paid via x402, or "credits" (rows written before ADR-024/027 read as USDC).
    const rows = await sql`SELECT mode, endpoint,
        CASE WHEN record->'receipt'->>'method' = 'credits' THEN 'credits'
             ELSE COALESCE(record->'receipt'->>'asset', 'USDC') END AS channel,
        COUNT(*)::int AS calls, COALESCE(SUM(amount_atomic), 0)::text AS atomic
      FROM ajean_receipts GROUP BY 1, 2, 3`;
    const counters: Counters = new Map();
    for (const row of rows) {
      counters.set(`${row.mode}:${row.endpoint}:${row.channel}`, { calls: Number(row.calls), atomic: BigInt(String(row.atomic)) });
    }
    return buildStats(this.kind, counters, await this.listRecent(10));
  }

  async saveFingerprint(siren: string, fp: InvoiceFingerprint): Promise<void> {
    const sql = await this.sql();
    const key = `${fp.supplier_key}|${fp.number}|${fp.issue_date}`;
    await sql`INSERT INTO ajean_fingerprints (profile_siren, fp_key, fingerprint)
      VALUES (${siren}, ${key}, ${JSON.stringify(fp)}::jsonb) ON CONFLICT (profile_siren, fp_key) DO NOTHING`;
  }

  async history(siren: string): Promise<InvoiceFingerprint[]> {
    const sql = await this.sql();
    const rows = await sql`SELECT fingerprint FROM ajean_fingerprints WHERE profile_siren = ${siren} ORDER BY created_at LIMIT 1000`;
    return rows.map((r) => r.fingerprint as InvoiceFingerprint);
  }

  async getCredit(tokenHash: string): Promise<CreditAccount | null> {
    const sql = await this.sql();
    const rows = await sql`SELECT account FROM ajean_credits WHERE token_hash = ${tokenHash} LIMIT 1`;
    return (rows[0]?.account as CreditAccount | undefined) ?? null;
  }

  async saveCredit(account: CreditAccount): Promise<void> {
    const sql = await this.sql();
    await sql`INSERT INTO ajean_credits (token_hash, account, expires_at, updated_at)
      VALUES (${account.token_hash}, ${JSON.stringify(account)}::jsonb, ${account.expires_at}, now())
      ON CONFLICT (token_hash) DO UPDATE SET account = EXCLUDED.account, updated_at = now()`;
  }
}
