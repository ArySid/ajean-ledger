/**
 * Discovery layer: catalog, openapi.json, llms.txt, .well-known/agent.json.
 * Structural validation of the OpenAPI spec ($refs resolve, every paid route of pricing.ts with its
 * price), and faithfulness of the response schemas to the REAL engine output on the fixtures.
 */
import { readdirSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { createEntry, checkInvoice, auditEntries } from "@/engine";
import { loadFixture } from "@/fixtures/loader";
import { ENGINE_CODE_STATUS, ERROR_STATUS } from "@/lib/api/errors";
import { FREE_ENDPOINTS, PAID_ENDPOINT_LIST, USDC } from "@/lib/payments/pricing";
import { buildAgentCard } from "@/lib/discovery/agent-card";
import { buildCatalog } from "@/lib/discovery/catalog";
import { EXAMPLE_ENTRY_RESPONSE, EXAMPLE_INVOICE_INPUT, EXAMPLE_REQUESTS } from "@/lib/discovery/examples";
import { buildLlmsTxt } from "@/lib/discovery/llms";
import { baseUrlFromRequest } from "@/lib/discovery/meta";
import { buildOpenApi } from "@/lib/discovery/openapi";
import {
  AuditRequestSchema,
  AuditResponseSchema,
  AuditResultSchema,
  CheckInvoiceRequestSchema,
  CheckResultSchema,
  CreateEntryRequestSchema,
  EntryResponseSchema,
  EntryResultSchema,
} from "@/lib/discovery/schemas";
import { GET as catalogGET } from "@/app/api/v1/catalog/route";
import { GET as openapiGET } from "@/app/openapi.json/route";
import { GET as llmsGET } from "@/app/llms.txt/route";
import { GET as agentGET } from "@/app/.well-known/agent.json/route";

const BASE = "https://ledger.example.test";
const PAY_TO = "0x1111111111111111111111111111111111111111";
const savedEnv = { ...process.env };
// Set at module load: some describe blocks build documents at collection time.
process.env.PAYMENT_MODE = "simulated";
process.env.SERVICE_PAY_TO_ADDRESS = PAY_TO;
afterAll(() => {
  process.env = { ...savedEnv };
});

type Obj = Record<string, unknown>;

function resolvePointer(doc: Obj, ref: string): unknown {
  expect(ref.startsWith("#/")).toBe(true);
  return ref
    .slice(2)
    .split("/")
    .map((p) => decodeURIComponent(p).replace(/~1/g, "/").replace(/~0/g, "~"))
    .reduce<unknown>((node, key) => (node && typeof node === "object" ? (node as Obj)[key] : undefined), doc);
}

function collectRefs(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) node.forEach((n) => collectRefs(n, out));
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (k === "$ref" && typeof v === "string") out.push(v);
      else collectRefs(v, out);
    }
  }
  return out;
}

