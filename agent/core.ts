/**
 * runAgent(): the autonomous "SME purchasing agent" of Atelier Lumenor SAS (fictional).
 *
 * One run = one inbox item = one AgentTrace (lib/trace/types.ts), the format rendered by the
 * /live console and stored as replays. Steps:
 *   reasoning → discovery (GET /api/v1/catalog, GET /api/health) → policy
 *   → POST without payment → 402 (decode + verify requirements against the catalog)
 *   → payment (sign EIP-3009 with x402HTTPClient + ExactEvmScheme) → POST with PAYMENT-SIGNATURE
 *   → 200 + PAYMENT-RESPONSE → settlement → ERP posting → review flag → done.
 *
 * The x402 flow is driven with the low-level x402HTTPClient (not wrapFetchWithPayment) so that
 * both HTTP requests appear explicitly in the trace. Spending policy and payment are
 * deterministic code; the optional LLM layer (agent/llm.ts) only decides the order of actions.
 * Private keys never enter the trace.
 */
import { randomUUID } from "node:crypto";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import type { PaymentPayload, PaymentRequired, PaymentRequirements, SettleResponse } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { fingerprint } from "../engine/rules/duplicates";
import type { ClientProfile, InvoiceFingerprint, InvoiceInput } from "../engine/types";
import {
  NETWORK_CAIP2,
  PAID_ENDPOINTS,
  USDC,
  atomicToUsdc,
  explorerTxUrl,
  usdcToAtomic,
  type PaidEndpointId,
} from "../lib/payments/pricing";
import type { HttpExchange, PaymentModeLabel, TraceStep, TraceStepKind } from "../lib/trace/types";
import { mergeFingerprints } from "./erp";
import { decodeB64Json, redactPaymentPayload, tracedFetch, truncateForTrace } from "./http";
import { discoveryDetail, docFacts, intakeReasoning, reviewMessage, totalExcessVat } from "./narrative";
import { evaluatePolicy, type PolicyDecision } from "./policy";
import type { AgentTask, AgentTrace, ErpRecord, ErpStatus, RunAgentOptions } from "./types";

export const AGENT_NAME = "Atelier Lumenor purchasing agent";
export const DEFAULT_RUN_TIMEOUT_MS = 40_000;

/** Who the agent books for (= engine DEMO_PROFILE; sent explicitly, as a real client would). */
export const AGENT_COMPANY_PROFILE: ClientProfile = {
  name: "Atelier Lumenor SAS (fictional)",
  siren: "000001008",
  legal_form: "SAS",
  activity: "commercial",
  accounting_basis: "accrual",
  vat_regime: "standard",
  vat_on_debits: false,
};

const TASK_ENDPOINT: Record<AgentTask, PaidEndpointId> = { entry: "entry", invoice_check: "invoice_check", audit: "audit" };

export interface Discovery {
  endpoint: PaidEndpointId;
  path: string;
  url: string;
  price_usdc: string;
  price_atomic: string;
  pay_to: string | null;
  asset: string;
  network: string;
  server_mode: "testnet" | "simulated" | null;
  source: string;
}

export interface PaidOutcome {
  status: number;
  result?: Record<string, unknown>;
  settle?: SettleResponse | null;
  error?: string;
}

/** Thrown to stop a run cleanly (refusal, payment failure…), after the step was logged. */
class StopRun extends Error {
  constructor(readonly outcome: AgentTrace["outcome"]) {
    super(outcome);
  }
}

// ---------------------------------------------------------------------------
// Catalog parsing (tolerant: the catalog shape is owned by the discovery workstream)
// ---------------------------------------------------------------------------

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function walk(node: unknown, visit: (o: Record<string, unknown>) => void, depth = 0): void {
  if (depth > 10 || !node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const x of node) walk(x, visit, depth + 1);
    return;
  }
  const o = node as Record<string, unknown>;
  visit(o);
  for (const v of Object.values(o)) walk(v, visit, depth + 1);
}

