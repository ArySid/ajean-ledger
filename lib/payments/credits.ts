/**
 * Prepaid credit packs (Phase 6 bonus, ADR-025).
 *
 * A pack is bought with ONE x402 payment (POST /api/v1/credits). The buyer receives an opaque bearer
 * token (`ajc_…`, 256 bits); the store keeps only its SHA-256 (hex), the pack, the balance (USDC atomic)
 * and the expiry (30 days). The token IS a prepaid payment: sent in `X-Credit-Token`, it pays a paid
 * endpoint at its USDC price instead of an x402 payment (no settlement, no on-chain transaction).
 *
 * Token = "ajc_" + base64url(HMAC-SHA256(secret, purchase request_id)). Deriving it from the purchase
 * lets an idempotent replay of the purchase hand the same token back without ever storing it.
 * secret = CREDIT_TOKEN_SECRET (optional Worker secret) or, when unset, a random per-process secret
 * (then a replay served by another instance / after a restart returns the receipt without the token).
 *
 * Debits are "atomic-ish": a per-instance async lock per token serialises reserve/refund inside one
 * isolate/process. Across instances the store's own consistency applies (Workers KV is eventually
 * consistent: two locations could both spend the same last cents; documented limit).
 * Reserve → compute → refund on failure keeps "never charged on error".
 */
import { createHash, createHmac, randomBytes } from "node:crypto";
import type { CreditAccount } from "@/lib/store";
import type { PaymentMode } from "./config";
import { CREDIT_PACKS, CREDIT_TTL_DAYS, type AssetSymbol, type CreditPackId } from "./pricing";

export const CREDIT_TOKEN_PREFIX = "ajc_";
export const CREDIT_TOKEN_RE = /^ajc_[A-Za-z0-9_-]{43}$/;

type Global = typeof globalThis & { __ajeanCreditSecret?: Buffer; __ajeanCreditLocks?: Map<string, Promise<unknown>> };

function secret(): Buffer {
  const env = process.env.CREDIT_TOKEN_SECRET?.trim();
  if (env && env.length >= 16) return Buffer.from(env, "utf8");
  const g = globalThis as Global;
  return (g.__ajeanCreditSecret ??= randomBytes(32));
}

/** True when tokens can be re-derived on any instance (CREDIT_TOKEN_SECRET configured). */
export function creditSecretConfigured(): boolean {
  return (process.env.CREDIT_TOKEN_SECRET?.trim().length ?? 0) >= 16;
}

/** The bearer token of the pack bought by `purchaseRequestId`. */
export function deriveCreditToken(purchaseRequestId: string): string {
  return CREDIT_TOKEN_PREFIX + createHmac("sha256", secret()).update(`credit-token:v1:${purchaseRequestId}`).digest("base64url");
}

export function hashCreditToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Non-secret, human-friendly id of a token (first 12 hex chars of its hash). */
export function creditTokenId(tokenHash: string): string {
  return `ct_${tokenHash.slice(0, 12)}`;
}

/** Normalised token from the header value, or null when malformed. */
export function parseCreditToken(raw: string | null | undefined): string | null {
  const t = raw?.trim() ?? "";
  return CREDIT_TOKEN_RE.test(t) ? t : null;
}

export function newCreditAccount(args: {
  tokenHash: string;
  pack: CreditPackId;
  mode: PaymentMode;
  purchaseRequestId: string;
  paidAsset: AssetSymbol;
  paidAmountAtomic: string;
  now?: Date;
}): CreditAccount {
  const now = args.now ?? new Date();
  const pack = CREDIT_PACKS[args.pack];
  return {
    token_hash: args.tokenHash,
    pack: pack.id,
    mode: args.mode,
    initial_atomic: pack.credit_atomic,
    balance_atomic: pack.credit_atomic,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    expires_at: new Date(now.getTime() + CREDIT_TTL_DAYS * 24 * 3600 * 1000).toISOString(),
    purchase_request_id: args.purchaseRequestId,
    paid_asset: args.paidAsset,
    paid_amount_atomic: args.paidAmountAtomic,
    calls: 0,
  };
}

/** Per-instance async mutex per token hash. */
export async function withCreditLock<T>(tokenHash: string, fn: () => Promise<T>): Promise<T> {
  const g = globalThis as Global;
  const locks = (g.__ajeanCreditLocks ??= new Map());
  const prev = locks.get(tokenHash) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  const chained = prev.then(() => mine);
  locks.set(tokenHash, chained);
  await prev.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(tokenHash) === chained) locks.delete(tokenHash);
  }
}

export type CreditRefusal = "unknown" | "expired" | "wrong_mode" | "insufficient";

export type ReserveResult =
  | { ok: true; account: CreditAccount; remaining: bigint }
  | { ok: false; reason: CreditRefusal; account: CreditAccount | null };

interface CreditStoreLike {
  getCredit(tokenHash: string): Promise<CreditAccount | null>;
  saveCredit(account: CreditAccount): Promise<void>;
}

/** Why an account cannot be used now (or null when it can). */
export function accountProblem(account: CreditAccount | null, mode: PaymentMode, now: Date = new Date()): Exclude<CreditRefusal, "insufficient"> | null {
  if (!account) return "unknown";
  if (account.mode !== mode) return "wrong_mode";
  if (Date.parse(account.expires_at) <= now.getTime()) return "expired";
  return null;
}

/** Debits `amountAtomic` (USDC) under the per-token lock, if the balance allows it. */
export function reserveCredit(store: CreditStoreLike, tokenHash: string, amountAtomic: string, mode: PaymentMode, now: Date = new Date()): Promise<ReserveResult> {
  return withCreditLock(tokenHash, async () => {
    const account = await store.getCredit(tokenHash);
    const problem = accountProblem(account, mode, now);
    if (problem) return { ok: false, reason: problem, account };
    const balance = BigInt(account!.balance_atomic);
    const price = BigInt(amountAtomic);
    if (balance < price) return { ok: false, reason: "insufficient", account };
    const remaining = balance - price;
    const updated: CreditAccount = { ...account!, balance_atomic: remaining.toString(), calls: account!.calls + 1, updated_at: now.toISOString() };
    await store.saveCredit(updated);
    return { ok: true, account: updated, remaining };
  });
}

/** Gives back a reserved debit (the call failed: never charged on error). */
export function refundCredit(store: CreditStoreLike, tokenHash: string, amountAtomic: string): Promise<void> {
  return withCreditLock(tokenHash, async () => {
    const account = await store.getCredit(tokenHash);
    if (!account) return;
    await store.saveCredit({
      ...account,
      balance_atomic: (BigInt(account.balance_atomic) + BigInt(amountAtomic)).toString(),
      calls: Math.max(0, account.calls - 1),
      updated_at: new Date().toISOString(),
    });
  });
}

export const CREDIT_REFUSAL_MESSAGES: Record<CreditRefusal, string> = {
  unknown: "Unknown credit token (malformed, never issued, or not on this deployment's store).",
  expired: "This credit token has expired.",
  wrong_mode: "This credit token was bought in another payment mode (TESTNET vs SIMULATED).",
  insufficient: "The credit token balance is lower than the price of this call.",
};
