/**
 * Agent spending policy for the stdio MCP bridge (master prompt §6: max_per_call + daily_budget).
 * Amounts are tracked in USDC atomic units (bigint). Relative imports only.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { NETWORK_CAIP2, USDC, atomicToUsdc, usdcToAtomic } from "../lib/payments/pricing";

export interface PolicyConfig {
  maxPerCallUsdc: string;
  dailyBudgetUsdc: string;
  /** Optional JSON file that keeps the daily spend across restarts. */
  ledgerFile?: string;
}

export interface PolicyDecision {
  ok: boolean;
  reason?: string;
}

export const DEFAULT_MAX_PER_CALL_USDC = "0.20";
export const DEFAULT_DAILY_BUDGET_USDC = "2.00";

function parseUsdc(v: string | undefined, fallback: string, name: string): string {
  const raw = (v ?? "").trim() || fallback;
  try {
    usdcToAtomic(raw);
    return raw;
  } catch {
    throw new Error(`${name} must be a USDC amount like "0.20" (got "${raw}")`);
  }
}

export function policyFromEnv(env: NodeJS.ProcessEnv = process.env): PolicyConfig {
  return {
    maxPerCallUsdc: parseUsdc(env.AGENT_MAX_PER_CALL_USDC, DEFAULT_MAX_PER_CALL_USDC, "AGENT_MAX_PER_CALL_USDC"),
    dailyBudgetUsdc: parseUsdc(env.AGENT_DAILY_BUDGET_USDC, DEFAULT_DAILY_BUDGET_USDC, "AGENT_DAILY_BUDGET_USDC"),
    ledgerFile: env.AGENT_SPEND_LEDGER_FILE?.trim() || undefined,
  };
}

const today = (now: Date = new Date()) => now.toISOString().slice(0, 10);

export class SpendingPolicy {
  readonly maxPerCall: bigint;
  readonly dailyBudget: bigint;
  private spent = new Map<string, bigint>();
  private reserved = 0n;

  constructor(
    readonly config: PolicyConfig,
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.maxPerCall = BigInt(usdcToAtomic(config.maxPerCallUsdc));
    this.dailyBudget = BigInt(usdcToAtomic(config.dailyBudgetUsdc));
    this.load();
  }

  spentToday(): bigint {
    return this.spent.get(today(this.clock())) ?? 0n;
  }

  /** Checks a price (atomic USDC) against max-per-call and the remaining daily budget (incl. in-flight reservations). */
  check(amountAtomic: bigint): PolicyDecision {
    if (amountAtomic > this.maxPerCall) {
      return {
        ok: false,
        reason: `price ${atomicToUsdc(amountAtomic)} USDC exceeds AGENT_MAX_PER_CALL_USDC=${atomicToUsdc(this.maxPerCall)} USDC`,
      };
    }
    const after = this.spentToday() + this.reserved + amountAtomic;
    if (after > this.dailyBudget) {
      return {
        ok: false,
        reason: `daily budget exceeded: spent ${atomicToUsdc(this.spentToday())} USDC today (+${atomicToUsdc(this.reserved)} in flight), this call costs ${atomicToUsdc(amountAtomic)} USDC, AGENT_DAILY_BUDGET_USDC=${atomicToUsdc(this.dailyBudget)} USDC`,
      };
    }
    return { ok: true };
  }

  /** Checks the server's x402 requirements (network, asset, amount) before signing anything. */
  checkRequirements(req: { network: string; asset: string; amount: string; scheme: string }): PolicyDecision {
    if (req.network !== NETWORK_CAIP2) return { ok: false, reason: `network ${req.network} refused (testnet only: ${NETWORK_CAIP2})` };
    if (req.asset.toLowerCase() !== USDC.address.toLowerCase()) return { ok: false, reason: `asset ${req.asset} refused (only test USDC ${USDC.address})` };
    if (req.scheme !== "exact") return { ok: false, reason: `scheme ${req.scheme} refused (only exact)` };
    if (!/^\d+$/.test(req.amount)) return { ok: false, reason: `invalid amount ${req.amount}` };
    return this.check(BigInt(req.amount));
  }

  reserve(amountAtomic: bigint): void {
    this.reserved += amountAtomic;
  }

  release(amountAtomic: bigint): void {
    this.reserved = this.reserved > amountAtomic ? this.reserved - amountAtomic : 0n;
  }

  /** Records a settled payment (moves it from reserved to spent). */
  commit(amountAtomic: bigint): void {
    this.release(amountAtomic);
    const d = today(this.clock());
    this.spent.set(d, (this.spent.get(d) ?? 0n) + amountAtomic);
    this.save();
  }

  summary() {
    return {
      max_per_call_usdc: atomicToUsdc(this.maxPerCall),
      daily_budget_usdc: atomicToUsdc(this.dailyBudget),
      spent_today_usdc: atomicToUsdc(this.spentToday()),
      remaining_today_usdc: atomicToUsdc(this.dailyBudget > this.spentToday() ? this.dailyBudget - this.spentToday() : 0n),
    };
  }

  private load(): void {
    const f = this.config.ledgerFile;
    if (!f || !existsSync(f)) return;
    try {
      const data = JSON.parse(readFileSync(f, "utf8")) as Record<string, string>;
      for (const [d, v] of Object.entries(data)) if (/^\d+$/.test(v)) this.spent.set(d, BigInt(v));
    } catch {
      /* ignore a corrupt ledger: start from zero */
    }
  }

  private save(): void {
    const f = this.config.ledgerFile;
    if (!f) return;
    try {
      mkdirSync(path.dirname(f), { recursive: true });
      const d = today(this.clock());
      writeFileSync(f, JSON.stringify({ [d]: (this.spent.get(d) ?? 0n).toString() }, null, 2));
    } catch (e) {
      console.error(`[ajean-mcp] could not write spend ledger: ${(e as Error).message}`);
    }
  }
}
