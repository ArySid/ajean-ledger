/** Shared helpers for CII / UBL parsing with fast-xml-parser. */
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { EngineError } from "../errors";

export type XNode = Record<string, unknown> | string | undefined;

const ARRAY_TAGS = new Set([
  "IncludedSupplyChainTradeLineItem", "ApplicableTradeTax", "IncludedNote", "InvoiceLine", "CreditNoteLine",
  "TaxSubtotal", "Note", "SpecifiedTaxRegistration", "PartyTaxScheme", "PartyIdentification", "SpecifiedTradePaymentTerms",
  "PaymentTerms", "ClassifiedTaxCategory",
]);

export function parseXml(xml: string): Record<string, unknown> {
  const valid = XMLValidator.validate(xml);
  if (valid !== true) {
    throw new EngineError("INVALID_XML", "The XML document is not well-formed.", { line: valid.err.line, message: valid.err.msg });
  }
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    removeNSPrefix: true,
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
    isArray: (name) => ARRAY_TAGS.has(name),
  });
  return parser.parse(xml) as Record<string, unknown>;
}

/** Navigate a path of element names; arrays take their first element. */
export function at(node: unknown, ...path: string[]): XNode {
  let cur: unknown = node;
  for (const p of path) {
    if (cur === undefined || cur === null) return undefined;
    if (Array.isArray(cur)) cur = cur[0];
    if (typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  if (Array.isArray(cur)) cur = cur[0];
  return cur as XNode;
}

export function all(node: unknown, ...path: string[]): unknown[] {
  if (path.length === 0) return Array.isArray(node) ? node : node === undefined ? [] : [node];
  const parent = path.length > 1 ? at(node, ...path.slice(0, -1)) : node;
  if (!parent || typeof parent !== "object") return [];
  const v = (parent as Record<string, unknown>)[path[path.length - 1]];
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
}

export function text(node: unknown): string | undefined {
  if (node === undefined || node === null) return undefined;
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (typeof node === "object" && "#text" in (node as Record<string, unknown>)) return String((node as Record<string, unknown>)["#text"]);
  return undefined;
}

export function attr(node: unknown, name: string): string | undefined {
  if (node && typeof node === "object") {
    const v = (node as Record<string, unknown>)[`@_${name}`];
    return v === undefined ? undefined : String(v);
  }
  return undefined;
}

export function num(node: unknown): number | undefined {
  const t = text(node);
  if (t === undefined || t.trim() === "") return undefined;
  const n = Number(t.trim());
  return Number.isFinite(n) ? n : undefined;
}

export function joinAddress(parts: (string | undefined)[]): string | undefined {
  const s = parts.filter((p) => p && p.trim()).join(", ");
  return s.length > 0 ? s : undefined;
}
