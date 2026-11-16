/**
 * Ajean Ledger engine CLI.
 *
 *   npm run engine -- fixtures/03.json            # full EntryResult (POST /api/v1/entry)
 *   npm run engine -- fixtures/02.json --check    # CheckResult (POST /api/v1/invoice/check)
 *   npm run engine -- --audit fixtures/01.json fixtures/03.json fixtures/06.json   # AuditResult
 *   npm run engine -- fixtures/11.pdf             # Factur-X PDF (or plain PDF with ANTHROPIC_API_KEY)
 *   npm run engine -- fixtures/13.ubl.xml         # UBL 2.1 (or CII) XML
 *
 * Fixture files may carry a "context" (profile, history) which is applied.
 * The LLM layer is enabled only when ANTHROPIC_API_KEY is set (--no-llm disables it).
 */
import { auditEntries, checkInvoice, createAnthropicAdapter, createEntry, isEngineError, type AuditEntryInput, type EngineContext } from "../engine";
import { inputFromPath } from "../fixtures/loader";

async function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith("--")));
  const files = args.filter((a) => !a.startsWith("--"));
  if (files.length === 0 || flags.has("--help")) {
    console.error("Usage: npm run engine -- <fixture.json|invoice.pdf|invoice.xml> [--check] [--audit] [--no-llm]");
    process.exit(files.length === 0 ? 1 : 0);
  }
  const llm = flags.has("--no-llm") ? undefined : createAnthropicAdapter();

  if (flags.has("--audit")) {
    const items: AuditEntryInput[] = [];
    let ctx: EngineContext = { llm };
    for (const f of files) {
      const fx = inputFromPath(f);
      if (fx.input.format === "json") items.push({ invoice: fx.input.invoice });
      else throw new Error(`--audit accepts JSON invoice fixtures only (${f} is ${fx.input.format}).`);
      if (fx.context?.profile) ctx = { ...ctx, profile: fx.context.profile };
    }
    console.log(JSON.stringify(await auditEntries(items, ctx), null, 2));
    return;
  }

  const fx = inputFromPath(files[0]);
  const ctx: EngineContext = { ...(fx.context ?? {}), llm };
  const result = flags.has("--check") ? await checkInvoice(fx.input, ctx) : await createEntry(fx.input, ctx);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  if (isEngineError(e)) {
    console.log(JSON.stringify({ error: e.toJSON() }, null, 2));
    process.exit(2);
  }
  console.error(e);
  process.exit(1);
});
