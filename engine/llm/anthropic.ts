/**
 * Optional LLM layer (Anthropic). Used ONLY to (a) extract invoice data from an
 * unstructured PDF/image and (b) classify an ambiguous expense description.
 * The LLM never decides accounts, amounts or VAT on its own: its output is
 * re-validated by the zod schema and the rules engine.
 *
 * createAnthropicAdapter() returns undefined when ANTHROPIC_API_KEY is absent,
 * so the engine stays fully deterministic (and tests never hit the network).
 */
import Anthropic from "@anthropic-ai/sdk";
import type { InvoiceInput, LlmAdapter } from "../types";
import { validateInvoice } from "../parsers/json";
import { EngineError } from "../errors";

export const DEFAULT_MODEL = "claude-sonnet-5-5";

const INVOICE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["invoice", "confidence"],
  properties: {
    confidence: { type: "number", description: "0..1, your confidence that every extracted field is exact" },
    invoice: {
      type: "object",
      additionalProperties: false,
      required: ["document_type", "number", "issue_date", "currency", "supplier", "customer", "lines", "totals"],
      properties: {
        document_type: { type: "string", enum: ["invoice", "credit_note"] },
        number: { type: "string" },
        issue_date: { type: "string", description: "YYYY-MM-DD" },
        due_date: { type: "string", description: "YYYY-MM-DD" },
        currency: { type: "string", enum: ["EUR"] },
        supplier: { $ref: "#/$defs/party" },
        customer: { $ref: "#/$defs/party" },
        delivery_address: { type: "string" },
        operation_nature: { type: "string", enum: ["goods", "services", "mixed"] },
        vat_on_debits_option: { type: "boolean" },
        lines: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["description", "quantity", "unit_price_excl_vat", "vat_rate"],
            properties: {
              description: { type: "string" },
              quantity: { type: "number" },
              unit_price_excl_vat: { type: "number" },
              vat_rate: { type: "number", description: "decimal, e.g. 0.2" },
              total_excl_vat: { type: "number" },
              kind: { type: "string", enum: ["goods", "services"] },
            },
          },
        },
        totals: {
          type: "object",
          additionalProperties: false,
          required: ["total_excl_vat", "total_vat", "total_incl_vat"],
          properties: { total_excl_vat: { type: "number" }, total_vat: { type: "number" }, total_incl_vat: { type: "number" } },
        },
        payment_terms: { type: "string" },
        late_payment_penalties: { type: "string" },
        fixed_recovery_indemnity_mention: { type: "boolean" },
        legal_mentions: { type: "array", items: { type: "string" } },
        original_invoice_number: { type: "string" },
      },
    },
  },
  $defs: {
    party: {
      type: "object",
      additionalProperties: false,
      required: ["name", "country"],
      properties: {
        name: { type: "string" },
        siren: { type: "string" },
        vat_id: { type: "string" },
        country: { type: "string" },
        address: { type: "string" },
      },
    },
  },
} as const;

const EXTRACT_PROMPT = `Extract the French supplier invoice in this document into the JSON schema.
Rules: copy amounts exactly as printed (no recomputation); vat_rate as a decimal (20% -> 0.2);
dates as YYYY-MM-DD; omit fields that are not printed (never guess a SIREN or VAT number);
legal_mentions = verbatim legal sentences (exemption, reverse charge, etc.);
fixed_recovery_indemnity_mention = true only if the EUR 40 recovery indemnity is printed.
confidence = your honest confidence (0..1) that all fields are exact.`;

function firstText(msg: Anthropic.Message): string {
  for (const b of msg.content) if (b.type === "text") return b.text;
  return "";
}

export function createAnthropicAdapter(env: Record<string, string | undefined> = process.env): LlmAdapter | undefined {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) return undefined;
  const model = env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  const client = new Anthropic({ apiKey });

  return {
    model,
    async extractInvoice(doc) {
      const block: Anthropic.ContentBlockParam =
        doc.mime_type === "application/pdf"
          ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: doc.base64 } }
          : {
              type: "image",
              source: { type: "base64", media_type: doc.mime_type as "image/png" | "image/jpeg" | "image/gif" | "image/webp", data: doc.base64 },
            };
      const msg = await client.messages.create({
        model,
        max_tokens: 16000,
        output_config: { effort: "medium", format: { type: "json_schema", schema: INVOICE_JSON_SCHEMA as unknown as Record<string, unknown> } },
        messages: [{ role: "user", content: [block, { type: "text", text: EXTRACT_PROMPT }] }],
      });
      if (msg.stop_reason === "refusal") throw new EngineError("LLM_OUTPUT_INVALID", "The LLM declined to extract this document.");
      let parsed: { invoice: unknown; confidence: number };
      try {
        parsed = JSON.parse(firstText(msg));
      } catch {
        throw new EngineError("LLM_OUTPUT_INVALID", "The LLM output was not valid JSON.");
      }
      const invoice: InvoiceInput = validateInvoice(parsed.invoice, "llm.invoice");
      const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0));
      return { invoice, confidence };
    },
    async classifyExpense(description, categories) {
      const msg = await client.messages.create({
        model,
        max_tokens: 1024,
        output_config: {
          effort: "low",
          format: {
            type: "json_schema",
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["category", "confidence"],
              properties: { category: { type: "string", enum: categories }, confidence: { type: "number" } },
            },
          },
        },
        messages: [
          {
            role: "user",
            content: `Classify this French purchase-invoice line into exactly one expense category id from the list.\nLine: ${JSON.stringify(description)}\nCategories: ${categories.join(", ")}\nReturn your honest confidence (0..1).`,
          },
        ],
      });
      if (msg.stop_reason === "refusal") return { category: categories[0], confidence: 0 };
      try {
        const out = JSON.parse(firstText(msg)) as { category: string; confidence: number };
        return { category: out.category, confidence: Math.max(0, Math.min(1, Number(out.confidence) || 0)) };
      } catch {
        return { category: categories[0], confidence: 0 };
      }
    },
  };
}
