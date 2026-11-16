/** Console view of the single pricing config (lib/payments/pricing.ts). Never hardcode prices in the UI. */
import {
  CREDIT_PACK_LIST,
  CREDITS_PATH,
  EURC,
  FREE_ENDPOINTS,
  FX_DEMO,
  NETWORK_CAIP2,
  PAID_ENDPOINT_LIST,
  USDC,
  assetPrices,
  type PaidEndpoint,
} from "@/lib/payments/pricing";

export interface PriceRow {
  id: string;
  method: string;
  path: string;
  title: string;
  description: string;
  price_usdc: string;
  price_atomic: string;
  /** Same price in EURC (fixed demo rate, ADR-024). */
  price_eurc: string;
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
  price_eurc: assetPrices(e.price_atomic).find((p) => p.asset === "EURC")!.amount,
  mcp_tool: e.mcp_tool,
}));

/** Prepaid credit packs (ADR-025), with their EURC price. */
export const PACK_ROWS = CREDIT_PACK_LIST.map((p) => ({
  ...p,
  price_eurc: assetPrices(p.price_atomic).find((x) => x.asset === "EURC")!.amount,
}));
export const CREDITS_ENDPOINT = CREDITS_PATH;
export const EURC_ADDRESS = EURC.address;
export const FX_NOTE = FX_DEMO.note;
export const USDC_PER_EURC = FX_DEMO.usdc_per_eurc;

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
