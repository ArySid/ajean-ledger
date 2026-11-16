/**
 * MCP tool definitions shared by the remote MCP endpoint (app/mcp/route.ts) and the
 * stdio bridge (mcp/server.ts). Names, prices and endpoints come from pricing.ts.
 *
 * Relative imports only (the stdio bridge loads this file through tsx from any cwd).
 */
import { z } from "zod";
import { AUDIT_MAX_ITEMS, NETWORK_NAME, PAID_ENDPOINTS, type PaidEndpointId } from "../payments/pricing";
import { AuditRequestSchema, CheckInvoiceRequestSchema, CreateEntryRequestSchema } from "./schemas";

export type PaidToolName = "check_invoice" | "create_entry" | "audit_entries";
export type FreeToolName = "get_catalog" | "get_receipt";

export interface PaidToolDef {
  name: PaidToolName;
  endpoint: PaidEndpointId;
  title: string;
  description: string;
  inputSchema: z.ZodObject;
}

const SCHEMAS: Record<PaidEndpointId, z.ZodObject> = {
  invoice_check: CheckInvoiceRequestSchema,
  entry: CreateEntryRequestSchema,
  audit: AuditRequestSchema,
};

const USAGE: Record<PaidEndpointId, string> = {
  invoice_check:
    'Use it to know whether a French invoice is compliant before paying or booking it. Arguments = the request body: { input: { format: "json", invoice: {...} } } (or facturx base64 / ubl xml), optional profile and history.',
  entry:
    'Use it when you must book a supplier invoice, credit note or bank transaction in French accounts (PCG). Arguments = the request body: { input: { format: "json", invoice: {...} } } (or facturx / ubl / bank_transaction), optional profile, history, use_server_history.',
  audit: `Use it to review a batch of up to ${AUDIT_MAX_ITEMS} booked entries or invoices (duplicates, VAT inconsistencies, suspicious accounts). Arguments = { items: [{ invoice: {...} } | { entry: {...} }], profile? }.`,
};

/** Paid tools, in pricing.ts order. */
export const PAID_TOOLS: PaidToolDef[] = (Object.keys(PAID_ENDPOINTS) as PaidEndpointId[]).map((id) => {
  const e = PAID_ENDPOINTS[id];
  return {
    name: e.mcp_tool,
    endpoint: id,
    title: `${e.title} (${e.price_usdc} USDC)`,
    description:
      `PAID: ${e.price_usdc} USDC per call (x402 v2, ${NETWORK_NAME} testnet USDC; ${e.method} ${e.path}). ${e.description} ` +
      `${USAGE[id]} Returns ${e.output_summary}. Not charged when the call fails. ` +
      "Proof of concept on synthetic data, not a substitute for a chartered accountant's review.",
    inputSchema: SCHEMAS[id],
  };
});

export function paidToolByName(name: string): PaidToolDef | undefined {
  return PAID_TOOLS.find((t) => t.name === name);
}

export const GET_CATALOG_TOOL = {
  name: "get_catalog" as const,
  title: "Ajean Ledger catalog (free)",
  description:
    "FREE. Returns the machine-readable service manifest: endpoints, prices in USDC, x402 payment details (network, asset, payTo), payment mode (testnet or simulated), error codes and discovery links.",
  inputSchema: z.object({}),
};

export const GET_RECEIPT_TOOL = {
  name: "get_receipt" as const,
  title: "Payment receipt lookup (free)",
  description:
    "FREE. Returns the payment receipt (amount, tx hash, network, payer) and the stored result of a past paid call, by its request_id (req_…).",
  inputSchema: z.object({
    request_id: z.string().regex(/^req_[0-9A-HJKMNP-TV-Z]{26}$/).describe("request_id returned by a paid tool (req_…)"),
  }),
};

export const ALL_TOOL_NAMES: string[] = [...PAID_TOOLS.map((t) => t.name), GET_CATALOG_TOOL.name, GET_RECEIPT_TOOL.name];

export const MCP_SERVER_INSTRUCTIONS =
  "Ajean Ledger turns French invoices and bank transactions into validated accounting entries (PCG accounts, VAT treatment, " +
  "2026 e-invoicing compliance, anomaly flags). Paid tools cost USDC per call via x402 (testnet; EURC also accepted as accepts[1]). Call get_catalog first for prices. " +
  "Results with human_review_required = true must be shown to a human. PoC on synthetic data; not a substitute for a chartered accountant's review.";
