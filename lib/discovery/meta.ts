/**
 * Service identity shared by every discovery file. Relative imports only.
 */
import pkg from "../../package.json";

export const SERVICE_NAME = "Ajean Ledger";
export const SERVICE_SLUG = "ajean-ledger";
export const SERVICE_VERSION: string = (pkg as { version: string }).version;
export const SERVICE_TAGLINE =
  "Send a French invoice or bank transaction, get back a validated machine-readable accounting entry (PCG accounts, VAT treatment, e-invoicing compliance, anomaly flags), paid per call in USDC via x402.";
export const PROVIDER = { organization: "Ajean (course PoC)" } as const;
export const DISCLAIMER =
  "Proof of concept on synthetic data, testnet only (Base Sepolia test USDC, no real funds). Not a substitute for a chartered accountant's review.";

/** Discovery paths (relative to the service origin). */
export const DISCOVERY_PATHS = {
  catalog: "/api/v1/catalog",
  openapi: "/openapi.json",
  llms_txt: "/llms.txt",
  agent_card: "/.well-known/agent.json",
  mcp: "/mcp",
  health: "/api/health",
  receipts: "/api/v1/receipts/{id}",
} as const;

export function discoveryLinks(baseUrl: string) {
  return {
    catalog: `${baseUrl}${DISCOVERY_PATHS.catalog}`,
    openapi: `${baseUrl}${DISCOVERY_PATHS.openapi}`,
    llms_txt: `${baseUrl}${DISCOVERY_PATHS.llms_txt}`,
    agent_card: `${baseUrl}${DISCOVERY_PATHS.agent_card}`,
    mcp: `${baseUrl}${DISCOVERY_PATHS.mcp}`,
    health: `${baseUrl}${DISCOVERY_PATHS.health}`,
  };
}

/**
 * Public origin of the service, from the request (proxy headers first: Vercel sets
 * x-forwarded-host / x-forwarded-proto). Falls back to the request URL origin.
 */
export function baseUrlFromRequest(req: Request): string {
  const h = req.headers;
  const host = h.get("x-forwarded-host")?.split(",")[0]?.trim() || h.get("host")?.trim();
  const url = new URL(req.url);
  // Only plain host[:port] values are trusted (the value is echoed into discovery files).
  if (!host || !/^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(host)) return url.origin;
  const rawProto = h.get("x-forwarded-proto")?.split(",")[0]?.trim() || url.protocol.replace(":", "");
  const proto = rawProto === "http" || rawProto === "https" ? rawProto : "https";
  return `${proto}://${host}`;
}
