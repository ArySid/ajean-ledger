import Link from "next/link";
import { FlowDiagram } from "@/components/FlowDiagram";
import { PricingTable } from "@/components/PricingTable";
import { SiteHeader } from "@/components/SiteHeader";
import { asEntryResponse, prettyJson } from "@/lib/console/format";
import { priceOfPath } from "@/lib/console/pricing";
import { BUNDLED_REPLAYS } from "@/lib/console/replays";

const TEAM = ["Ary SIDOUN", "Victor BONNAPETIT", "Yoann POMMEROLLE", "Leo COUTURIER"];

const DISCOVERY = [
  { href: "/llms.txt", label: "llms.txt", what: "Plain-text brief for LLM agents: what we do, how to pay." },
  { href: "/openapi.json", label: "OpenAPI 3.1", what: "Full machine-readable spec of every endpoint." },
  { href: "/.well-known/agent.json", label: "agent.json", what: "Agent card at the well-known discovery path." },
  { href: "/api/v1/catalog", label: "Catalog", what: "Services and prices in USDC, as JSON." },
  { href: "/mcp", label: "MCP server", what: "check_invoice, create_entry, audit_entries tools (setup: README, MCP section)." },
];

/** Request / response excerpt taken from the bundled replay of scenario 03 (what an agent really exchanges). */
function sampleExchange() {
  const trace = BUNDLED_REPLAYS["03"];
  const paid = trace.steps.find((s) => s.kind === "http_request" && s.http?.headers?.["PAYMENT-SIGNATURE"]);
  const res = asEntryResponse(trace.result);
  const inv = (paid?.http?.body as { input?: { invoice?: Record<string, unknown> } } | undefined)?.input?.invoice;
  const request = [
    `POST /api/v1/entry`,
    `Content-Type: application/json`,
    `PAYMENT-SIGNATURE: ${String(paid?.http?.headers?.["PAYMENT-SIGNATURE"] ?? "").slice(0, 28)}…`,
    ``,
    prettyJson({
      input: {
        format: "json",
        invoice: inv
          ? { number: inv.number, issue_date: inv.issue_date, supplier: { name: (inv.supplier as { name?: string })?.name, siren: "…" }, lines: inv.lines, totals: inv.totals }
          : {},
      },
    }),
  ].join("\n");
  const response = [
    `HTTP/1.1 200 OK`,
    `PAYMENT-RESPONSE: { "success": true, "transaction": "0x…" }`,
    ``,
    prettyJson({
      request_id: res?.request_id,
      receipt: { amount: res?.receipt?.amount, asset: "USDC", network: res?.receipt?.network, tx_hash: res?.receipt?.tx_hash },
      compliance: { status: res?.compliance?.status, checks: res?.compliance?.checks?.filter((c) => !c.passed) },
      entry: res?.entry ? { journal: res.entry.journal, lines: res.entry.lines, balanced: res.entry.balanced } : undefined,
      anomalies: res?.anomalies,
      human_review_required: res?.human_review_required,
    }),
  ].join("\n");
  return { request, response };
}

export default function Home() {
  const entryPrice = priceOfPath("/api/v1/entry") ?? "0.15";
  const sample = sampleExchange();
  return (
    <>
      <SiteHeader active="home" />
      <main>
        <section className="hero container">
          <div className="hero-grid">
            <div>
              <span className="kicker">AI Agent Economy Challenge · proof of concept</span>
              <h1>Ajean Ledger</h1>
              <p className="pitch">
                An API that lets any AI agent send a French invoice and get back a <strong>validated, machine-readable accounting entry</strong>{" "}
                (PCG accounts, VAT, e-invoicing compliance, anomalies), paid <strong>per call in USDC</strong> over HTTP 402.
              </p>
              <div className="cta-row">
                <Link href="/live" className="btn btn-primary btn-lg">
                  Watch an agent pay and book an invoice →
                </Link>
                <Link href="/operator" className="btn btn-lg">
                  Operator view
                </Link>
              </div>
            </div>
            <div className="statement" role="note">
              <div className="big">
                Built for <em>agents</em>,<br />
                not humans.
              </div>
              <ul>
                <li>No sign-up, no API key: payment is the authentication</li>
                <li>JSON in, JSON out, stable rule ids and error codes</li>
                <li>
                  <span className="money">{entryPrice} USDC</span> per entry, settled in one HTTP round trip (x402)
                </li>
                <li>This website is only a window into agent-to-agent traffic</li>
              </ul>
            </div>
          </div>
        </section>

        <section className="section container" aria-labelledby="flow-h">
          <div className="section-head">
            <h2 id="flow-h">One request, one payment, one entry</h2>
            <p>x402 protocol v2 · USDC on Base Sepolia testnet</p>
          </div>
          <FlowDiagram />
        </section>

        <section className="section container" aria-labelledby="io-h">
          <div className="section-head">
            <h2 id="io-h">What the agent sends, what it receives</h2>
            <p>Scenario 03: a restaurant invoice with the wrong VAT rate</p>
          </div>
          <div className="io-grid">
            <div className="panel io-card">
              <header>
                <span>Agent → Ajean Ledger</span>
                <span className="pill pill-money">paid request</span>
              </header>
              <pre>{sample.request}</pre>
            </div>
            <div className="panel io-card">
              <header>
                <span>Ajean Ledger → agent</span>
                <span className="pill pill-warn">warning · review required</span>
              </header>
              <pre>{sample.response}</pre>
            </div>
          </div>
        </section>

        <section className="section container" aria-labelledby="pricing-h">
          <div className="section-head">
            <h2 id="pricing-h">Pricing: pay per call, in USDC</h2>
            <p>The agent&apos;s operator funds its wallet; the agent pays within its spending policy.</p>
          </div>
          <PricingTable />
        </section>

        <section className="section container" aria-labelledby="disc-h">
          <div className="section-head">
            <h2 id="disc-h">How an agent finds us</h2>
            <p>Free, machine-readable discovery. No human in the loop.</p>
          </div>
          <div className="discover-grid">
            {DISCOVERY.map((d) => (
              <a key={d.href} href={d.href} className="panel discover-card">
                <b>{d.label}</b>
                <span className="path">{d.href}</span>
                <span>{d.what}</span>
              </a>
            ))}
          </div>
        </section>

        <section className="section container" style={{ paddingTop: 8 }}>
          <div className="cta-row">
            <Link href="/live" className="btn btn-primary btn-lg">
              Open the live agent console
            </Link>
            <Link href="/operator" className="btn btn-lg">
              See the agent economy as an operator
            </Link>
          </div>
        </section>

        <footer className="site-footer">
          <div className="container row">
            <div>
              <strong>Team:</strong> {TEAM.join(" · ")}
              <div>Digital Transformation &amp; FinTech · The AI Agent Economy Challenge</div>
            </div>
            <div className="disclaimer">
              PoC: testnet only, synthetic data, not a substitute for a chartered accountant&apos;s review.
            </div>
          </div>
        </footer>
      </main>
    </>
  );
}
