/**
 * Minimal InvoiceInput -> CII XML writer (Factur-X EN 16931 shape). Used by
 * scripts/make-facturx.ts to build the Factur-X fixture; not a certified generator.
 */
import type { InvoiceInput, Party } from "../types";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const amt = (n: number) => n.toFixed(2);
const d102 = (d: string) => d.replace(/-/g, "");
const pct = (r: number) => String(+(r * 100).toFixed(2));

function splitAddress(address?: string): { line?: string; postcode?: string; city?: string } {
  if (!address) return {};
  const m = address.match(/^(.*),\s*(\d{4,5})\s+(.+)$/);
  return m ? { line: m[1], postcode: m[2], city: m[3] } : { line: address };
}

function partyXml(tag: string, p: Party): string {
  const a = splitAddress(p.address);
  return `<ram:${tag}>
        <ram:Name>${esc(p.name)}</ram:Name>${p.siren ? `
        <ram:SpecifiedLegalOrganization><ram:ID schemeID="0002">${p.siren}</ram:ID></ram:SpecifiedLegalOrganization>` : ""}
        <ram:PostalTradeAddress>${a.postcode ? `<ram:PostcodeCode>${esc(a.postcode)}</ram:PostcodeCode>` : ""}${a.line ? `<ram:LineOne>${esc(a.line)}</ram:LineOne>` : ""}${a.city ? `<ram:CityName>${esc(a.city)}</ram:CityName>` : ""}<ram:CountryID>${p.country}</ram:CountryID></ram:PostalTradeAddress>${p.vat_id ? `
        <ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${esc(p.vat_id)}</ram:ID></ram:SpecifiedTaxRegistration>` : ""}
      </ram:${tag}>`;
}

export function invoiceToCii(inv: InvoiceInput): string {
  const process = inv.operation_nature === "goods" ? "B1" : inv.operation_nature === "services" ? "S1" : inv.operation_nature === "mixed" ? "M1" : undefined;
  const notes: string[] = [];
  if (inv.late_payment_penalties) notes.push(`<ram:IncludedNote><ram:Content>${esc(inv.late_payment_penalties)}</ram:Content><ram:SubjectCode>PMD</ram:SubjectCode></ram:IncludedNote>`);
  if (inv.fixed_recovery_indemnity_mention) notes.push(`<ram:IncludedNote><ram:Content>Indemnité forfaitaire pour frais de recouvrement : 40 €</ram:Content><ram:SubjectCode>PMT</ram:SubjectCode></ram:IncludedNote>`);
  for (const m of inv.legal_mentions ?? []) notes.push(`<ram:IncludedNote><ram:Content>${esc(m)}</ram:Content><ram:SubjectCode>REG</ram:SubjectCode></ram:IncludedNote>`);

  const lines = inv.lines.map((l, i) => {
    const total = l.total_excl_vat ?? Math.round(l.quantity * l.unit_price_excl_vat * 100) / 100;
    return `<ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument><ram:LineID>${i + 1}</ram:LineID></ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct><ram:Name>${esc(l.description)}</ram:Name></ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>${amt(l.unit_price_excl_vat)}</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="C62">${l.quantity}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>${l.vat_rate > 0 ? "S" : "E"}</ram:CategoryCode><ram:RateApplicablePercent>${pct(l.vat_rate)}</ram:RateApplicablePercent></ram:ApplicableTradeTax>
        <ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${amt(total)}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>`;
  });

  const perRate = new Map<number, number>();
  for (const l of inv.lines) perRate.set(l.vat_rate, (perRate.get(l.vat_rate) ?? 0) + (l.total_excl_vat ?? l.quantity * l.unit_price_excl_vat));
  const debits = inv.vat_on_debits_option === undefined ? "" : `<ram:DueDateTypeCode>${inv.vat_on_debits_option ? "5" : "72"}</ram:DueDateTypeCode>`;
  const taxes = [...perRate.entries()].sort((a, b) => b[0] - a[0]).map(([rate, base]) =>
    `<ram:ApplicableTradeTax><ram:CalculatedAmount>${amt(Math.round(base * rate * 100) / 100)}</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode><ram:BasisAmount>${amt(base)}</ram:BasisAmount><ram:CategoryCode>${rate > 0 ? "S" : "E"}</ram:CategoryCode>${debits}<ram:RateApplicablePercent>${pct(rate)}</ram:RateApplicablePercent></ram:ApplicableTradeTax>`);

  const ship = inv.delivery_address ? (() => {
    const a = splitAddress(inv.delivery_address);
    return `<ram:ShipToTradeParty><ram:PostalTradeAddress>${a.postcode ? `<ram:PostcodeCode>${esc(a.postcode)}</ram:PostcodeCode>` : ""}${a.line ? `<ram:LineOne>${esc(a.line)}</ram:LineOne>` : ""}${a.city ? `<ram:CityName>${esc(a.city)}</ram:CityName>` : ""}<ram:CountryID>FR</ram:CountryID></ram:PostalTradeAddress></ram:ShipToTradeParty>`;
  })() : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocumentContext>${process ? `
    <ram:BusinessProcessSpecifiedDocumentContextParameter><ram:ID>${process}</ram:ID></ram:BusinessProcessSpecifiedDocumentContextParameter>` : ""}
    <ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:cen.eu:en16931:2017</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>${esc(inv.number)}</ram:ID>
    <ram:TypeCode>${inv.document_type === "credit_note" ? "381" : "380"}</ram:TypeCode>
    <ram:IssueDateTime><udt:DateTimeString format="102">${d102(inv.issue_date)}</udt:DateTimeString></ram:IssueDateTime>
    ${notes.join("\n    ")}
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
    ${lines.join("\n    ")}
    <ram:ApplicableHeaderTradeAgreement>
      ${partyXml("SellerTradeParty", inv.supplier)}
      ${partyXml("BuyerTradeParty", inv.customer)}
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeDelivery>${ship}</ram:ApplicableHeaderTradeDelivery>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
      ${taxes.join("\n      ")}
      <ram:SpecifiedTradePaymentTerms>${inv.payment_terms ? `<ram:Description>${esc(inv.payment_terms)}</ram:Description>` : ""}${inv.due_date ? `<ram:DueDateDateTime><udt:DateTimeString format="102">${d102(inv.due_date)}</udt:DateTimeString></ram:DueDateDateTime>` : ""}</ram:SpecifiedTradePaymentTerms>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>${amt(inv.totals.total_excl_vat)}</ram:LineTotalAmount>
        <ram:TaxBasisTotalAmount>${amt(inv.totals.total_excl_vat)}</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="EUR">${amt(inv.totals.total_vat)}</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>${amt(inv.totals.total_incl_vat)}</ram:GrandTotalAmount>
        <ram:DuePayableAmount>${amt(inv.totals.total_incl_vat)}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>${inv.original_invoice_number ? `
      <ram:InvoiceReferencedDocument><ram:IssuerAssignedID>${esc(inv.original_invoice_number)}</ram:IssuerAssignedID></ram:InvoiceReferencedDocument>` : ""}
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>
`;
}
