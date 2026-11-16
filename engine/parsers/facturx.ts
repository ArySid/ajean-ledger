/**
 * Factur-X / ZUGFeRD: read the embedded CII XML attachment from a PDF with pdf-lib.
 * Looks in the EmbeddedFiles name tree and in the catalog /AF array for a file
 * named factur-x.xml (or zugferd-invoice.xml / ZUGFeRD-invoice.xml / xrechnung.xml).
 */
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFStream, PDFString, decodePDFRawStream, type PDFObject } from "pdf-lib";
import { EngineError } from "../errors";

export const FACTURX_FILENAMES = ["factur-x.xml", "zugferd-invoice.xml", "xrechnung.xml"];

interface Attachment {
  name: string;
  bytes: Uint8Array;
}

function strOf(o: PDFObject | undefined): string | undefined {
  if (o instanceof PDFString || o instanceof PDFHexString) return o.decodeText();
  return undefined;
}

function streamBytes(stream: PDFObject | undefined): Uint8Array | undefined {
  if (stream instanceof PDFRawStream) return decodePDFRawStream(stream).decode();
  if (stream instanceof PDFStream) return stream.getContents();
  return undefined;
}

function readFileSpec(doc: PDFDocument, spec: PDFObject | undefined, nameHint?: string): Attachment | undefined {
  const dict = spec instanceof PDFDict ? spec : spec ? doc.context.lookup(spec) : undefined;
  if (!(dict instanceof PDFDict)) return undefined;
  const name = strOf(dict.lookup(PDFName.of("UF"))) ?? strOf(dict.lookup(PDFName.of("F"))) ?? nameHint ?? "";
  const ef = dict.lookup(PDFName.of("EF"));
  if (!(ef instanceof PDFDict)) return undefined;
  const bytes = streamBytes(ef.lookup(PDFName.of("F")) ?? ef.lookup(PDFName.of("UF")));
  return bytes ? { name, bytes } : undefined;
}

function walkNameTree(doc: PDFDocument, node: PDFDict, out: Attachment[], depth = 0): void {
  if (depth > 16) return;
  const names = node.lookup(PDFName.of("Names"));
  if (names instanceof PDFArray) {
    for (let i = 0; i + 1 < names.size(); i += 2) {
      const att = readFileSpec(doc, names.get(i + 1), strOf(names.lookup(i)));
      if (att) out.push(att);
    }
  }
  const kids = node.lookup(PDFName.of("Kids"));
  if (kids instanceof PDFArray) {
    for (let i = 0; i < kids.size(); i++) {
      const kid = kids.lookup(i);
      if (kid instanceof PDFDict) walkNameTree(doc, kid, out, depth + 1);
    }
  }
}

export async function listPdfAttachments(pdfBytes: Uint8Array): Promise<Attachment[]> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(pdfBytes, { updateMetadata: false, ignoreEncryption: true });
  } catch (e) {
    throw new EngineError("INVALID_PDF", "The document could not be read as a PDF.", { reason: e instanceof Error ? e.message : String(e) });
  }
  const out: Attachment[] = [];
  const names = doc.catalog.lookup(PDFName.of("Names"));
  if (names instanceof PDFDict) {
    const ef = names.lookup(PDFName.of("EmbeddedFiles"));
    if (ef instanceof PDFDict) walkNameTree(doc, ef, out);
  }
  const af = doc.catalog.lookup(PDFName.of("AF"));
  if (af instanceof PDFArray) {
    for (let i = 0; i < af.size(); i++) {
      const att = readFileSpec(doc, af.get(i));
      if (att && !out.some((o) => o.name === att.name)) out.push(att);
    }
  }
  return out;
}

/** Returns the embedded CII XML, or throws FACTURX_XML_NOT_FOUND. */
export async function extractFacturxXml(pdfBytes: Uint8Array): Promise<string> {
  const atts = await listPdfAttachments(pdfBytes);
  const hit = atts.find((a) => FACTURX_FILENAMES.includes(a.name.toLowerCase()));
  if (!hit) {
    throw new EngineError("FACTURX_XML_NOT_FOUND", "No Factur-X XML attachment (factur-x.xml) found in the PDF.", {
      attachments: atts.map((a) => a.name),
    });
  }
  return new TextDecoder("utf-8").decode(hit.bytes);
}

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/^data:[^;]+;base64,/, "").replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) {
    throw new EngineError("INVALID_INPUT", "document_base64 is not valid base64.", [{ path: "document_base64", message: "invalid base64" }]);
  }
  return new Uint8Array(Buffer.from(clean, "base64"));
}