function priceFrom(o: Record<string, unknown>): string | null {
  const cand: unknown[] = [o.price_usdc, o.priceUsdc, o.amount_usdc, o.usdc];
  const p = o.price;
  if (p && typeof p === "object") {
    const po = p as Record<string, unknown>;
    cand.push(po.usdc, po.price_usdc, po.amount_usdc, po.amount);
  } else cand.push(p);
  for (const c of cand) {
    if (typeof c === "number" && Number.isFinite(c)) return atomicToUsdc(usdcToAtomic(c.toFixed(6)));
    if (typeof c === "string") {
      const m = /^\$?\s*(\d+(?:\.\d{1,6})?)\s*(?:USDC)?$/i.exec(c.trim());
      if (m) return atomicToUsdc(usdcToAtomic(m[1]));
    }
  }
  const atomic = o.price_atomic ?? (p && typeof p === "object" ? (p as Record<string, unknown>).atomic : undefined);
  if (typeof atomic === "string" && /^\d+$/.test(atomic)) return atomicToUsdc(atomic);
  return null;
}

/** Finds the endpoint entry for `path` and the payment parameters anywhere in a catalog JSON. */
export function parseCatalog(json: unknown, path: string): { price_usdc: string | null; pay_to: string | null; asset: string | null; network: string | null } {
  let price: string | null = null;
  let payTo: string | null = null;
  let asset: string | null = null;
  let network: string | null = null;
  walk(json, (o) => {
    for (const k of ["path", "url", "endpoint", "href", "resource"]) {
      const v = o[k];
      if (typeof v === "string" && (v === path || v.endsWith(path) || v.endsWith(`POST ${path}`))) {
        price ??= priceFrom(o);
      }
    }
    for (const k of ["pay_to", "payTo", "payee"]) {
      const v = o[k];
      if (!payTo && typeof v === "string" && ADDRESS_RE.test(v)) payTo = v;
    }
    for (const k of ["network_caip2", "network", "caip2"]) {
      const v = o[k];
      if (!network && typeof v === "string" && v.startsWith("eip155:")) network = v;
    }
    const a = o.asset;
    if (!asset && typeof a === "string" && ADDRESS_RE.test(a)) asset = a;
    if (!asset && a && typeof a === "object" && typeof (a as Record<string, unknown>).address === "string") {
      const addr = (a as Record<string, unknown>).address as string;
      if (ADDRESS_RE.test(addr)) asset = addr;
    }
  });
  return { price_usdc: price, pay_to: payTo, asset, network };
}

/** Keeps the catalog parts an agent reads (service, payment, endpoints, discovery) for the trace. */
export function compactCatalog(body: unknown): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const keep = ["service", "id", "version", "description", "disclaimer", "audience", "payment", "endpoints", "discovery"];
  const o = body as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of keep) if (k in o) out[k] = o[k];
  const dropped = Object.keys(o).filter((k) => !keep.includes(k));
  if (dropped.length) out._trace_note = `trimmed for display (${dropped.join(", ")}); full catalog at GET /api/v1/catalog`;
  return out;
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

export class AgentRun {
  readonly t0 = Date.now();
  readonly steps: TraceStep[] = [];
  readonly fetchImpl: typeof fetch;
  readonly base: string;
  readonly ctrl = new AbortController();
  readonly idemKey = randomUUID();
  discovery?: Discovery;
  policy?: PolicyDecision;
  paid?: PaidOutcome;
  erpRecord?: ErpRecord;
  reviewDone = false;
  outcome?: AgentTrace["outcome"];
  modeLabel: PaymentModeLabel;
  private timer: ReturnType<typeof setTimeout>;

  constructor(readonly opts: RunAgentOptions) {
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.base = opts.serviceUrl.replace(/\/$/, "");
    this.modeLabel = opts.mode === "testnet" ? "TESTNET" : "SIMULATED";
    this.timer = setTimeout(() => this.ctrl.abort(new Error("run deadline exceeded")), opts.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS);
  }

  get item() {
    return this.opts.item;
  }

  dispose() {
    clearTimeout(this.timer);
  }

  step(kind: TraceStepKind, title: string, extra: { detail?: string; http?: HttpExchange; data?: Record<string, unknown> } = {}): TraceStep {
    const s: TraceStep = { t_ms: Date.now() - this.t0, kind, title, ...extra };
    this.steps.push(s);
    this.opts.onStep?.(s, this.steps.length - 1);
    return s;
  }

  // -- 1. intake -------------------------------------------------------------
  intake() {
    const r = intakeReasoning(this.item);
    this.step("reasoning", r.title, {
      detail: r.detail,
      data: {
        inbox_file: this.item.file,
        task: this.item.task,
        ...(this.item.from ? { from: this.item.from } : {}),
        ...(this.item.subject ? { subject: this.item.subject } : {}),
        fixtures: this.item.fixtures.map((f) => `fixtures/${f}.json`),
        ...(this.opts.walletNote ? { wallet_note: this.opts.walletNote } : {}),
      },
    });
  }

