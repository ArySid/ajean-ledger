/**
 * Request envelope validation (zod). Only the envelope is validated here; the
 * invoice itself is validated by the engine (INVALID_INPUT from the engine).
 */
import { z } from "zod";
import type { AuditEntryInput, ClientProfile, EngineInput, InvoiceFingerprint } from "@/engine/types";
import { AUDIT_MAX_ITEMS, type PaidEndpointId } from "@/lib/payments/pricing";
import { ApiError } from "./errors";

export const ENTRY_FORMATS = ["json", "facturx", "ubl", "bank_transaction", "pdf", "image"] as const;
export const CHECK_FORMATS = ["json", "facturx", "ubl", "pdf", "image"] as const;

const obj = z.looseObject({});
const base64 = z.string().min(1).max(7_000_000);

const inputByFormat: Record<string, z.ZodType> = {
  json: z.looseObject({ format: z.literal("json"), invoice: obj }),
  facturx: z.looseObject({ format: z.literal("facturx"), document_base64: base64 }),
  ubl: z.looseObject({ format: z.literal("ubl"), xml: z.string().min(1) }),
  bank_transaction: z.looseObject({
    format: z.literal("bank_transaction"),
    transaction: obj,
    candidate_invoices: z.array(obj).max(200).optional(),
  }),
  pdf: z.looseObject({ format: z.literal("pdf"), document_base64: base64, mime_type: z.string().optional() }),
  image: z.looseObject({ format: z.literal("image"), document_base64: base64, mime_type: z.string().optional() }),
};

export const profileSchema = z.looseObject({
  name: z.string().min(1),
  siren: z.string().regex(/^\d{9}$/, "SIREN must be 9 digits"),
  legal_form: z.string().optional(),
  activity: z.enum(["commercial", "bnc"]),
  accounting_basis: z.enum(["accrual", "cash"]),
  vat_regime: z.enum(["standard", "franchise"]),
  vat_on_debits: z.boolean().optional(),
});

export const fingerprintSchema = z.looseObject({
  supplier_key: z.string().min(1),
  number: z.string().min(1),
  issue_date: z.string().min(1),
  total_incl_vat: z.number(),
});

export interface InvoiceEnvelope {
  input: EngineInput;
  profile?: ClientProfile;
  history?: InvoiceFingerprint[];
  /** Opt-in: also use the fingerprints of invoices previously booked through this service for this client. */
  use_server_history?: boolean;
}

export interface AuditEnvelope {
  items: AuditEntryInput[];
  profile?: ClientProfile;
}

function issues(err: z.ZodError, prefix = "") {
  return err.issues.map((i) => ({ path: [prefix, ...i.path.map(String)].filter(Boolean).join("."), message: i.message }));
}

function invalid(message: string, details?: unknown): ApiError {
  return new ApiError("INVALID_INPUT", message, { details });
}

function asObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw invalid("Request body must be a JSON object.");
  return body as Record<string, unknown>;
}

function parseCommon(o: Record<string, unknown>) {
  const out: { profile?: ClientProfile; history?: InvoiceFingerprint[] } = {};
  if (o.profile !== undefined) {
    const p = profileSchema.safeParse(o.profile);
    if (!p.success) throw invalid("Invalid profile.", issues(p.error, "profile"));
    out.profile = p.data as unknown as ClientProfile;
  }
  if (o.history !== undefined) {
    const h = z.array(fingerprintSchema).max(5000).safeParse(o.history);
    if (!h.success) throw invalid("Invalid history.", issues(h.error, "history"));
    out.history = h.data as unknown as InvoiceFingerprint[];
  }
  return out;
}

export function parseInvoiceEnvelope(body: unknown, endpoint: Exclude<PaidEndpointId, "audit">): InvoiceEnvelope {
  const o = asObject(body);
  const input = o.input;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw invalid('Missing "input" object: { "input": { "format": "json", "invoice": {...} } }.');
  }
  const format = (input as Record<string, unknown>).format;
  if (typeof format !== "string") throw invalid('Missing "input.format".');
  const allowed: readonly string[] = endpoint === "entry" ? ENTRY_FORMATS : CHECK_FORMATS;
  if (!allowed.includes(format)) {
    throw new ApiError("UNSUPPORTED_FORMAT", `input.format "${format}" is not supported by this endpoint.`, {
      details: { supported_formats: allowed },
    });
  }
  const parsed = inputByFormat[format].safeParse(input);
  if (!parsed.success) throw invalid(`Invalid input for format "${format}".`, issues(parsed.error, "input"));
  if (o.use_server_history !== undefined && typeof o.use_server_history !== "boolean") {
    throw invalid('"use_server_history" must be a boolean.');
  }
  return {
    input: parsed.data as EngineInput,
    ...parseCommon(o),
    ...(o.use_server_history !== undefined ? { use_server_history: o.use_server_history as boolean } : {}),
  };
}

const auditItemSchema = z
  .looseObject({ entry: obj.optional(), invoice: obj.optional() })
  .refine((i) => i.entry !== undefined || i.invoice !== undefined, { message: 'Each item needs "entry" or "invoice".' });

export function parseAuditEnvelope(body: unknown): AuditEnvelope {
  const o = asObject(body);
  if (!Array.isArray(o.items)) throw invalid('Missing "items" array (1..50 AuditEntryInput).');
  if (o.items.length === 0) throw invalid('"items" must contain at least one entry.');
  if (o.items.length > AUDIT_MAX_ITEMS) {
    throw new ApiError("BATCH_TOO_LARGE", `At most ${AUDIT_MAX_ITEMS} items per audit call (got ${o.items.length}). Split the batch.`, {
      details: { max_items: AUDIT_MAX_ITEMS, received: o.items.length },
    });
  }
  const items = z.array(auditItemSchema).safeParse(o.items);
  if (!items.success) throw invalid("Invalid audit items.", issues(items.error, "items"));
  return { items: items.data as unknown as AuditEntryInput[], ...parseCommon(o) };
}
