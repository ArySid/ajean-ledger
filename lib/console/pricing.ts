/** Console view of the single pricing config (lib/payments/pricing.ts). Never hardcode prices in the UI. */
import { FREE_ENDPOINTS, NETWORK_CAIP2, PAID_ENDPOINT_LIST, USDC, type PaidEndpoint } from "@/lib/payments/pricing";

export interface PriceRow {
  id: string;
  method: string;
  path: string;
  title: string;
  description: string;
  price_usdc: string;
  price_atomic: string;
  mcp_tool: string;
}

export const PRICE_ROWS: PriceRow[] = PAID_ENDPOINT_LIST.map((e: PaidEndpoint) => ({
  id: e.id,
  method: e.method,
  path: e.path,
  title: e.title,
  description: e.description,
  price_usdc: e.price_usdc,
  price_atomic: e.price_atomic,
  mcp_tool: e.mcp_tool,
}));

export const FREE_ROWS = FREE_ENDPOINTS;
export const PAYMENT_NETWORK = NETWORK_CAIP2;
export const USDC_ADDRESS = USDC.address;

export function priceOfPath(path: string): string | undefined {
  return PRICE_ROWS.find((r) => r.path === path)?.price_usdc;
}

/** Endpoint id ("entry") or path ("/api/v1/entry") → path. */
export function endpointPath(idOrPath: string): string {
  if (idOrPath.startsWith("/")) return idOrPath;
  return PRICE_ROWS.find((r) => r.id === idOrPath)?.path ?? idOrPath;
}