  // -- 2. discovery ----------------------------------------------------------
  async discover(): Promise<Discovery> {
    if (this.discovery) return this.discovery;
    const endpoint = TASK_ENDPOINT[this.item.task];
    const path = PAID_ENDPOINTS[endpoint].path;
    let cat: ReturnType<typeof parseCatalog> = { price_usdc: null, pay_to: null, asset: null, network: null };
    let source = "/api/v1/catalog";
    try {
      const r = await tracedFetch(this.fetchImpl, `${this.base}/api/v1/catalog`, { method: "GET", headers: { accept: "application/json" } }, this.ctrl.signal);
      if (r.res.ok) {
        cat = parseCatalog(r.body, path);
        r.exchange.body = compactCatalog(r.exchange.body);
      }
      const found = !!cat.price_usdc;
      this.step("discovery", found ? "Discovered Ajean Ledger through its machine-readable catalog" : `Catalog unavailable (HTTP ${r.res.status}): falling back to /api/health`, {
        detail: found ? discoveryDetail(this.item.task, path, cat.price_usdc!, "machine-readable catalog") : "The catalog did not list the endpoint I need; I will read the price list from the service status endpoint.",
        http: r.exchange,
        data: { endpoint: path, price_usdc: cat.price_usdc, pay_to: cat.pay_to },
      });
    } catch (e) {
      if (this.ctrl.signal.aborted) throw e;
      this.step("discovery", "Catalog unreachable: falling back to /api/health", { detail: (e as Error).message });
    }

    // Service status: payment mode (decided by the server), payTo, prices.
    let serverMode: Discovery["server_mode"] = null;
    let payTo = cat.pay_to;
    let price = cat.price_usdc;
    const h = await tracedFetch(this.fetchImpl, `${this.base}/api/health`, { method: "GET", headers: { accept: "application/json" } }, this.ctrl.signal);
    const hb = (h.body ?? {}) as { payment?: { mode?: string; pay_to?: string | null }; prices?: Record<string, string> };
    if (h.res.ok) {
      serverMode = hb.payment?.mode === "testnet" ? "testnet" : hb.payment?.mode === "simulated" ? "simulated" : null;
      payTo ??= hb.payment?.pay_to ?? null;
      if (!price && hb.prices?.[path]) {
        price = atomicToUsdc(usdcToAtomic(hb.prices[path]));
        source = "/api/health";
      }
    }
    if (serverMode) this.modeLabel = serverMode === "testnet" ? "TESTNET" : "SIMULATED";
    this.step(
      "discovery",
      serverMode ? `Service status: ${serverMode === "testnet" ? "TESTNET (real test-USDC on Base Sepolia)" : "SIMULATED payments"}` : `Service status unavailable (HTTP ${h.res.status})`,
      {
        detail: serverMode
          ? `The server decides the payment mode. ${serverMode === "testnet" ? "Real x402 settlement on Base Sepolia through the facilitator." : "Same x402 flow and real signatures, but the facilitator is simulated: no on-chain transfer."} Payments go to ${payTo ?? "?"}.`
          : undefined,
        http: h.exchange,
        data: { server_mode: serverMode, pay_to: payTo },
      },
    );
    if (!price) {
      this.step("error", "No price found for the endpoint I need", { detail: `Neither the catalog nor /api/health lists ${path}. I will not call a paid endpoint whose price I do not know.` });
      throw new StopRun("error");
    }
    this.discovery = {
      endpoint,
      path,
      url: `${this.base}${path}`,
      price_usdc: price,
      price_atomic: usdcToAtomic(price),
      pay_to: payTo,
      asset: cat.asset ?? USDC.address,
      network: cat.network ?? NETWORK_CAIP2,
      server_mode: serverMode,
      source,
    };
    return this.discovery;
  }

