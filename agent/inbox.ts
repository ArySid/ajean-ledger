/**
 * Inbox items → InboxItem. The fixtures (fixtures/NN.json) stay the source of truth:
 * an inbox file only carries the "envelope" (who sent it, when, what to do) and
 * references the fixture(s) holding the actual document.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { InvoiceFingerprint } from "../engine/types";
import type { AgentTask, InboxItem } from "./types";

export interface InboxMeta {
  id: string;
  kind?: "supplier_invoice" | "audit_request";
  received_at?: string;
  channel?: string;
  from?: string;
  subject?: string;
  task?: AgentTask;
  /** Fixture id ("03") whose .input is the document. */
  fixture?: string;
  /** For task "audit": fixture ids whose invoices are audited together. */
  audit_fixtures?: string[];
  /** Inline document (alternative to `fixture`). */
  input?: Record<string, unknown>;
}

export interface FixtureJson {
  description?: string;
  input: Record<string, unknown>;
  context?: { history?: InvoiceFingerprint[] };
}

export function buildInboxItem(meta: InboxMeta, file: string, getFixture: (id: string) => FixtureJson): InboxItem {
  const task: AgentTask = meta.task ?? (meta.audit_fixtures ? "audit" : "entry");
  const fixtures: string[] = [];
  let input = meta.input;
  let erpSeed: InvoiceFingerprint[] | undefined;
  let auditItems: Record<string, unknown>[] | undefined;
  if (task === "audit") {
    const ids = meta.audit_fixtures ?? (meta.fixture ? [meta.fixture] : []);
    auditItems = ids.map((id) => {
      fixtures.push(id);
      const fx = getFixture(id);
      return { invoice: (fx.input as { invoice?: unknown }).invoice ?? fx.input };
    });
  } else if (meta.fixture) {
    fixtures.push(meta.fixture);
    const fx = getFixture(meta.fixture);
    input = fx.input;
    if (fx.context?.history?.length) erpSeed = fx.context.history;
  }
  if (task !== "audit" && !input) throw new Error(`${file}: no "fixture" nor inline "input"`);
  return {
    id: meta.id,
    file,
    kind: meta.kind ?? (task === "audit" ? "audit_request" : "supplier_invoice"),
    received_at: meta.received_at,
    channel: meta.channel,
    from: meta.from,
    subject: meta.subject,
    task,
    ...(input ? { input } : {}),
    ...(auditItems ? { audit_items: auditItems } : {}),
    ...(erpSeed ? { erp_seed: erpSeed } : {}),
    fixtures,
  };
}

/** Reads fixtures/NN.json from disk (CLI, record script). */
export function fsFixture(root = "."): (id: string) => FixtureJson {
  return (id) => {
    const f = path.join(root, "fixtures", `${id}.json`);
    if (!existsSync(f)) throw new Error(`fixture ${f} not found`);
    return JSON.parse(readFileSync(f, "utf8")) as FixtureJson;
  };
}

/** All inbox/*.json files, sorted by name. */
export function loadInbox(dir = "inbox", root = "."): InboxItem[] {
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  const getFx = fsFixture(root);
  return files.map((f) => {
    const rel = path.join(dir, f).split(path.sep).join("/");
    const meta = JSON.parse(readFileSync(path.join(dir, f), "utf8")) as InboxMeta;
    return buildInboxItem({ ...meta, id: meta.id ?? f.replace(/\.json$/, "") }, rel, getFx);
  });
}
