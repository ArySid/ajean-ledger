/**
 * npm run export:deliverables [-- --only CONCEPT_NOTE]
 *
 * Renders the course deliverables (Markdown) to styled HTML + A4 PDF in deliverables/pdf/:
 *   deliverables/CONCEPT_NOTE.md, DEMO_SCRIPT.md, SLIDES_OUTLINE.md, QA_PREP.md
 *   docs/prompts/PROMPTS_SUBMISSION.md (the prompt export handed in with the PoC)
 *
 * - Markdown → HTML: a deliberately small converter (headings, paragraphs, lists, tables, block quotes,
 *   code blocks, inline code / bold / italic / links, horizontal rules). No dependency.
 * - HTML → PDF: Playwright Chromium `page.pdf` (A4, 2 cm margins, 10.25 pt body, page numbers in the footer).
 *   Playwright is not a project dependency: it is resolved from the project, else from the global npm root.
 * - Page count: pdf-lib. Exits non-zero if the concept note is longer than 2 pages (brief: "max 2 pages").
 */
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "deliverables", "pdf");

interface Doc {
  src: string;
  /** Body font size in pt. */
  fontPt: number;
  /** Max pages allowed (undefined = no limit). */
  maxPages?: number;
}

const DOCS: Doc[] = [
  { src: "deliverables/CONCEPT_NOTE.md", fontPt: 10, maxPages: 2 },
  { src: "deliverables/DEMO_SCRIPT.md", fontPt: 10 },
  { src: "deliverables/SLIDES_OUTLINE.md", fontPt: 10.25 },
  { src: "deliverables/QA_PREP.md", fontPt: 10.25 },
  { src: "docs/prompts/PROMPTS_SUBMISSION.md", fontPt: 10 },
];

// ---------------------------------------------------------------- Markdown → HTML (minimal)

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function inline(src: string): string {
  // Protect inline code first.
  const codes: string[] = [];
  let s = src.replace(/`([^`]+)`/g, (_m, c: string) => {
    codes.push(`<code>${esc(c)}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = esc(s);
  // Autolinks <https://…> (escaped by now).
  s = s.replace(/&lt;(https?:\/\/[^&\s]+)&gt;/g, (_m, u: string) => `<a href="${u}">${u}</a>`);
  // [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, t: string, u: string) => `<a href="${u}">${t}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, "$1<em>$2</em>");
  s = s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => codes[Number(i)]);
  return s;
}