  // -- 3. policy -------------------------------------------------------------
  async checkPolicy(): Promise<PolicyDecision> {
    if (this.policy) return this.policy;
    const d = await this.discover();
    const spent = await this.opts.ledger.spentTodayAtomic();
    const p = evaluatePolicy(d.price_usdc, this.opts.policy, spent);
    this.policy = p;
    this.step("policy", `Spending policy check: ${p.decision.toUpperCase()}`, {
      detail: p.reason,
      data: {
        decision: p.decision,
        ...(p.code ? { code: p.code } : {}),
        endpoint: d.path,
        price_usdc: p.price_usdc,
        max_per_call_usdc: p.max_per_call_usdc,
        spent_today_usdc: p.spent_today_usdc,
        daily_budget_usdc: p.daily_budget_usdc,
        ledger: this.opts.ledger.label,
      },
    });
    if (p.decision === "refuse") {
      this.step("review", "Not paying: escalated to my operator", {
        detail:
          p.code === "PRICE_ABOVE_MAX_PER_CALL"
            ? `${d.path} costs ${p.price_usdc} USDC, above the ${p.max_per_call_usdc} USDC per-call limit my operator gave me. A human must either approve this one-off spend or raise my limit. Nothing was signed, nothing was paid.`
            : `My daily budget (${p.daily_budget_usdc} USDC) would be exceeded. The item stays in the inbox until tomorrow or until a human raises the budget. Nothing was signed, nothing was paid.`,
        data: { review_reasons: [p.code], channel: "operator approval queue" },
      });
      throw new StopRun("refused_by_policy");
    }
    return p;
  }

  private requestBody(history: InvoiceFingerprint[]): Record<string, unknown> {
    if (this.item.task === "audit") return { items: this.item.audit_items ?? [], profile: AGENT_COMPANY_PROFILE };
    return { input: this.item.input, profile: AGENT_COMPANY_PROFILE, ...(history.length ? { history } : {}) };
  }

