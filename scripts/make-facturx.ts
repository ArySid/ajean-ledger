/**
 * Generates fixtures/11.pdf: a Factur-X-style PDF of fixture 01.
 *  - one visible A4 page summarising the invoice (Helvetica, standard font)
 *  - an embedded file "factur-x.xml" (CII D16B, EN 16931 shape) with
 *    AFRelationship /Alternative, referenced from the catalog /AF array
 * Fixed dates make the output reproducible. NOTE: this is not a validated
 * PDF/A-3 file (no XMP Factur-X extension schema / output intent); it is
 * enough for the engine's parser, which reads the attachment.
 *
 * Usage: npx tsx scripts/make-facturx.ts [fixtures/01.json] [fixtures/11.pdf]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { AFRelationship, PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { invoiceToCii } from "../engine/parsers/cii-writer";
import type { InvoiceInput } from "../engine/types";

const src = process.argv[2] ?? "fixtures/01.json";
const out = process.argv[3] ?? "fixtures/11.pdf";
const FIXED_DATE = new Date("2026-10-05T09:00:00Z");

// Standard fonts use WinAnsi: replace characters it cannot encode.
const ansi = (s: string) => s.replace(/[—–]/g, "-").replace(/[«»]/g, '"').replace(/[’]/g, "'").replace(/€/g, "EUR");

async function main() {
  const inv = (JSON.parse(readFileSync(src, "utf8")) as { input: { invoice: InvoiceInput } }).input.invoice;
  const xml = invoiceToCii(inv);

  const pdf = await PDFDocument.create();
  pdf.setTitle(`Facture ${inv.number} (fictional)`);
  pdf.setAuthor(inv.supplier.name);
  pdf.setProducer("Ajean Ledger make-facturx (PoC)");
  pdf.setCreator("Ajean Ledger");
  pdf.setCreationDate(FIXED_DATE);
  pdf.setModificationDate(FIXED_DATE);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([595.28, 841.89]);
  let y = 800;
  const write = (t: string, size = 10, f = font) => {
    page.drawText(ansi(t), { x: 50, y, size, font: f, color: rgb(0.1, 0.1, 0.1) });
    y -= size + 6;
  };
  write(`FACTURE ${inv.number}`, 18, bold);
  write("Synthetic document - fictional companies - Ajean Ledger PoC", 8);
  y -= 8;
  write(`${inv.supplier.name} - SIREN ${inv.supplier.siren} - TVA ${inv.supplier.vat_id}`, 10, bold);
  write(inv.supplier.address ?? "");
  y -= 6;
  write(`Client : ${inv.customer.name} - SIREN ${inv.customer.siren} - TVA ${inv.customer.vat_id}`, 10, bold);
  write(inv.customer.address ?? "");
  write(`Date : ${inv.issue_date}   Echeance : ${inv.due_date}   Categorie d'operation : livraison de biens`);
  y -= 10;
  write("Designation                                         Qte     PU HT      TVA     Total HT", 9, bold);
  for (const l of inv.lines) {
    const total = (l.total_excl_vat ?? l.quantity * l.unit_price_excl_vat).toFixed(2);
    write(`${l.description.padEnd(50).slice(0, 50)}  ${String(l.quantity).padStart(4)}  ${l.unit_price_excl_vat.toFixed(2).padStart(8)}  ${(l.vat_rate * 100).toFixed(0).padStart(4)} %  ${total.padStart(9)}`, 9);
  }
  y -= 10;
  write(`Total HT : ${inv.totals.total_excl_vat.toFixed(2)} EUR   TVA 20 % : ${inv.totals.total_vat.toFixed(2)} EUR   Total TTC : ${inv.totals.total_incl_vat.toFixed(2)} EUR`, 11, bold);
  y -= 10;
  write(inv.payment_terms ?? "", 8);
  write(inv.late_payment_penalties ?? "", 8);
  write("Indemnite forfaitaire pour frais de recouvrement : 40 EUR", 8);

  await pdf.attach(new TextEncoder().encode(xml), "factur-x.xml", {
    mimeType: "text/xml",
    description: "Factur-X invoice (CII)",
    creationDate: FIXED_DATE,
    modificationDate: FIXED_DATE,
    afRelationship: AFRelationship.Alternative,
  });
  const bytes = await pdf.save({ useObjectStreams: false });
  writeFileSync(out, bytes);
  console.log(`Wrote ${out} (${bytes.length} bytes) with embedded factur-x.xml (${xml.length} chars)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
