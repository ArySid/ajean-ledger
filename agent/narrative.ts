/**
 * Scripted reasoning texts of the purchasing agent. They are projected to the jury, so they
 * are built from the actual document (supplier, number, amounts, line items) and say plainly
 * what the agent knows, what it does not know, and why it decides what it decides.
 */
import type { InboxItem } from "./types";

export interface DocFacts {
  number?: string;
  supplier?: string;
  supplierCountry?: string;
  totalInclVat?: number;
  totalVat?: number;
  currency: string;
  lines: string[];
  documentType?: string;
}

const eur = (n: number | undefined) => (typeof n === "number" ? n.toFixed(2) : "?");

export function docFacts(item: InboxItem): DocFacts {
  const inv = (item.input as { invoice?: Record<string, unknown> } | undefined)?.invoice;
  if (!inv) return { currency: "EUR", lines: [] };
  const sup = (inv.supplier ?? {}) as { name?: string; country?: string };
  const totals = (inv.totals ?? {}) as { total_incl_vat?: number; total_vat?: number };
  const lines = Array.isArray(inv.lines) ? (inv.lines as { description?: string }[]).map((l) => l.description ?? "").filter(Boolean) : [];
  return {
    number: inv.number as string | undefined,
    supplier: sup.name,
    supplierCountry: sup.country,
    totalInclVat: totals.total_incl_vat,
    totalVat: totals.total_vat,
    currency: (inv.currency as string) ?? "EUR",
    lines,
    documentType: inv.document_type as string | undefined,
  };
}

const COUNTRY: Record<string, string> = { DE: "Germany", ES: "Spain", IT: "Italy", BE: "Belgium", NL: "the Netherlands", IE: "Ireland", LU: "Luxembourg", PT: "Portugal", AT: "Austria" };

/** What makes THIS document hard for a generic agent (no French accounting knowledge). */
function doubts(f: DocFacts): string {
  const text = f.lines.join(" ").toLowerCase();
  if (f.documentType === "credit_note") return "It is a credit note, so the entry must be reversed — and I am not sure which accounts to reverse.";
  if (f.supplierCountry && f.supplierCountry !== "FR") {
    const c = COUNTRY[f.supplierCountry] ?? f.supplierCountry;
    return `The supplier is based in ${c} and charged ${eur(f.totalVat)} ${f.currency} of VAT. I do not know whether French VAT is still due on our side, nor how to book it.`;
  }
  if (/d[ée]jeuner|restaurant|repas|menu|caf[ée]s?\b|d[îi]ner/.test(text)) {
    return "It is a restaurant bill. French VAT rates and deductibility rules for meals are a classic trap, and I have no reliable way to check that the rate charged is the right one.";
  }
  return "It looks routine, but I still need the right PCG account, the VAT treatment and a check of the mandatory e-invoicing mentions before anything goes into our books.";
}

export function intakeReasoning(item: InboxItem): { title: string; detail: string } {
  if (item.task === "audit") {
    const n = item.audit_items?.length ?? 0;
    return {
      title: `Request from the CFO: batch audit of ${n} October purchase invoices`,
      detail: `I am the purchasing agent of Atelier Lumen SAS (fictional). ${item.from ? `${item.from} asks: "${item.subject ?? "audit"}". ` : ""}A batch audit (duplicates, VAT inconsistencies, statutory-auditor and tax-inspector viewpoints) is beyond what I can do myself, so I will look for a paid service — within my spending policy.`,
    };
  }
  const f = docFacts(item);
  const what = f.documentType === "credit_note" ? "credit note" : "invoice";
  const lines = f.lines.length ? ` (${f.lines.slice(0, 3).map((l) => `"${l}"`).join(", ")}${f.lines.length > 3 ? ", …" : ""})` : "";
  return {
    title: `New ${what} ${f.number ?? ""} from ${f.supplier ?? "a supplier"}`.replace(/\s+/g, " ").trim(),
    detail:
      `I am the purchasing agent of Atelier Lumen SAS (fictional). I received ${what} ${f.number ?? "?"} for ${eur(f.totalInclVat)} ${f.currency} incl. VAT${lines}` +
      `${item.channel ? ` by ${item.channel}` : ""}. I must book it in our ERP. ${doubts(f)} ` +
      "I do not know the French chart of accounts (PCG) or the e-invoicing rules in force since 1 Sept 2026, so I will buy a validated entry from a specialised service instead of guessing.",
  };
}

const TASK_NEED: Record<InboxItem["task"], string> = {
  entry: "a full journal entry (PCG accounts + VAT treatment + compliance + anomalies)",
  invoice_check: "an e-invoice compliance check",
  audit: "a batch audit",
};

export function discoveryDetail(task: InboxItem["task"], path: string, price: string, source: string): string {
  return `Free ${source}, no sign-up, no API key. I need ${TASK_NEED[task]}: POST ${path} does exactly that for ${price} USDC, paid per call over HTTP 402 (x402) on Base Sepolia.`;
}

/** Plain-language message to the bookkeeper for each review reason. */
export function reviewMessage(code: string, ctx: { supplier?: string; number?: string; total?: number; vat?: number; detail?: string }): string {
  const who = `${(ctx.supplier ?? "Supplier").replace(/\s*\(fictional\)/i, "")} invoice ${ctx.number ?? ""}`.trim();
  switch (code) {
    case "VAT_RATE_MISMATCH": {
      const d = ctx.detail ?? "";
      const charged = /invoiced at (\d+(?:[.,]\d+)?%)/i.exec(d)?.[1] ?? "a higher rate";
      const expected = /expected rate[^.]*? is (\d+(?:[.,]\d+)?%)/i.exec(d)?.[1] ?? "a lower rate";
      const excess = /excess VAT:\s*([\d.,]+)\s*EUR/i.exec(d)?.[1];
      return `${who} applies ${charged} VAT where ${expected} is expected for this expense${excess ? ` (${excess} EUR of VAT too much)` : ""}. Please ask the supplier for a corrected invoice: only the VAT legally due is deductible.`;
    }
    case "DUPLICATE_SUSPECTED":
      return `${who} (${eur(ctx.total)} EUR) looks like a duplicate of an invoice already booked in our ERP. I kept it as a draft: please confirm before anything is posted or paid twice.`;
    case "BUYER_SIREN_MISSING":
    case "NON_COMPLIANT":
      return `${who} is missing mandatory e-invoicing mentions. Please ask the supplier for a compliant invoice before paying.`;
    default:
      return `${who}: ${ctx.detail ?? code}. Please check before validation.`;
  }
}