  // -- 4. paid call: unpaid → 402 → sign → paid → 200 → settlement ------------
  async callPaidEndpoint(): Promise<PaidOutcome> {
    if (this.paid) return this.paid;
    const d = await this.discover();
    const pol = await this.checkPolicy();
    if (pol.decision !== "allow") throw new StopRun("refused_by_policy");

    const history = this.item.task === "audit" ? [] : mergeFingerprints(this.item.erp_seed ?? [], await this.opts.erp.fingerprints());
    const body = this.requestBody(history);
    const headers = { "content-type": "application/json", accept: "application/json", "Idempotency-Key": this.idemKey };

    // 4a. unpaid request
    const unpaid = await tracedFetch(this.fetchImpl, d.url, { method: "POST", headers, body }, this.ctrl.signal);
    this.step("http_request", `POST ${d.path} (no payment attached)`, {
      detail:
        "First attempt without payment: the service will answer with its price in machine-readable form." +
        (history.length ? ` I attach the fingerprints of ${history.length} invoice(s) already in our ERP so the service can detect duplicates.` : ""),
      http: unpaid.requestExchange,
    });
    const prHeader = unpaid.res.headers.get("PAYMENT-REQUIRED");
    const prDecoded = decodeB64Json(prHeader) as PaymentRequired | null;
    if (unpaid.res.status !== 402 || !prDecoded) {
      this.step("http_response", `Unexpected HTTP ${unpaid.res.status} (expected 402 Payment Required)`, { http: unpaid.exchange });
      this.step("error", "The service did not ask for payment as announced", { detail: "Expected 402 + PAYMENT-REQUIRED. I stop here rather than improvise." });
      throw new StopRun("error");
    }
    const client = new x402HTTPClient(new x402Client().register(NETWORK_CAIP2, new ExactEvmScheme(this.opts.wallet)));
    const paymentRequired = client.getPaymentRequiredResponse((n) => unpaid.res.headers.get(n), unpaid.body);
    const req = paymentRequired.accepts.find((a) => a.scheme === "exact" && a.network === NETWORK_CAIP2) ?? paymentRequired.accepts[0];

    // 4b. verify the 402 requirements against what the catalog advertised
    const checks = [
      { check: "amount", expected: d.price_atomic, got: req?.amount, ok: req?.amount === d.price_atomic },
      { check: "asset (USDC)", expected: d.asset, got: req?.asset, ok: req?.asset?.toLowerCase() === d.asset.toLowerCase() },
      { check: "network", expected: NETWORK_CAIP2, got: req?.network, ok: req?.network === NETWORK_CAIP2 },
      { check: "payTo", expected: d.pay_to ?? "(not advertised)", got: req?.payTo, ok: !d.pay_to || req?.payTo?.toLowerCase() === d.pay_to.toLowerCase() },
      { check: "scheme", expected: "exact", got: req?.scheme, ok: req?.scheme === "exact" },
    ];
    const allOk = !!req && checks.every((c) => c.ok);
    const amountUsdc = req?.amount && /^\d+$/.test(req.amount) ? atomicToUsdc(req.amount) : "?";
    this.step("http_response", `402 Payment Required: ${amountUsdc} USDC on Base Sepolia`, {
      detail: `The PAYMENT-REQUIRED header carries the price (${req?.amount ?? "?"} atomic units = ${amountUsdc} USDC), the asset, the network and the payTo wallet. ${allOk ? `Everything matches what discovery advertised (${d.source}).` : `MISMATCH with what discovery advertised (${d.source})!`}`,
      http: { ...unpaid.exchange, decoded: { header: "PAYMENT-REQUIRED", value: prDecoded } },
      data: { requirements_check: checks },
    });
    if (!allOk) {
      const bad = checks.filter((c) => !c.ok).map((c) => `${c.check}: expected ${c.expected}, got ${c.got}`);
      this.step("policy", "Spending policy check: REFUSE (402 does not match the catalog)", {
        detail: `I only pay what was advertised. ${bad.join("; ")}. Nothing signed.`,
        data: { decision: "refuse", code: "REQUIREMENTS_MISMATCH", mismatches: bad },
      });
      throw new StopRun("refused_by_policy");
    }

    // 4c. sign the payment (EIP-3009 transferWithAuthorization, off-chain)
    let payload: PaymentPayload;
    try {
      payload = await client.createPaymentPayload({ ...paymentRequired, accepts: [req] } as PaymentRequired);
    } catch (e) {
      this.step("error", "Could not sign the payment", { detail: (e as Error).message });
      throw new StopRun("error");
    }
    const auth = ((payload.payload ?? {}) as { authorization?: Record<string, unknown> }).authorization ?? {};
    this.step("payment", `Signed a ${amountUsdc} USDC payment authorisation (EIP-3009)`, {
      detail:
        "transferWithAuthorization from my wallet to Ajean Ledger's payTo wallet, valid for a few minutes. Off-chain signature: no gas, no account, no API key. The facilitator submits the transfer only if the call succeeds.",
      data: {
        scheme: req.scheme,
        network: req.network,
        asset: req.asset,
        amount_usdc: amountUsdc,
        from: auth.from ?? this.opts.wallet.address,
        to: auth.to ?? req.payTo,
        value: auth.value,
        validAfter: auth.validAfter,
        validBefore: auth.validBefore,
        nonce: auth.nonce,
      },
    });

    // 4d. paid request
    const payHeaders = { ...headers, ...client.encodePaymentSignatureHeader(payload) };
    const paid = await tracedFetch(this.fetchImpl, d.url, { method: "POST", headers: payHeaders, body }, this.ctrl.signal);
    this.step("http_request", `POST ${d.path} with PAYMENT-SIGNATURE`, {
      detail: "Same request, retried with the signed payment attached. Payment is the authentication.",
      http: { ...paid.requestExchange, decoded: { header: "PAYMENT-SIGNATURE", value: redactPaymentPayload(payload) } },
    });

    const prResp = paid.res.headers.get("PAYMENT-RESPONSE");
    let settle: SettleResponse | null = null;
    if (prResp) {
      try {
        settle = client.getPaymentSettleResponse((n) => paid.res.headers.get(n));
      } catch {
        settle = decodeB64Json(prResp) as SettleResponse | null;
      }
    }
    const resBody = (paid.body ?? {}) as Record<string, unknown>;
    if (paid.res.status !== 200) {
      const err = (resBody.error ?? {}) as { code?: string; message?: string; details?: { reason?: string } };
      const reason = err.details?.reason ?? err.code ?? `HTTP ${paid.res.status}`;
      this.step("http_response", `${paid.res.status} ${err.code ?? "error"}: payment not accepted`, {
        detail: err.message ?? "The paid call failed.",
        http: { ...paid.exchange, ...(settle ? { decoded: { header: "PAYMENT-RESPONSE", value: settle } } : {}) },
      });
      const insufficient = /insufficient/i.test(reason);
      this.step("error", insufficient ? "Payment refused: my wallet has no test USDC" : `Payment refused: ${reason}`, {
        detail: insufficient
          ? `The facilitator checked my balance on Base Sepolia: not enough test USDC for ${amountUsdc} USDC. The operator must fund ${this.opts.wallet.address} (https://faucet.circle.com, Base Sepolia). I was not charged.`
          : `I was not charged (Ajean Ledger only settles successful calls). Reason: ${reason}.`,
        data: { reason, wallet: this.opts.wallet.address, charged: false },
      });
      this.paid = { status: paid.res.status, settle, error: reason };
      throw new StopRun("error");
    }

    const ok = this.item.task === "audit" ? "audit report received" : this.item.task === "invoice_check" ? "compliance check received" : "entry received";
    const status = (resBody.compliance as { status?: string } | undefined)?.status;
    const review = resBody.human_review_required === true;
    // compliance.status covers the invoice mentions only; VAT anomalies are separate (Phase 5 review m4).
    this.step("http_response", `200 OK: ${ok}${status ? ` (invoice mentions ${status.replace("_", "-")}${review ? ", review required" : ""})` : review ? " (review required)" : ""}`, {
      detail: "The PAYMENT-RESPONSE header confirms settlement and carries the transaction hash.",
      http: { ...paid.exchange, ...(settle ? { decoded: { header: "PAYMENT-RESPONSE", value: settle } } : {}) },
    });

    // 4e. settlement
    const receipt = (resBody.receipt ?? {}) as { tx_hash?: string; amount?: string; amount_atomic?: string; explorer_url?: string | null; mode?: string; payer?: string };
    const tx = receipt.tx_hash ?? settle?.transaction ?? "";
    const simulated = receipt.mode === "simulated" || (settle?.extra as { simulated?: boolean } | undefined)?.simulated === true;
    const explorer = simulated ? null : (receipt.explorer_url ?? (tx ? explorerTxUrl(tx) : null));
    const amountAtomic = receipt.amount_atomic ?? req.amount;
    this.step("settlement", `Payment settled: ${atomicToUsdc(amountAtomic)} USDC${simulated ? " (simulated transaction)" : " on Base Sepolia"}`, {
      detail: simulated
        ? `Transaction ${tx.slice(0, 14)}… (SIMULATED facilitator: same x402 flow, no on-chain transfer). Receipt ${resBody.request_id ?? "?"} kept for idempotency.`
        : `Transaction ${tx} confirmed on Base Sepolia. Receipt ${resBody.request_id ?? "?"} kept for idempotency.${explorer ? ` Explorer: ${explorer}` : ""}`,
      data: {
        tx_hash: tx,
        network: settle?.network ?? NETWORK_CAIP2,
        amount_usdc: atomicToUsdc(amountAtomic),
        request_id: resBody.request_id ?? null,
        explorer_url: explorer,
        simulated,
        payer: receipt.payer ?? settle?.payer ?? this.opts.wallet.address,
      },
    });
    await this.opts.ledger.record({
      at: new Date().toISOString(),
      amount_atomic: amountAtomic,
      endpoint: d.path,
      request_id: resBody.request_id as string | undefined,
      tx_hash: tx,
    });
    this.paid = { status: 200, result: resBody, settle };
    return this.paid;
  }

