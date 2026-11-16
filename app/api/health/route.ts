// GET /api/health — free. Service status for agents and the console. Never exposes secrets.
import { NextResponse } from "next/server";
import pkg from "@/package.json";
import { engineReady } from "@/lib/api/engine";
import { getFacilitatorUrl, getPaymentMode, getPayTo } from "@/lib/payments/config";
import { NETWORK_CAIP2, NETWORK_NAME, PAID_ENDPOINT_LIST, USDC, X402_VERSION } from "@/lib/payments/pricing";
import { getStoreInfo } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const mode = getPaymentMode();
  const payTo = getPayTo(mode);
  const store = getStoreInfo();
  return NextResponse.json(
    {
      status: payTo && engineReady() ? "ok" : "degraded",
      service: "ajean-ledger",
      version: pkg.version,
      payment: {
        protocol: `x402 v${X402_VERSION}`,
        mode,
        label: mode === "testnet" ? "TESTNET" : "SIMULATED",
        scheme: "exact",
        network: NETWORK_NAME,
        network_caip2: NETWORK_CAIP2,
        asset: { symbol: USDC.symbol, address: USDC.address, decimals: USDC.decimals },
        pay_to: payTo,
        facilitator: mode === "testnet" ? getFacilitatorUrl() : "local simulated facilitator (no on-chain tx)",
      },
      prices: Object.fromEntries(PAID_ENDPOINT_LIST.map((e) => [e.path, e.price_usdc])),
      store,
      engine_ready: engineReady(),
      llm_configured: Boolean(process.env.ANTHROPIC_API_KEY),
      time: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
