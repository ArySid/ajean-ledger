/**
 * UN/CEFACT Cross Industry Invoice (CII D16B, as embedded in Factur-X) -> InvoiceInput.
 * Covers the EN 16931 fields the engine needs. Field mapping documented in docs/ENGINE.md.
 */
import type { InvoiceInput, InvoiceLine, OperationNature, Party } from "../types";
import { EngineError } from "../errors";
import { all, at, attr, joinAddress, num, parseXml, text } from "./xml-util";

function cDate(node: unknown): string | undefined {
  const t = text(at(node, "DateTimeString"));
  if (!t) return undefined;
  const d = t.trim();
  return /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d;
}

function party(node: unknown): Party {
  const addr = at(node, "PostalTradeAddress");
  const legal = at(node, "SpecifiedLegalOrganization", "ID");
  const legalScheme = attr(legal, "schemeID");
  const sirenRaw = text(legal)?.replace(/\s/g, "");
  const siren = sirenRaw && (legalScheme === "0002" || legalScheme === undefined) && /^\d{9}$/.test(sirenRaw) ? sirenRaw : undefined;
  let vat_id: string | undefined;
  for (const reg of all(node, "SpecifiedTaxRegistration")) {
    const id = at(reg, "ID");
    if (attr(id, "schemeID") === "VA" || vat_id === undefined) vat_id = text(id)?.replace(/\s/g, "") ?? vat_id;
  }
  const country = text(at(addr, "CountryID")) ?? "FR";
  const address = joinAddress([text(at(addr, "LineOne")), text(at(addr, "LineTwo")), joinAddress([text(at(addr, "PostcodeCode")), text(at(addr, "CityName"))])?.replace(", ", " ")]);
  return {
    name: text(at(node, "Name")) ?? "",
    ...(siren ? { siren } : {}),
    ...(vat_id ? { vat_id } : {}),
    country: country.toUpperCase(),
    ...(address ? { address } : {}),
  };
}

/** French e-invoicing framework code (BT-23): B* goods, S* services, M* mixed. */
export function natureFromProcessId(id?: string): OperationNature | undefined {
  if (!id) return undefined;
  const c = id.trim().toUpperCase();
  if (/^B\d$/.test(c)) return "goods";
  if (/^S\d$/.test(c)) return "services";
  if (/^M\d$/.test(c)) return "mixed";
  return undefined;
}