  private reviewReasons(): string[] {
    const r = this.paid?.result ?? {};
    const reasons = Array.isArray(r.review_reasons) ? (r.review_reasons as string[]) : [];
    if (reasons.length) return reasons;
    if (r.human_review_required === true) {
      const an = Array.isArray(r.anomalies) ? (r.anomalies as { code: string; severity?: string }[]) : [];
      const codes = an.filter((a) => a.severity !== "info").map((a) => a.code);
      return codes.length ? codes : ["HUMAN_REVIEW_REQUIRED"];
    }
    return [];
  }

  // -- 5. ERP posting ---------------------------------------------------------
  async postToErp(): Promise<ErpRecord | null> {
    if (this.erpRecord) return this.erpRecord;
    const r = this.paid?.result;
    if (!r) throw new Error("post_to_erp before a successful paid call");
    const entry = r.entry as { journal?: string; date?: string; reference?: string; lines?: ErpRecord["lines"]; balanced?: boolean } | undefined;
    if (!entry?.lines?.length) {
      this.step("erp", this.item.task === "audit" ? "ERP: audit report attached to the October closing folder" : "ERP: result attached (no entry to post)", {
        detail: "Nothing to post as journal lines for this request type.",
        data: { erp: this.opts.erp.label },
      });
      return null;
    }
    const reasons = this.reviewReasons();
    const duplicate = reasons.includes("DUPLICATE_SUSPECTED");
    const status: ErpStatus = duplicate ? "draft" : reasons.length ? "posted_review_pending" : "posted";
    const inv = r.invoice as { number?: string; date?: string; supplier?: { name?: string; siren?: string; vat_id?: string }; totals?: { total_incl_vat?: number }; document_type?: string } | undefined;
    let fp: InvoiceFingerprint | null = null;
    try {
      if (inv?.number && inv.date && inv.supplier?.name) {
        fp = fingerprint({
          document_type: (inv.document_type ?? "invoice") as InvoiceInput["document_type"],
          number: inv.number,
          issue_date: inv.date,
          supplier: inv.supplier,
          totals: { total_incl_vat: inv.totals?.total_incl_vat ?? 0 },
        } as unknown as InvoiceInput);
      }
    } catch {
      fp = null;
    }
    const debit = Math.round(entry.lines.reduce((s, l) => s + (l.debit || 0), 0) * 100) / 100;
    const credit = Math.round(entry.lines.reduce((s, l) => s + (l.credit || 0), 0) * 100) / 100;
    const receipt = r.receipt as ErpRecord["receipt"];
    const rec: ErpRecord = {
      erp_id: `ERP-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${randomUUID().slice(0, 6).toUpperCase()}`,
      status,
      recorded_at: new Date().toISOString(),
      source: this.item.file,
      journal: entry.journal ?? "HA",
      date: entry.date ?? inv?.date ?? "",
      reference: entry.reference ?? inv?.number ?? "",
      supplier: inv?.supplier?.name ?? "",
      lines: entry.lines.map((l) => ({ account: l.account, label: l.label, debit: l.debit, credit: l.credit })),
      total_debit: debit,
      total_credit: credit,
      request_id: (r.request_id as string) ?? null,
      receipt: receipt ? { amount: receipt.amount, tx_hash: receipt.tx_hash, mode: receipt.mode, explorer_url: receipt.explorer_url } : null,
      review_reasons: reasons,
      fingerprint: fp,
    };
    await this.opts.erp.post(rec);
    this.erpRecord = rec;
    const title =
      status === "draft"
        ? `ERP: entry saved as DRAFT, not validated (duplicate suspected)`
        : `ERP: entry ${rec.journal} ${rec.reference} posted${status === "posted_review_pending" ? " (flagged for review)" : " (validated)"}`;
    this.step("erp", title, {
      detail:
        status === "draft"
          ? `I will not post the same invoice twice. The proposed entry (${rec.lines.length} lines, ${debit.toFixed(2)} EUR) stays as a draft in the mock ERP until a human decides.`
          : `${rec.lines.length} lines written to the mock ERP, debits = credits = ${debit.toFixed(2)} EUR, linked to receipt ${rec.request_id ?? "?"}.`,
      data: {
        erp: this.opts.erp.label,
        erp_id: rec.erp_id,
        status,
        journal: rec.journal,
        reference: rec.reference,
        lines: rec.lines,
        balanced: debit === credit,
        request_id: rec.request_id,
        tx_hash: rec.receipt?.tx_hash ?? null,
      },
    });
    return rec;
  }