function splitRow(line: string): string[] {
  const t = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  // Split on unescaped pipes that are not inside inline code.
  const cells: string[] = [];
  let cur = "";
  let inCode = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === "`") inCode = !inCode;
    if (ch === "\\" && t[i + 1] === "|") {
      cur += "|";
      i++;
      continue;
    }
    if (ch === "|" && !inCode) {
      cells.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

export function mdToHtml(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  const isTableSep = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
  const listRe = /^(\s*)([-*]|\d+\.)\s+(.*)$/;

  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }
    // Fenced code
    const fence = line.match(/^\s*(`{3,})([\w-]*)\s*$/);
    if (fence) {
      const close = new RegExp(`^\\s*\`{${fence[1].length},}\\s*$`);
      const buf: string[] = [];
      i++;
      while (i < lines.length && !close.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(buf.join("\n"))}</code></pre>`);
      continue;
    }
    // Heading
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const text = h[2].trim();
      const id = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      out.push(`<h${level} id="${id}">${inline(text)}</h${level}>`);
      i++;
      continue;
    }
    // Horizontal rule
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      out.push("<hr/>");
      i++;
      continue;
    }
    // Page break marker
    if (/^<!--\s*pagebreak\s*-->$/.test(line.trim())) {
      out.push('<div class="pagebreak"></div>');
      i++;
      continue;
    }
    if (/^<!--.*-->$/.test(line.trim())) {
      i++;
      continue;
    }
    // Table
    if (line.trim().startsWith("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = splitRow(line);
      const aligns = splitRow(lines[i + 1]).map((c) => (/^:-+:$/.test(c) ? "center" : /-:$/.test(c) ? "right" : ""));
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(splitRow(lines[i++]));
      const al = (k: number) => (aligns[k] ? ` style="text-align:${aligns[k]}"` : "");
      out.push(
        `<table><thead><tr>${head.map((c, k) => `<th${al(k)}>${inline(c)}</th>`).join("")}</tr></thead><tbody>` +
          rows.map((r) => `<tr>${r.map((c, k) => `<td${al(k)}>${inline(c)}</td>`).join("")}</tr>`).join("") +
          "</tbody></table>",
      );
      continue;
    }
    // Block quote (may contain nested markdown)
    if (/^\s*>/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*> ?/, ""));
      out.push(`<blockquote>${mdToHtml(buf.join("\n"))}</blockquote>`);
      continue;
    }
    // List (one nesting level by indentation)
    if (listRe.test(line)) {
      const html: string[] = [];
      const stack: { indent: number; tag: string }[] = [];
      while (i < lines.length) {
        const l = lines[i];
        const m = l.match(listRe);
        if (!m) {
          // Continuation line of the previous item
          if (/^\s{2,}\S/.test(l) && stack.length) {
            html[html.length - 1] = html[html.length - 1].replace(/<\/li>$/, ` ${inline(l.trim())}</li>`);
            i++;
            continue;
          }
          break;
        }
        const indent = m[1].length;
        const tag = /\d/.test(m[2]) ? "ol" : "ul";
        let body = m[3];
        let checkbox = "";
        const cb = body.match(/^\[( |x|X)\]\s+(.*)$/);
        if (cb) {
          checkbox = cb[1].trim() ? "☑ " : "☐ ";
          body = cb[2];
        }
        if (!stack.length || indent > stack[stack.length - 1].indent) {
          const start = tag === "ol" ? Number(m[2].replace(".", "")) : 1;
          html.push(`<${tag}${tag === "ol" && start !== 1 ? ` start="${start}"` : ""}${checkbox ? ' class="checklist"' : ""}>`);
          stack.push({ indent, tag });
        } else {
          while (stack.length > 1 && indent < stack[stack.length - 1].indent) html.push(`</${stack.pop()!.tag}>`);
        }
        html.push(`<li>${checkbox}${inline(body)}</li>`);
        i++;
      }
      while (stack.length) html.push(`</${stack.pop()!.tag}>`);
      // Move nested lists inside the previous <li>.
      out.push(html.join("").replace(/<\/li><(ul|ol)([^>]*)>/g, "<$1$2>").replace(/<\/(ul|ol)>(?=<li>|<\/(ul|ol)>)/g, "</$1></li>"));
      continue;
    }
    // Paragraph
    const buf: string[] = [];
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]) &&
      !/^(#{1,6})\s/.test(lines[i]) &&
      !/^\s*`{3,}[\w-]*\s*$/.test(lines[i]) &&
      !/^\s*>/.test(lines[i]) &&
      !listRe.test(lines[i]) &&
      !(lines[i].trim().startsWith("|") && i + 1 < lines.length && isTableSep(lines[i + 1]))
    )
      buf.push(lines[i++]);
    out.push(`<p>${buf.map((b) => inline(b.trim())).join(buf.length > 1 ? " " : "")}</p>`);
  }
  return out.join("\n");
}

// ---------------------------------------------------------------- HTML page

