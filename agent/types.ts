/**
 * Types of the demo client agent ("SME purchasing agent" of Atelier Lumen SAS, fictional).
 * The agent is a CLIENT of Ajean Ledger: it only talks to the service over HTTP + x402.
 */
import type { PrivateKeyAccount } from "viem/accounts";
import type { InvoiceFingerprint } from "../engine/types";
import type { AgentTrace, TraceStep } from "../lib/trace/types";

export type AgentTask = "entry" | "invoice_check" | "audit";

/** One item of the agent's inbox (inbox/*.json), resolved to a request body. */
export interface InboxItem {
  id: string;
  /** Path shown in the trace, e.g. "inbox/03-le-bouchon-lumiere-restaurant.json". */
  file: string;
  kind: "supplier_invoice" | "audit_request";
  received_at?: string;
  channel?: string;
  from?: string;
  subject?: string;
  task: AgentTask;
  /** The document(s) to send (EngineInput for entry/check, items for audit). */
  input?: Record<string, unknown>;
  audit_items?: Record<string, unknown>[];
  /** Fingerprints the ERP already held before this run (from the fixture context). */
  erp_seed?: InvoiceFingerprint[];
  /** Fixture ids the item was built from (source of truth). */
  fixtures: string[];
}

export interface SpendingPolicy {
  max_per_call_usdc: string;
  daily_budget_usdc: string;
}

export interface SpendRecord {
  at: string;
  amount_atomic: string;
  endpoint: string;
  request_id?: string;
  tx_hash?: string;
}

/** Daily spend tracking (file for the CLI, memory inside the serverless route). */
export interface SpendLedger {
  readonly label: string;
  spentTodayAtomic(now?: Date): Promise<bigint>;
  record(r: SpendRecord): Promise<void>;
}

export type ErpStatus = "posted" | "posted_review_pending" | "draft";

export interface ErpRecord {
  erp_id: string;
  status: ErpStatus;
  recorded_at: string;
  source: string;
  journal: string;
  date: string;
  reference: string;
  supplier: string;
  lines: { account: string; label: string; debit: number; credit: number }[];
  total_debit: number;
  total_credit: number;
  request_id: string | null;
  receipt: { amount?: string; tx_hash?: string; mode?: string; explorer_url?: string | null } | null;
  review_reasons: string[];
  fingerprint: InvoiceFingerprint | null;
}

/** Mock ERP (data/erp.local.json for the CLI, memory inside the route). */
export interface Erp {
  readonly label: string;
  fingerprints(): Promise<InvoiceFingerprint[]>;
  post(r: ErpRecord): Promise<void>;
  list(): Promise<ErpRecord[]>;
}

export type ReasoningMode = "scripted" | "llm";

export interface RunAgentOptions {
  serviceUrl: string;
  item: InboxItem;
  /** Informational label only: the server decides the real payment mode (read from /api/health). */
  mode?: "testnet" | "simulated";
  wallet: PrivateKeyAccount;
  /** Set when the wallet is an ephemeral key generated for this run (simulated only). */
  walletNote?: string;
  policy: SpendingPolicy;
  ledger: SpendLedger;
  erp: Erp;
  reasoning?: ReasoningMode;
  onStep?: (step: TraceStep, index: number) => void;
  /** Hard deadline for the whole run (ms). Default 40 s. */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  agentName?: string;
  /** Label of the trace ("01 · Office supplies …"); defaults to a label built from the item. */
  scenarioLabel?: string;
}

export type { AgentTrace, TraceStep };