  // -- 6. review --------------------------------------------------------------
  flagForReview(): string[] {
    if (this.reviewDone) return this.reviewReasons();
    this.reviewDone = true;
    const r = this.paid?.result;
    if (!r) return [];
    const reasons = this.reviewReasons();
    if (!reasons.length) return [];
    const inv = r.invoice as { number?: string; supplier?: { name?: string }; totals?: { total_incl_vat?: number; total_vat?: number } } | undefined;
    const anomalies = (Array.isArray(r.anomalies) ? r.anomalies : []) as { code: string; detail?: string; severity?: string }[];
    const excessVat = totalExcessVat(anomalies, (r.vat as { note?: string } | undefined)?.note);
    const messages = reasons.map((code) =>
      reviewMessage(code, {
        supplier: inv?.supplier?.name,
        number: inv?.number,
        total: inv?.totals?.total_incl_vat,
        vat: inv?.totals?.total_vat,
        detail: anomalies.find((a) => a.code === code)?.detail,
        excessVat,
      }),
    );
    this.step("review", `Human review requested: ${reasons.join(", ")}`, {
      detail: `Message to the bookkeeper: '${messages.join(" ")}'`,
      data: {
        review_reasons: reasons,
        messages,
        anomalies: anomalies.map((a) => ({ code: a.code, severity: a.severity, detail: a.detail })),
        channel: "ERP review queue",
      },
    });
    return reasons;
  }

