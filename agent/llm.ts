/**
 * Optional LLM reasoning for the demo agent (reasoning: "llm" + ANTHROPIC_API_KEY).
 *
 * Claude decides the ORDER of actions through tool use; every tool runs the same
 * deterministic code as the scripted path (AgentRun methods): the spending policy and the
 * x402 payment are never decided by the model. Any API failure falls back to the scripted
 * procedure, which skips the actions already done.
 */
import Anthropic from "@anthropic-ai/sdk";
import { StopRun, type AgentRun } from "./core";

const MAX_TURNS = 8;

const SYSTEM = `You are the autonomous purchasing agent of Atelier Lumen SAS (fictional), a French SME.
You process one inbox item at a time. You do not know French accounting rules (PCG accounts, VAT, e-invoicing), so you rely on a paid external service, Ajean Ledger.
Use the tools to: discover the service and its price, check your spending policy, call the paid endpoint (payment is handled for you, only after the policy allowed it), post the result to the ERP, and flag anything that needs a human.
Before each tool call, write ONE short sentence (max 30 words) explaining why, in plain English, for an audience watching your reasoning live.
Never invent accounting results: only relay what the service returned. When everything is done, reply with a 1-2 sentence summary and stop.`;

const TOOLS: Anthropic.Tool[] = [
  {
    name: "discover_service",
    description: "Read Ajean Ledger's free machine-readable catalog and service status: which endpoint fits the task, its price in USDC, the payment network and payTo wallet.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "check_policy",
    description: "Check the price against the operator's spending policy (max per call, daily budget). Deterministic. If refused, the run stops and the item is escalated.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "call_paid_endpoint",
    description: "Call the paid endpoint over x402: unpaid request → 402 → verify requirements → sign the USDC authorisation → paid request → result + settlement. Only works after check_policy allowed it.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "post_to_erp",
    description: "Write the returned journal entry into the company's mock ERP (draft if a duplicate is suspected, flagged if review is required).",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "flag_for_review",
    description: "Raise a human-review flag for the bookkeeper with the reasons returned by the service (no-op when nothing needs review).",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
];

function summarizeResult(r: Record<string, unknown> | undefined): unknown {
  if (!r) return null;
  const pick: Record<string, unknown> = {};
  for (const k of ["request_id", "human_review_required", "review_reasons", "confidence", "explanation"]) if (k in r) pick[k] = r[k];
  const c = r.compliance as { status?: string } | undefined;
  if (c) pick.compliance_status = c.status;
  const e = r.entry as { journal?: string; lines?: unknown[] } | undefined;
  if (e) pick.entry = { journal: e.journal, lines: e.lines };
  if (Array.isArray(r.anomalies)) pick.anomalies = r.anomalies;
  return pick;
}

async function execTool(run: AgentRun, name: string): Promise<unknown> {
  switch (name) {
    case "discover_service": {
      const d = await run.discover();
      return { endpoint: d.path, price_usdc: d.price_usdc, network: d.network, pay_to: d.pay_to, server_mode: d.server_mode };
    }
    case "check_policy": {
      const p = await run.checkPolicy();
      return { decision: p.decision, reason: p.reason };
    }
    case "call_paid_endpoint": {
      const out = await run.callPaidEndpoint();
      return { status: out.status, tx_hash: out.settle?.transaction ?? null, result: summarizeResult(out.result) };
    }
    case "post_to_erp": {
      const rec = await run.postToErp();
      return rec ? { erp_id: rec.erp_id, status: rec.status, lines: rec.lines.length } : { posted: false };
    }
    case "flag_for_review":
      return { review_reasons: run.flagForReview() };
    default:
      throw new Error(`unknown tool ${name}`);
  }
}

export async function runWithLlm(run: AgentRun): Promise<void> {
  const client = new Anthropic();
  const model = process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-5-5";
  const item = run.item;
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `New inbox item ${item.file} (task: ${item.task}).\nFrom: ${item.from ?? "?"}\nSubject: ${item.subject ?? "?"}\nDocument:\n${JSON.stringify(item.task === "audit" ? item.audit_items : item.input).slice(0, 6000)}`,
    },
  ];
  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const res = await client.messages.create(
        { model, max_tokens: 4000, system: SYSTEM, tools: TOOLS, tool_choice: { type: "auto" }, messages },
        { signal: run.ctrl.signal, timeout: 20_000 },
      );
      messages.push({ role: "assistant", content: res.content });
      const text = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text.trim())
        .filter(Boolean)
        .join(" ");
      if (text) run.step("reasoning", "Agent reasoning (LLM)", { detail: text, data: { model } });
      if (res.stop_reason !== "tool_use") break;
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const b of res.content) {
        if (b.type !== "tool_use") continue;
        try {
          results.push({ type: "tool_result", tool_use_id: b.id, content: JSON.stringify(await execTool(run, b.name)) });
        } catch (e) {
          if (e instanceof StopRun) throw e; // policy refusal / payment failure: the run ends here
          results.push({ type: "tool_result", tool_use_id: b.id, content: (e as Error).message, is_error: true });
        }
      }
      messages.push({ role: "user", content: results });
    }
  } catch (e) {
    if (e instanceof StopRun || run.ctrl.signal.aborted) throw e;
    run.step("reasoning", "LLM unavailable: continuing with my scripted procedure", {
      detail: `${e instanceof Error ? e.message : String(e)}. The policy and payment code are deterministic, so nothing changes for the result.`,
    });
  }
  // Safety net: completes the mandatory procedure (already-done actions are skipped).
  await run.runScripted();
}
