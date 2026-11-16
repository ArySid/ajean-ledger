/**
 * UBL 2.1 Invoice / CreditNote -> InvoiceInput (EN 16931 fields used by the engine).
 */
import type { InvoiceInput, InvoiceLine, Party } from "../types";
import { EngineError } from "../errors";
import { all, at, attr, joinAddress, num, parseXml, text } from "./xml-util";
import { natureFromProcessId } from "./cii";

function party(node: unknown): Party {
  const p = at(node, "Party");
  const addr = at(p, "PostalAddress");
  const legal = at(p, "PartyLegalEntity");
  const companyId = at(legal, "CompanyID");
  const sirenRaw = text(companyId)?.replace(/\s/g, "");
  const scheme = attr(companyId, "schemeID");
  const siren = sirenRaw && /^\d{9}$/.test(sirenRaw) && (scheme === undefined || scheme === "0002") ? sirenRaw : undefined;
  let vat_id: string | undefined;
  for (const ts of all(p, "PartyTaxScheme")) {
    const id = text(at(ts, "CompanyID"))?.replace(/\s/g, "");
    if (id) vat_id = vat_id ?? id;
  }
  const name = text(at(legal, "RegistrationName")) ?? text(at(p, "PartyName", "Name")) ?? "";
  const address = joinAddress([text(at(addr, "StreetName")), text(at(addr, "AdditionalStreetName")), joinAddress([text(at(addr, "PostalZone")), text(at(addr, "CityName"))])?.replace(", ", " ")]);
  return {
    name,
    ...(siren ? { siren } : {}),
    ...(vat_id ? { vat_id } : {}),
    country: (text(at(addr, "Country", "IdentificationCode")) ?? "FR").toUpperCase(),
    ...(address ? { address } : {}),
  };
}

export function parseUbl(xml: string): InvoiceInput {
  const doc = parseXml(xml);
  const isCredit = doc["CreditNote"] !== undefined;
  const root = doc["Invoice"] ?? doc["CreditNote"];
  if (!root) throw new EngineError("INVALID_XML", "Not a UBL 2.1 document: root element Invoice or CreditNote not found.");

  const lineTag = isCredit ? "CreditNoteLine" : "InvoiceLine";
  const qtyTag = isCredit ? "CreditedQuantity" : "InvoicedQuantity";
  const lines: InvoiceLine[] = all(root, lineTag).map((l) => {
    const total = num(at(l, "LineExtensionAmount"));
    const desc = text(at(l, "Item", "Name")) ?? text(at(l, "Item", "Description")) ?? "";
    const pctRate = num(at(l, "Item", "ClassifiedTaxCategory", "Percent")) ?? 0;
    return {
      description: desc,
      quantity: num(at(l, qtyTag)) ?? 0,
      unit_price_excl_vat: num(at(l, "Price", "PriceAmount")) ?? 0,
      vat_rate: Math.round((pctRate / 100) * 10000) / 10000,
      ...(total !== undefined ? { total_excl_vat: total } : {}),
    };
  });

  const notes = all(root, "Note").map((n) => text(n) ?? "").filter(Boolean);
  let late_payment_penalties: string | undefined;
  let fixed_recovery_indemnity_mention = false;
  const legal_mentions: string[] = [];
  for (const n of notes) {
    const content = n.replace(/^#[A-Z]{3}#/, "");
    const low = content.toLowerCase();
    if (/p[ée]nalit|late payment/.test(low)) late_payment_penalties = late_payment_penalties ?? content;
    else if (/recouvrement|recovery/.test(low) && /40/.test(low)) fixed_recovery_indemnity_mention = true;
    else legal_mentions.push(content);
  }
  for (const st of all(at(root, "TaxTotal"), "TaxSubtotal")) {
    const reason = text(at(st, "TaxCategory", "TaxExemptionReason"));
    if (reason && !legal_mentions.includes(reason)) legal_mentions.push(reason);
  }

  const totals = at(root, "LegalMonetaryTotal");
  const ht = num(at(totals, "TaxExclusiveAmount")) ?? num(at(totals, "LineExtensionAmount")) ?? 0;
  const ttc = num(at(totals, "TaxInclusiveAmount")) ?? num(at(totals, "PayableAmount")) ?? 0;
  const vat = num(at(root, "TaxTotal", "TaxAmount")) ?? Math.round((ttc - ht) * 100) / 100;
  const currency = text(at(root, "DocumentCurrencyCode"))?.trim() ?? "EUR";
  if (currency !== "EUR") throw new EngineError("INVALID_INPUT", `Only EUR invoices are supported (got ${currency}).`, [{ path: "DocumentCurrencyCode", message: "must be EUR" }]);

  const deliveryAddr = at(root, "Delivery", "DeliveryLocation", "Address");
  const delivery_address = deliveryAddr
    ? joinAddress([text(at(deliveryAddr, "StreetName")), joinAddress([text(at(deliveryAddr, "PostalZone")), text(at(deliveryAddr, "CityName"))])?.replace(", ", " ")])
    : undefined;
  const paymentNote = text(at(root, "PaymentTerms", "Note"));
  const nature = natureFromProcessId(text(at(root, "ProfileID")));
  const original = text(at(root, "BillingReference", "InvoiceDocumentReference", "ID"));
  const due = text(at(root, "DueDate")) ?? text(at(root, "PaymentMeans", "PaymentDueDate"));

  return {
    document_type: isCredit ? "credit_note" : "invoice",
    number: text(at(root, "ID")) ?? "",
    issue_date: text(at(root, "IssueDate")) ?? "",
    ...(due ? { due_date: due } : {}),
    currency: "EUR",
    supplier: party(at(root, "AccountingSupplierParty")),
    customer: party(at(root, "AccountingCustomerParty")),
    ...(delivery_address ? { delivery_address } : {}),
    ...(nature ? { operation_nature: nature } : {}),
    lines,
    totals: { total_excl_vat: ht, total_vat: vat, total_incl_vat: ttc },
    ...(paymentNote ? { payment_terms: paymentNote } : {}),
    ...(late_payment_penalties ? { late_payment_penalties } : {}),
    fixed_recovery_indemnity_mention,
    ...(legal_mentions.length ? { legal_mentions } : {}),
    ...(original ? { original_invoice_number: original } : {}),
  };
}

/** True when the XML root looks like a CII document (used to accept CII under format "ubl"). */
export function looksLikeCii(xml: string): boolean {
  return /<([A-Za-z0-9_]+:)?CrossIndustryInvoice[\s>]/.test(xml.slice(0, 4000));
}
