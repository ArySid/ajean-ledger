import { FREE_ROWS, PRICE_ROWS } from "@/lib/console/pricing";

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
              </td>
            </tr>
          ))}
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
    </div>
  );
}