function page(title: string, body: string, fontPt: number): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(title)}</title>
<style>
  :root { --ink:#16181d; --muted:#5b6170; --rule:#d9dce3; --accent:#1f4fd1; --soft:#f3f5f9; }
  @page { size: A4; margin: 18mm 20mm 18mm 20mm; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; background:#fff; color: var(--ink); font-family: Inter, "Helvetica Neue", Arial, sans-serif;
         font-size: ${fontPt}pt; line-height: 1.32; }
  main { max-width: 170mm; margin: 0 auto; }
  h1 { font-size: 17pt; margin: 0 0 3pt; letter-spacing: -0.01em; }
  h2 { font-size: 12pt; margin: 9pt 0 3pt; color: var(--accent); break-after: avoid; }
  h3 { font-size: 10.75pt; margin: 8pt 0 2pt; break-after: avoid; }
  h4 { font-size: ${fontPt}pt; margin: 6pt 0 2pt; }
  p { margin: 0 0 4.5pt; }
  ul, ol { margin: 0 0 4.5pt; padding-left: 15pt; }
  li { margin: 0 0 1.5pt; }
  ul.checklist { list-style: none; padding-left: 4pt; }
  a { color: var(--accent); text-decoration: none; word-break: break-word; }
  code { font-family: "JetBrains Mono", Menlo, Consolas, monospace; font-size: 0.86em; background: var(--soft);
         padding: 0 2pt; border-radius: 2pt; word-break: break-word; }
  pre { background: var(--soft); padding: 5pt 7pt; border-radius: 3pt; white-space: pre-wrap; font-size: 0.86em; }
  pre code { background: none; padding: 0; }
  table { border-collapse: collapse; width: 100%; margin: 3pt 0 6pt; font-size: 0.92em; break-inside: auto; }
  th, td { border: 0.6pt solid var(--rule); padding: 2.2pt 4pt; vertical-align: top; text-align: left; }
  th { background: var(--soft); font-weight: 600; }
  tr { break-inside: avoid; }
  blockquote { margin: 3pt 0 6pt; padding: 3pt 8pt; border-left: 2.5pt solid var(--accent); background: var(--soft); color: #2b2f38; }
  blockquote p:last-child { margin-bottom: 0; }
  hr { border: none; border-top: 0.6pt solid var(--rule); margin: 7pt 0; }
  .pagebreak { break-after: page; }
  @media screen { body { padding: 16px; } main { max-width: 820px; } }
</style></head>
<body><main>
${body}
</main></body></html>`;
}

// ---------------------------------------------------------------- Playwright

/** The few Playwright calls used here (Playwright is not a project dependency, so no type import). */
interface PwPage {
  setContent(html: string, o: { waitUntil: "load" }): Promise<void>;
  pdf(o: Record<string, unknown>): Promise<Buffer>;
  close(): Promise<void>;
}
interface PwBrowser {
  newContext(): Promise<{ newPage(): Promise<PwPage> }>;
  close(): Promise<void>;
}
interface Pw {
  chromium: { launch(): Promise<PwBrowser> };
}

function loadPlaywright(): Pw {
  const req = createRequire(join(ROOT, "package.json"));
  try {
    return req("playwright");
  } catch {
    const globalRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
    return req(join(globalRoot, "playwright"));
  }
}

function words(md: string): number {
  const text = md
    .replace(/^(`{3,})[\s\S]*?^\1\s*$/gm, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/[|#>*_`]/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s*-{3,}\s*$/gm, " ")
    .replace(/:?-{3,}:?/g, " ");
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

async function main() {
  const onlyIdx = process.argv.indexOf("--only");
  const only = onlyIdx > 0 ? process.argv[onlyIdx + 1] : undefined;
  const docs = only ? DOCS.filter((d) => basename(d.src, ".md") === only) : DOCS;
  if (!docs.length) throw new Error(`unknown document ${only}`);
  mkdirSync(OUT, { recursive: true });

  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const results: { name: string; pages: number; kb: number; words: number; over: boolean }[] = [];
  try {
    for (const d of docs) {
      const md = readFileSync(join(ROOT, d.src), "utf8");
      const name = basename(d.src, ".md");
      const title = (md.match(/^#\s+(.*)$/m)?.[1] ?? name).replace(/[*`]/g, "");
      const html = page(title, mdToHtml(md), d.fontPt);
      const htmlPath = join(OUT, `${name}.html`);
      const pdfPath = join(OUT, `${name}.pdf`);
      writeFileSync(htmlPath, html);
      const p = await ctx.newPage();
      await p.setContent(html, { waitUntil: "load" });
      await p.pdf({
        path: pdfPath,
        format: "A4",
        printBackground: true,
        preferCSSPageSize: true,
        displayHeaderFooter: true,
        headerTemplate: "<span></span>",
        footerTemplate: `<div style="width:100%;font-size:7pt;color:#888;font-family:Arial,sans-serif;padding:0 20mm;display:flex;justify-content:space-between"><span>Ajean Ledger · ${esc(title.replace(/^Ajean Ledger\s*[—-]\s*/, ""))}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
      });
      await p.close();
      const pages = (await PDFDocument.load(readFileSync(pdfPath))).getPageCount();
      results.push({ name, pages, kb: Math.round(statSync(pdfPath).size / 1024), words: words(md), over: !!d.maxPages && pages > d.maxPages });
    }
  } finally {
    await browser.close();
  }

  console.log("document               pages  size    words");
  for (const r of results)
    console.log(`${r.name.padEnd(22)} ${String(r.pages).padStart(5)}  ${`${r.kb} KB`.padStart(6)}  ${String(r.words).padStart(6)}${r.over ? "  ✖ over the page limit" : ""}`);
  console.log(`→ ${OUT}`);
  if (results.some((r) => r.over)) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
