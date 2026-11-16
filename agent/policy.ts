/**
 * Spending policy of the demo agent (master prompt §6): the operator gives the agent a
 * max price per call and a daily budget. Deterministic code, never decided by an LLM.
 * All arithmetic in USDC atomic units (6 decimals) to avoid float errors.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { atomicToUsdc, usdcToAtomic } from "../lib/payments/pricing";
import type { SpendLedger, SpendRecord, SpendingPolicy } from "./types";

export const DEFAULT_POLICY: SpendingPolicy = { max_per_call_usdc: "0.20", daily_budget_usdc: "2.00" };

/** Normalises "0.2" → "0.20". Throws on invalid values. */
function normUsdc(v: string): string {
  return atomicToUsdc(usdcToAtomic(v));
}

export function policyFromEnv(overrides: Partial<SpendingPolicy> = {}): SpendingPolicy {
  const pick = (o: string | undefined, env: string | undefined, d: string) => {
    for (const c of [o, env]) {
      if (c && c.trim()) {
        try {
          return normUsdc(c.trim());
        } catch {
          /* ignore invalid value, fall back */
        }
      }
    }
    return d;
  };
  return {
    max_per_call_usdc: pick(overrides.max_per_call_usdc, process.env.AGENT_MAX_PER_CALL_USDC, DEFAULT_POLICY.max_per_call_usdc),
    daily_budget_usdc: pick(overrides.daily_budget_usdc, process.env.AGENT_DAILY_BUDGET_USDC, DEFAULT_POLICY.daily_budget_usdc),
  };
}

export interface PolicyDecision {
  decision: "allow" | "refuse";
  /** Machine-readable reason when refused. */
  code?: "PRICE_ABOVE_MAX_PER_CALL" | "DAILY_BUDGET_EXCEEDED" | "INVALID_PRICE";
  reason: string;
  price_usdc: string;
  max_per_call_usdc: string;
  spent_today_usdc: string;
  daily_budget_usdc: string;
  spent_after_usdc: string;
}

/** price ≤ max_per_call AND spent_today + price ≤ daily_budget → allow; else refuse with a reason. */
export function evaluatePolicy(priceUsdc: string, policy: SpendingPolicy, spentTodayAtomic: bigint): PolicyDecision {
  const base = {
    max_per_call_usdc: policy.max_per_call_usdc,
    daily_budget_usdc: policy.daily_budget_usdc,
    spent_today_usdc: atomicToUsdc(spentTodayAtomic),
  };
  let price: bigint;
  try {
    price = BigInt(usdcToAtomic(priceUsdc));
  } catch {
    return { ...base, decision: "refuse", code: "INVALID_PRICE", reason: `Unreadable price "${priceUsdc}": I never pay an amount I cannot parse.`, price_usdc: priceUsdc, spent_after_usdc: base.spent_today_usdc };
  }
  const max = BigInt(usdcToAtomic(policy.max_per_call_usdc));
  const budget = BigInt(usdcToAtomic(policy.daily_budget_usdc));
  const after = spentTodayAtomic + price;
  const p = atomicToUsdc(price);
  const common = { ...base, price_usdc: p, spent_after_usdc: atomicToUsdc(after) };
  if (price > max) {
    return {
      ...common,
      decision: "refuse",
      code: "PRICE_ABOVE_MAX_PER_CALL",
      reason: `Price ${p} USDC > max per call ${policy.max_per_call_usdc} USDC set by my operator → refused.`,
    };
  }
  if (after > budget) {
    return {
      ...common,
      decision: "refuse",
      code: "DAILY_BUDGET_EXCEEDED",
      reason: `Spent today ${base.spent_today_usdc} + ${p} = ${atomicToUsdc(after)} USDC > daily budget ${policy.daily_budget_usdc} USDC → refused.`,
    };
  }
  return {
    ...common,
    decision: "allow",
    reason: `Price ${p} USDC ≤ max per call ${policy.max_per_call_usdc} USDC. Spent today ${base.spent_today_usdc} + ${p} = ${atomicToUsdc(after)} USDC ≤ daily budget ${policy.daily_budget_usdc} USDC → allowed.`,
  };
}

/** UTC day key "2026-11-16". */
export function dayKey(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** In-memory ledger (serverless route, tests). */
export class MemorySpendLedger implements SpendLedger {
  readonly label = "memory";
  readonly records: SpendRecord[] = [];
  async spentTodayAtomic(now: Date = new Date()): Promise<bigint> {
    const day = dayKey(now);
    return this.records.filter((r) => r.at.slice(0, 10) === day).reduce((s, r) => s + BigInt(r.amount_atomic), 0n);
  }
  async record(r: SpendRecord): Promise<void> {
    this.records.push(r);
  }
}

interface SpendFile {
  wallet?: string;
  days: Record<string, { spent_atomic: string; payments: SpendRecord[] }>;
}

/** File ledger for the CLI: data/agent-spend.local.json (gitignored). Survives runs, resets each UTC day. */
export class FileSpendLedger implements SpendLedger {
  readonly label: string;
  constructor(readonly file: string = path.join("data", "agent-spend.local.json")) {
    this.label = file;
  }
  private read(): SpendFile {
    try {
      if (existsSync(this.file)) return JSON.parse(readFileSync(this.file, "utf8")) as SpendFile;
    } catch {
      /* corrupt file: start over */
    }
    return { days: {} };
  }
  async spentTodayAtomic(now: Date = new Date()): Promise<bigint> {
    const d = this.read().days[dayKey(now)];
    return d ? BigInt(d.spent_atomic) : 0n;
  }
  async record(r: SpendRecord): Promise<void> {
    const f = this.read();
    const k = r.at.slice(0, 10);
    const d = (f.days[k] ??= { spent_atomic: "0", payments: [] });
    d.spent_atomic = (BigInt(d.spent_atomic) + BigInt(r.amount_atomic)).toString();
    d.payments.push(r);
    mkdirSync(path.dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(f, null, 2));
  }
  reset(): void {
    mkdirSync(path.dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify({ days: {} }, null, 2));
  }
}
