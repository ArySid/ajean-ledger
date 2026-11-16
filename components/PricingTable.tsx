import { CREDITS_ENDPOINT, FREE_ROWS, PACK_ROWS, PRICE_ROWS, USDC_PER_EURC } from "@/lib/console/pricing";

/** Prices come from lib/payments/pricing.ts (single source of truth). */
export function PricingTable() {
  const free = FREE_ROWS.filter((r) => ["catalog", "openapi", "llms_txt", "agent_json", "receipts"].includes(r.id));
  return (
    <div className="panel table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Endpoint</th>
            <th scope="col">What the agent gets</th>
            <th scope="col" className="num">
              Price per call
            </th>
          </tr>
        </thead>
        <tbody>
          {PRICE_ROWS.map((r) => (
            <tr key={r.id}>
              <td className="ep">
                {r.method} {r.path}
                <div className="faint" style={{ fontSize: "0.75rem", marginTop: 4 }}>
                  MCP tool: {r.mcp_tool}
                </div>
              </td>
              <td>
                <b>{r.title}.</b> <span className="muted">{r.description}</span>
              </td>
              <td className="num">
                <span className="money price">{r.price_usdc}</span> <span className="muted">USDC</span>
                <div className="faint" style={{ fontSize: "0.75rem", marginTop: 4 }} data-testid={`eurc-${r.id}`}>
                  or {r.price_eurc} EURC
                </div>
              </td>
            </tr>
          ))}
          <tr data-testid="credit-packs">
            <td className="ep">
              POST {CREDITS_ENDPOINT}
              <div className="faint" style={{ fontSize: "0.75rem", marginTop: 4 }}>
                then header X-Credit-Token
              </div>
            </td>
            <td>
              <b>Prepaid credit packs.</b>{" "}
              <span className="muted">
                One x402 payment buys a bearer credit token valid 30 days; each call then debits its USDC price, no per-call signature:{" "}
                {PACK_ROWS.map((p, i) => (
                  <span key={p.id}>
                    {i > 0 && " · "}
                    <b>{p.id}</b> {p.price_usdc} USDC → {p.credit_usdc} USDC of calls (+{p.bonus_pct}%)
                  </span>
                ))}
                .
              </span>
            </td>
            <td className="num">
              {PACK_ROWS.map((p) => (
                <div key={p.id}>
                  <span className="money price">{p.price_usdc}</span> <span className="muted">USDC</span>
                </div>
              ))}
            </td>
          </tr>
          <tr>
            <td className="ep">
              {free.map((f) => (
                <div key={f.id}>
                  {f.method} {f.path}
                </div>
              ))}
            </td>
            <td className="muted">Discovery, specification and receipts: everything an agent needs to find, evaluate and verify the service.</td>
            <td className="num">
              <span className="free price">free</span>
            </td>
          </tr>
        </tbody>
      </table>
      <p className="faint" style={{ fontSize: "0.8rem", margin: "8px 12px 10px" }} data-testid="also-eurc">
        Also accepted: <b>EURC</b> (Circle euro stablecoin, Base Sepolia) as a second option in every 402, priced at a fixed demo rate of 1 EURC = {USDC_PER_EURC} USDC.
        USDC stays the default.
      </p>
    </div>
  );
}