describe("openapi.json", () => {
  const spec = buildOpenApi(BASE) as Obj & { paths: Record<string, Record<string, Obj>>; components: Obj };

  it("is OpenAPI 3.1 with info, servers and components", () => {
    expect(spec.openapi).toBe("3.1.0");
    expect((spec.info as Obj).title).toBe("Ajean Ledger");
    expect((spec.servers as Obj[])[0].url).toBe(BASE);
    expect(Object.keys(spec.components.schemas as Obj).length).toBeGreaterThan(30);
  });

  it("every $ref resolves", () => {
    const refs = collectRefs(spec);
    expect(refs.length).toBeGreaterThan(50);
    for (const r of new Set(refs)) expect(resolvePointer(spec, r), r).toBeDefined();
  });

  it("is plain JSON (round-trips) with unique operationIds", () => {
    expect(JSON.parse(JSON.stringify(spec))).toEqual(spec);
    const ids = Object.values(spec.paths).flatMap((p) => Object.values(p).map((op) => op.operationId));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(PAID_ENDPOINT_LIST.map((e) => [e.path, e] as const))("paid route %s is documented with its price", (path, e) => {
    const op = spec.paths[path]?.post as Obj & { responses: Record<string, Obj>; parameters: Obj[] };
    expect(op).toBeDefined();
    expect(op.operationId).toBe(e.mcp_tool);
    const x402 = op["x-x402"] as Obj;
    expect(x402).toMatchObject({ x402Version: 2, scheme: "exact", network: "eip155:84532", asset: USDC.address, amount: e.price_atomic, price_usdc: e.price_usdc, payTo: PAY_TO });
    expect(op["x-payment"]).toMatchObject({ price_usdc: e.price_usdc, price_atomic: e.price_atomic, required: true });
    expect(op.summary).toContain(`${e.price_usdc} USDC`);
    // 402 with the PAYMENT-REQUIRED header whose decoded schema is PaymentRequired
    const r402 = op.responses["402"] as { headers: Obj };
    const hdr = resolvePointer(spec, (r402.headers["PAYMENT-REQUIRED"] as { $ref: string }).$ref) as { schema: Obj };
    expect(hdr.schema.contentSchema).toEqual({ $ref: "#/components/schemas/PaymentRequired" });
    // 200 with PAYMENT-RESPONSE
    expect((op.responses["200"] as { headers: Obj }).headers["PAYMENT-RESPONSE"]).toBeDefined();
    // PAYMENT-SIGNATURE + Idempotency-Key parameters
    const params = op.parameters.map((p) => resolvePointer(spec, (p as { $ref: string }).$ref) as Obj);
    expect(params.map((p) => p.name).sort()).toEqual(["Idempotency-Key", "PAYMENT-SIGNATURE"]);
  });

  it("documents every free endpoint and the MCP endpoint", () => {
    for (const e of FREE_ENDPOINTS) expect(spec.paths[e.path]?.get, e.path).toBeDefined();
    expect(spec.paths["/mcp"]?.post).toBeDefined();
  });

  it("error schema enumerates every API and engine error code", () => {
    const err = (spec.components.schemas as Obj).ErrorResponse as { properties: { error: { properties: { code: { enum: string[] } } } } };
    const codes = err.properties.error.properties.code.enum;
    for (const c of [...Object.keys(ERROR_STATUS), ...Object.keys(ENGINE_CODE_STATUS)]) expect(codes).toContain(c);
  });

  it("documents all EngineInput formats", () => {
    const entryInput = (spec.components.schemas as Obj).EntryEngineInput as { oneOf: { $ref: string }[] };
    expect(entryInput.oneOf.map((o) => o.$ref.split("/").pop()).sort()).toEqual(
      ["BankTransactionEngineInput", "DocumentInput", "FacturxInput", "JsonInvoiceInput", "UblInput"].sort(),
    );
  });
});

describe("contract schemas match the real engine (fixtures)", () => {
  const files = readdirSync("fixtures").filter((f) => /^\d+\.json$/.test(f)).sort();

  it.each(files)("fixtures/%s validates as a request and its engine output validates as EntryResult", async (f) => {
    const fx = loadFixture(`fixtures/${f}`);
    expect(CreateEntryRequestSchema.safeParse({ input: fx.input, ...fx.context }).success).toBe(true);
    const res = await createEntry(fx.input, fx.context ?? {});
    const parsed = EntryResultSchema.safeParse(res);
    expect(parsed.success, JSON.stringify(parsed.error?.issues?.slice(0, 3))).toBe(true);
  });

  it("CheckResult and AuditResult match the engine", async () => {
    const check = await checkInvoice(EXAMPLE_INVOICE_INPUT as never);
    expect(CheckResultSchema.safeParse(check).success).toBe(true);
    expect(CheckInvoiceRequestSchema.safeParse(EXAMPLE_REQUESTS.invoice_check).success).toBe(true);
    expect(AuditRequestSchema.safeParse(EXAMPLE_REQUESTS.audit).success).toBe(true);
    const audit = await auditEntries(EXAMPLE_REQUESTS.audit.items as never);
    const p = AuditResultSchema.safeParse(audit);
    expect(p.success, JSON.stringify(p.error?.issues?.slice(0, 3))).toBe(true);
  });

  it("the example response (truncated) still matches the engine for fixtures/01.json", async () => {
    const res = await createEntry(EXAMPLE_INVOICE_INPUT as never);
    expect(res.entry.lines.map((l) => [l.account, l.debit, l.credit])).toEqual(EXAMPLE_ENTRY_RESPONSE.entry.lines.map((l) => [l.account, l.debit, l.credit]));
    expect(res.compliance.status).toBe(EXAMPLE_ENTRY_RESPONSE.compliance.status);
    expect(res.vat.regime).toBe(EXAMPLE_ENTRY_RESPONSE.vat.regime);
    expect(EntryResponseSchema.safeParse({ ...res, request_id: EXAMPLE_ENTRY_RESPONSE.request_id, receipt: { ...EXAMPLE_ENTRY_RESPONSE.receipt } }).success).toBe(true);
    expect(AuditResponseSchema).toBeDefined();
  });
});

describe("catalog", () => {
  const c = buildCatalog(BASE);
  it("has service identity, payment details and testnet mode", () => {
    expect(c.service).toBe("Ajean Ledger");
    expect(c.base_url).toBe(BASE);
    expect(c.disclaimer).toMatch(/chartered accountant/);
    expect(c.payment).toMatchObject({ protocol: "x402", x402Version: 2, scheme: "exact", network: "eip155:84532", payTo: PAY_TO, mode: "simulated", testnet: true });
    expect(c.payment.asset).toMatchObject({ address: USDC.address, decimals: 6 });
    expect(c.payment.how_to_pay).toHaveLength(4);
    expect(c.payment.how_to_pay.join(" ")).toMatch(/PAYMENT-REQUIRED[\s\S]*EIP-3009[\s\S]*PAYMENT-SIGNATURE[\s\S]*PAYMENT-RESPONSE/);
  });
  it("lists every endpoint with prices from pricing.ts", () => {
    for (const e of PAID_ENDPOINT_LIST) {
      const p = c.endpoints.paid.find((x) => x.path === e.path)!;
      expect(p).toMatchObject({ price_usdc: e.price_usdc, price_atomic: e.price_atomic, mcp_tool: e.mcp_tool });
      expect(p.request_schema).toContain(`${BASE}/openapi.json#/components/schemas/`);
    }
    expect(c.endpoints.free.map((e) => e.path)).toEqual(FREE_ENDPOINTS.map((e) => e.path));
    expect(c.idempotency.header).toBe("Idempotency-Key");
    expect(c.discovery).toMatchObject({ openapi: `${BASE}/openapi.json`, llms_txt: `${BASE}/llms.txt`, agent_card: `${BASE}/.well-known/agent.json`, mcp: `${BASE}/mcp` });
    expect(c.errors.codes.map((x) => x.code)).toContain("PAYMENT_REQUIRED");
    expect(c.examples.create_entry.request).toEqual({ input: EXAMPLE_INVOICE_INPUT });
  });
});

describe("llms.txt", () => {
  const t = buildLlmsTxt(BASE);
  it("follows llmstxt.org conventions and has an errors section", () => {
    expect(t.startsWith("# Ajean Ledger\n\n> ")).toBe(true);
    expect(t).toMatch(/^## Errors$/m);
    expect(t).toContain('<a id="errors"></a>');
    for (const h of ["What it does", "When to call it", "How to pay (x402 v2)", "Endpoints", "Example", "MCP", "Limits", "Disclaimer"]) expect(t).toMatch(new RegExp(`^## ${h.replace(/[()]/g, "\\$&")}$`, "m"));
    for (const e of PAID_ENDPOINT_LIST) expect(t).toContain(`| \`${e.method} ${e.path}\` | \`${e.mcp_tool}\` | ${e.price_usdc} | ${e.price_atomic} |`);
    for (const c of Object.keys(ERROR_STATUS)) expect(t).toContain(`\`${c}\``);
    expect(t).toMatch(/testnet/i);
    expect(t).toMatch(/not a substitute for a chartered accountant's review/i);
  });
});

describe("agent.json", () => {
  const a = buildAgentCard(BASE);
  it("is an agent card with priced skills and an x402 section", () => {
    expect(a).toMatchObject({ name: "Ajean Ledger", url: BASE, provider: { organization: "Ajean (course PoC)" } });
    expect(a.skills.map((s) => s.id)).toEqual(["check_invoice", "create_entry", "audit_entries"]);
    for (const s of a.skills) {
      const e = PAID_ENDPOINT_LIST.find((x) => x.mcp_tool === s.id)!;
      expect(s.price.amount).toBe(e.price_usdc);
      expect(s.inputModes).toEqual(["application/json"]);
      expect(s.outputModes).toEqual(["application/json"]);
      expect(s.examples.length).toBeGreaterThan(0);
    }
    expect(a.x402).toMatchObject({ x402Version: 2, network: "eip155:84532", payTo: PAY_TO });
    expect(a.links).toMatchObject({ catalog: `${BASE}/api/v1/catalog`, openapi: `${BASE}/openapi.json`, llms_txt: `${BASE}/llms.txt`, mcp: `${BASE}/mcp` });
  });
});

describe("route handlers", () => {
  const req = (path: string, headers: Record<string, string> = {}) => new Request(`http://localhost:3000${path}`, { headers });
  it.each([
    ["/api/v1/catalog", catalogGET, "application/json"],
    ["/openapi.json", openapiGET, "application/json"],
    ["/llms.txt", llmsGET, "text/plain; charset=utf-8"],
    ["/.well-known/agent.json", agentGET, "application/json"],
  ] as const)("GET %s → 200 %s", async (path, handler, type) => {
    const res = await handler(req(path));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(type);
    expect(res.headers.get("cache-control")).toMatch(/max-age=\d+/);
    const text = await res.text();
    if (type === "application/json") expect(() => JSON.parse(text)).not.toThrow();
    expect(text).toContain("http://localhost:3000");
  });

  it("derives the base URL from proxy headers and ignores malformed hosts", () => {
    expect(baseUrlFromRequest(req("/x", { "x-forwarded-host": "ajean.example.app", "x-forwarded-proto": "https" }))).toBe("https://ajean.example.app");
    expect(baseUrlFromRequest(req("/x", { "x-forwarded-host": "evil.example/<script>" }))).toBe("http://localhost:3000");
  });
});