export function parseCii(xml: string): InvoiceInput {
  const doc = parseXml(xml);
  const root = doc["CrossIndustryInvoice"];
  if (!root) throw new EngineError("INVALID_XML", "Not a CII document: root element CrossIndustryInvoice not found.");
  const header = at(root, "ExchangedDocument");
  const tx = at(root, "SupplyChainTradeTransaction");
  const agreement = at(tx, "ApplicableHeaderTradeAgreement");
  const delivery = at(tx, "ApplicableHeaderTradeDelivery");
  const settlement = at(tx, "ApplicableHeaderTradeSettlement");
  const sums = at(settlement, "SpecifiedTradeSettlementHeaderMonetarySummation");

  const typeCode = text(at(header, "TypeCode"))?.trim();
  const document_type: InvoiceInput["document_type"] = typeCode === "381" ? "credit_note" : "invoice";

  const lines: InvoiceLine[] = all(tx, "IncludedSupplyChainTradeLineItem").map((li) => {
    const qty = num(at(li, "SpecifiedLineTradeDelivery", "BilledQuantity")) ?? 0;
    const price = num(at(li, "SpecifiedLineTradeAgreement", "NetPriceProductTradePrice", "ChargeAmount")) ?? 0;
    const rate = (num(at(li, "SpecifiedLineTradeSettlement", "ApplicableTradeTax", "RateApplicablePercent")) ?? 0) / 100;
    const total = num(at(li, "SpecifiedLineTradeSettlement", "SpecifiedTradeSettlementLineMonetarySummation", "LineTotalAmount"));
    const name = text(at(li, "SpecifiedTradeProduct", "Name")) ?? text(at(li, "SpecifiedTradeProduct", "Description")) ?? "";
    return { description: name, quantity: qty, unit_price_excl_vat: price, vat_rate: Math.round(rate * 10000) / 10000, ...(total !== undefined ? { total_excl_vat: total } : {}) };
  });

  const notes = all(header, "IncludedNote").map((n) => ({ content: text(at(n, "Content")) ?? "", subject: text(at(n, "SubjectCode"))?.trim() }));
  let late_payment_penalties: string | undefined;
  let fixed_recovery_indemnity_mention = false;
  const legal_mentions: string[] = [];
  for (const n of notes) {
    const low = n.content.toLowerCase();
    if (n.subject === "PMD" || /p[ée]nalit/.test(low)) late_payment_penalties = late_payment_penalties ?? n.content;
    else if (n.subject === "PMT" || (/recouvrement|recovery/.test(low) && /40/.test(low))) fixed_recovery_indemnity_mention = true;
    else if (n.content) legal_mentions.push(n.content);
  }
  // Exemption reasons in the VAT breakdown are legal mentions too.
  const taxes = all(settlement, "ApplicableTradeTax");
  let vat_on_debits_option: boolean | undefined;
  for (const t of taxes) {
    const reason = text(at(t, "ExemptionReason"));
    if (reason && !legal_mentions.includes(reason)) legal_mentions.push(reason);
    const due = text(at(t, "DueDateTypeCode"))?.trim();
    if (due === "5") vat_on_debits_option = true;
    else if (due === "72") vat_on_debits_option = vat_on_debits_option ?? false;
  }

  const terms = at(settlement, "SpecifiedTradePaymentTerms");
  const shipTo = at(delivery, "ShipToTradeParty", "PostalTradeAddress");
  const delivery_address = shipTo
    ? joinAddress([text(at(shipTo, "LineOne")), joinAddress([text(at(shipTo, "PostcodeCode")), text(at(shipTo, "CityName"))])?.replace(", ", " ")])
    : undefined;
  const nature = natureFromProcessId(text(at(root, "ExchangedDocumentContext", "BusinessProcessSpecifiedDocumentContextParameter", "ID")));
  const original = text(at(settlement, "InvoiceReferencedDocument", "IssuerAssignedID"));

  const totalHt = num(at(sums, "TaxBasisTotalAmount")) ?? num(at(sums, "LineTotalAmount")) ?? 0;
  const totalVat = num(at(sums, "TaxTotalAmount")) ?? 0;
  const totalTtc = num(at(sums, "GrandTotalAmount")) ?? totalHt + totalVat;
  const currency = text(at(settlement, "InvoiceCurrencyCode"))?.trim() ?? "EUR";
  if (currency !== "EUR") throw new EngineError("INVALID_INPUT", `Only EUR invoices are supported (got ${currency}).`, [{ path: "InvoiceCurrencyCode", message: "must be EUR" }]);

  return {
    document_type,
    number: text(at(header, "ID")) ?? "",
    issue_date: cDate(at(header, "IssueDateTime")) ?? "",
    ...(cDate(at(terms, "DueDateDateTime")) ? { due_date: cDate(at(terms, "DueDateDateTime")) } : {}),
    currency: "EUR",
    supplier: party(at(agreement, "SellerTradeParty")),
    customer: party(at(agreement, "BuyerTradeParty")),
    ...(delivery_address ? { delivery_address } : {}),
    ...(nature ? { operation_nature: nature } : {}),
    ...(vat_on_debits_option !== undefined ? { vat_on_debits_option } : {}),
    lines,
    totals: { total_excl_vat: totalHt, total_vat: totalVat, total_incl_vat: totalTtc },
    ...(text(at(terms, "Description")) ? { payment_terms: text(at(terms, "Description")) } : {}),
    ...(late_payment_penalties ? { late_payment_penalties } : {}),
    fixed_recovery_indemnity_mention,
    ...(legal_mentions.length ? { legal_mentions } : {}),
    ...(original ? { original_invoice_number: original } : {}),
  };
}
