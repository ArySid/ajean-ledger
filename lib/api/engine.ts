/**
 * Thin adapter between the API layer and the accounting engine ("@/engine").
 * The contract (signatures and result types) is engine/types.ts; the engine is
 * built by another workstream, so its functions are looked up at call time:
 * if they are missing the API answers 503 ENGINE_UNAVAILABLE (never charged)
 * instead of failing the build.
 */
import * as Engine from "@/engine";
import type {
  AuditEntryInput,
  AuditResult,
  CheckResult,
  ClientProfile,
  EngineContext,
  EngineInput,
  EntryResult,
  InvoiceFingerprint,
  InvoiceInput,
  LlmAdapter,
} from "@/engine/types";
import { ApiError } from "./errors";

export interface EngineApi {
  createEntry(input: EngineInput, ctx?: EngineContext): Promise<EntryResult>;
  checkInvoice(input: EngineInput, ctx?: EngineContext): Promise<CheckResult>;
  auditEntries(items: AuditEntryInput[], ctx?: EngineContext): Promise<AuditResult>;
  fingerprint?(inv: InvoiceInput): InvoiceFingerprint;
  DEMO_PROFILE?: ClientProfile;
  createAnthropicAdapter?: () => LlmAdapter | null | undefined;
}

const mod = Engine as unknown as Partial<EngineApi>;

export function engineReady(): boolean {
  return typeof mod.createEntry === "function" && typeof mod.checkInvoice === "function" && typeof mod.auditEntries === "function";
}

export function getEngine(): EngineApi {
  if (!engineReady()) {
    throw new ApiError("ENGINE_UNAVAILABLE", "The accounting engine is not available in this build. The call was not charged.");
  }
  return mod as EngineApi;
}

export function defaultProfile(): ClientProfile | undefined {
  return mod.DEMO_PROFILE;
}

/** LLM adapter for pdf/image extraction, only when the engine exposes one and a key is configured. */
export function llmAdapter(): LlmAdapter | undefined {
  if (!process.env.ANTHROPIC_API_KEY || typeof mod.createAnthropicAdapter !== "function") return undefined;
  try {
    return mod.createAnthropicAdapter() ?? undefined;
  } catch {
    return undefined;
  }
}

/** Fingerprint of a processed invoice, from the engine helper when available. */
export function fingerprintOf(summary: EntryResult["invoice"]): InvoiceFingerprint | null {
  if (!summary?.number || !summary.date) return null;
  const pseudo = {
    document_type: summary.document_type,
    number: summary.number,
    issue_date: summary.date,
    currency: "EUR",
    supplier: summary.supplier,
    customer: summary.customer,
    lines: [],
    totals: summary.totals,
  } as InvoiceInput;
  try {
    if (typeof mod.fingerprint === "function") return mod.fingerprint(pseudo);
  } catch {
    /* fall through */
  }
  const s = summary.supplier;
  return {
    supplier_key: (s?.siren || s?.vat_id || s?.name || "unknown").toString().trim().toUpperCase(),
    number: summary.number,
    issue_date: summary.date,
    total_incl_vat: summary.totals?.total_incl_vat ?? 0,
  };
}
