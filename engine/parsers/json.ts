/**
 * JSON input validation (zod). Errors are thrown as EngineError("INVALID_INPUT")
 * with machine-readable details: [{ path, message }].
 */
import { z } from "zod";
import { EngineError } from "../errors";
import type { BankTransactionInput, InvoiceInput } from "../types";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const amount = z.number().refine(Number.isFinite, "must be a finite number");

export const PartySchema = z.object({
  name: z.string().min(1),
  siren: z.string().regex(/^\d{9}$/, "SIREN must be 9 digits").optional(),
  vat_id: z.string().min(4).optional(),
  country: z.string().regex(/^[A-Za-z]{2}$/, "ISO 3166-1 alpha-2 code").transform((s) => s.toUpperCase()),
  address: z.string().optional(),
  account_code: z.string().optional(),
});

export const InvoiceLineSchema = z.object({
  description: z.string(),
  quantity: amount,
  unit_price_excl_vat: amount,
  vat_rate: z.number().min(0).max(1),
  total_excl_vat: amount.optional(),
  category_hint: z.string().optional(),
  kind: z.enum(["goods", "services"]).optional(),
});

export const InvoiceSchema = z.object({
  document_type: z.enum(["invoice", "credit_note"]),
  number: z.string(),
  issue_date: date,
  due_date: date.optional(),
  currency: z.literal("EUR"),
  supplier: PartySchema,
  customer: PartySchema,
  delivery_address: z.string().optional(),
  operation_nature: z.enum(["goods", "services", "mixed"]).optional(),
  vat_on_debits_option: z.boolean().optional(),
  lines: z.array(InvoiceLineSchema).min(1).max(500),
  totals: z.object({ total_excl_vat: amount, total_vat: amount, total_incl_vat: amount }),
  payment_terms: z.string().optional(),
  late_payment_penalties: z.string().optional(),
  fixed_recovery_indemnity_mention: z.boolean().optional(),
  legal_mentions: z.array(z.string()).optional(),
  original_invoice_number: z.string().optional(),
});

export const BankTransactionSchema = z.object({
  date,
  label: z.string().min(1),
  amount,
  currency: z.literal("EUR"),
  counterparty: z.string().optional(),
  reference: z.string().optional(),
});

function issues(err: z.ZodError, prefix: string): { path: string; message: string }[] {
  return err.issues.map((i) => ({ path: [prefix, ...i.path.map(String)].filter(Boolean).join("."), message: i.message }));
}

export function validateInvoice(raw: unknown, prefix = "invoice"): InvoiceInput {
  const r = InvoiceSchema.safeParse(raw);
  if (!r.success) throw new EngineError("INVALID_INPUT", "The invoice does not match the Ajean Ledger invoice schema.", issues(r.error, prefix));
  return normaliseInvoice(r.data as InvoiceInput);
}

export function validateTransaction(raw: unknown): BankTransactionInput {
  const r = BankTransactionSchema.safeParse(raw);
  if (!r.success) throw new EngineError("INVALID_INPUT", "The bank transaction does not match the schema.", issues(r.error, "transaction"));
  return r.data as BankTransactionInput;
}

/**
 * Credit notes may be sent with positive or negative amounts; internally they
 * are normalised to positive amounts (the entry builder reverses the sides).
 */
export function normaliseInvoice(inv: InvoiceInput): InvoiceInput {
  if (inv.document_type !== "credit_note" || inv.totals.total_incl_vat >= 0) return inv;
  return {
    ...inv,
    lines: inv.lines.map((l) => ({
      ...l,
      quantity: Math.abs(l.quantity),
      unit_price_excl_vat: Math.abs(l.unit_price_excl_vat),
      ...(l.total_excl_vat !== undefined ? { total_excl_vat: Math.abs(l.total_excl_vat) } : {}),
    })),
    totals: {
      total_excl_vat: Math.abs(inv.totals.total_excl_vat),
      total_vat: Math.abs(inv.totals.total_vat),
      total_incl_vat: Math.abs(inv.totals.total_incl_vat),
    },
  };
}