  // -- 7. wrap-up --------------------------------------------------------------
  async finish(): Promise<void> {
    const r = this.paid?.result;
    if (!r) return;
    const reasons = this.reviewReasons();
    const spent = await this.opts.ledger.spentTodayAtomic();
    const info = ((Array.isArray(r.anomalies) ? r.anomalies : []) as { code: string; detail?: string; severity?: string }[]).filter((a) => a.severity === "info");
    const explanation = typeof r.explanation === "string" ? r.explanation : "";
    const cost = this.policy?.price_usdc ?? this.discovery?.price_usdc ?? "?";
    this.outcome = reasons.length ? "posted_with_review" : "posted";
    this.step("reasoning", reasons.length ? "Done: entry prepared, a human must confirm" : "Done: invoice booked, no human needed", {
      detail:
        `Cost of this call: ${cost} USDC${this.modeLabel === "SIMULATED" ? " (simulated)" : ""}. Spent today: ${atomicToUsdc(spent)} / ${this.opts.policy.daily_budget_usdc} USDC.` +
        (info.length ? ` Noted for the file: ${info.map((a) => a.detail ?? a.code).join(" ")}` : "") +
        (explanation ? ` Service explanation relayed to my operator: "${explanation}"` : ""),
      data: { outcome: this.outcome, spent_today_usdc: atomicToUsdc(spent), review_reasons: reasons },
    });
  }

  /** Whole scripted pipeline. Idempotent: already-done actions are skipped (used as LLM fallback). */
  async runScripted(): Promise<void> {
    await this.discover();
    await this.checkPolicy();
    await this.callPaidEndpoint();
    await this.postToErp();
    this.flagForReview();
    await this.finish();
  }

  toTrace(): AgentTrace {
    const label = this.opts.scenarioLabel ?? `${this.item.id} · ${intakeReasoning(this.item).title}`;
    return {
      id: `trace_${this.item.id}_${new Date(this.t0).toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}_${this.idemKey.slice(0, 6)}`,
      scenario: this.item.id,
      scenario_label: label,
      mode: this.modeLabel,
      recorded_from: this.discovery?.server_mode ?? (this.modeLabel === "TESTNET" ? "testnet" : "simulated"),
      recorded_at: new Date(this.t0).toISOString(),
      agent: {
        name: this.opts.agentName ?? AGENT_NAME,
        wallet: this.opts.wallet.address,
        policy: { max_per_call_usdc: this.opts.policy.max_per_call_usdc, daily_budget_usdc: this.opts.policy.daily_budget_usdc },
      },
      service_url: this.base,
      steps: this.steps,
      ...(this.paid?.result ? { result: truncateForTrace(this.paid.result, 4000, 100) } : {}),
      duration_ms: Date.now() - this.t0,
      outcome: this.outcome ?? "error",
    };
  }

  /** Records an unexpected error as a step (never throws). */
  fail(e: unknown) {
    if (e instanceof StopRun) {
      this.outcome = e.outcome;
      return;
    }
    const aborted = this.ctrl.signal.aborted;
    const msg = aborted ? `Run stopped after ${Math.round((Date.now() - this.t0) / 1000)} s (deadline).` : e instanceof Error ? e.message : String(e);
    this.step("error", aborted ? "Run deadline exceeded" : "Unexpected error", {
      detail: `${msg}${this.paid?.status === 200 ? "" : " I was not charged for any unfinished call."}`,
    });
    this.outcome = "error";
  }
}

export { StopRun };

/**
 * Processes ONE inbox item end to end and returns its AgentTrace. Never throws:
 * failures end with outcome "error" (or "refused_by_policy") and the steps so far.
 */
export async function runAgent(opts: RunAgentOptions): Promise<AgentTrace> {
  const run = new AgentRun(opts);
  try {
    run.intake();
    const wantLlm = opts.reasoning === "llm";
    if (wantLlm && process.env.ANTHROPIC_API_KEY) {
      const { runWithLlm } = await import("./llm");
      await runWithLlm(run);
    } else {
      if (wantLlm) {
        run.step("reasoning", "LLM reasoning unavailable: using my scripted procedure", {
          detail: "ANTHROPIC_API_KEY is not set. The procedure, the spending policy and the payment code are the same.",
        });
      }
      await run.runScripted();
    }
  } catch (e) {
    run.fail(e);
  } finally {
    run.dispose();
  }
  return run.toTrace();
}
