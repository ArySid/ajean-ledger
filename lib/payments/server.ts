/**
 * x402 resource server for Ajean Ledger.
 *
 * - PAYMENT_MODE=testnet   → HTTPFacilitatorClient(X402_FACILITATOR_URL) + ExactEvmScheme on eip155:84532.
 * - PAYMENT_MODE=simulated → SimulatedFacilitatorClient (local, offline) + the SAME ExactEvmScheme.
 *
 * The 402 body, the PAYMENT-REQUIRED / PAYMENT-SIGNATURE / PAYMENT-RESPONSE headers
 * and the payment requirements are identical in both modes (ADR-005).
 */
import { HTTPFacilitatorClient, x402ResourceServer, type FacilitatorClient, type RouteConfig } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { errorBody } from "@/lib/api/errors";
import { getFacilitatorUrl, getNetwork, getPaymentMode, getPayTo, type PaymentMode } from "./config";
import {
  ACCEPTED_ASSETS,
  ASSETS,
  CREDIT_PACKS,
  CREDIT_TOKEN_HEADER,
  CREDITS_PATH,
  MAX_TIMEOUT_SECONDS,
  NETWORK_CAIP2,
  NETWORK_NAME,
  PAYMENT_SCHEME,
  USDC,
  assetPrices,
  getPaidEndpoint,
  priceInAsset,
  type CreditPackId,
  type PaidEndpointId,
} from "./pricing";
import { SimulatedFacilitatorClient } from "./simulated-facilitator";

export { getPaymentMode } from "./config";
export type { PaymentMode } from "./config";

type Global = typeof globalThis & { __ajeanX402Servers?: Map<PaymentMode, x402ResourceServer> };
function cache(): Map<PaymentMode, x402ResourceServer> {
  const g = globalThis as Global;
  return (g.__ajeanX402Servers ??= new Map());
}

export function createFacilitatorClient(mode: PaymentMode): FacilitatorClient {
  return mode === "testnet" ? new HTTPFacilitatorClient({ url: getFacilitatorUrl() }) : new SimulatedFacilitatorClient();
}

/** One x402ResourceServer per payment mode, cached on globalThis (shared by all routes). */
export function getResourceServer(mode: PaymentMode = getPaymentMode()): x402ResourceServer {
  const c = cache();
  let server = c.get(mode);
  if (!server) {
    server = new x402ResourceServer(createFacilitatorClient(mode)).register(getNetwork(), new ExactEvmScheme());
    c.set(mode, server);
  }
  return server;
}

/** Test helper: drop cached servers (e.g. after changing PAYMENT_MODE). */
export function resetResourceServers(): void {
  cache().clear();
}

/**
 * The x402 `accepts` list for a USDC-denominated price: one `exact` option per accepted asset
 * (USDC first = default for every client, then EURC at the demo rate, ADR-024). Each price is an
 * explicit AssetAmount (token address + atomic amount + EIP-712 domain) from pricing.ts, so the
 * PAYMENT-REQUIRED header always carries exactly the configured atomic amounts.
 */
export function acceptsFor(usdcAtomic: string, payTo: string) {
  return ACCEPTED_ASSETS.map((sym) => {
    const a = ASSETS[sym];
    return {
      scheme: PAYMENT_SCHEME,
      network: NETWORK_CAIP2,
      payTo,
      price: {
        asset: a.address,
        amount: priceInAsset(usdcAtomic, sym),
        extra: { name: a.eip712.name, version: a.eip712.version },
      },
      maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
    };
  });
}

function priceText(usdcAtomic: string): string {
  return assetPrices(usdcAtomic)
    .map((p) => `${p.amount} ${p.asset}`)
    .join(" or ");
}

const settlementFailedResponseBody: RouteConfig["settlementFailedResponseBody"] = async (_ctx, failure) => ({
  contentType: "application/json",
  body: errorBody("PAYMENT_SETTLEMENT_FAILED", "The payment could not be settled; the result is withheld.", {
    reason: failure.errorReason ?? null,
    message: failure.errorMessage ?? null,
  }),
});

/**
 * x402 RouteConfig for a paid endpoint (two `accepts`: USDC, EURC). Returns null when the payTo
 * address is missing in testnet mode.
 */
export function buildRouteConfig(id: PaidEndpointId, mode: PaymentMode = getPaymentMode()): RouteConfig | null {
  const endpoint = getPaidEndpoint(id);
  const payTo = getPayTo(mode);
  if (!payTo) return null;
  return {
    accepts: acceptsFor(endpoint.price_atomic, payTo),
    description: endpoint.description,
    mimeType: "application/json",
    serviceName: "Ajean Ledger",
    tags: ["accounting", "france", "e-invoicing", "vat", endpoint.mcp_tool],
    unpaidResponseBody: async () => ({
      contentType: "application/json",
      body: errorBody("PAYMENT_REQUIRED", `Payment required: ${priceText(endpoint.price_atomic)} on ${NETWORK_NAME} (x402 v2).`, {
        endpoint: endpoint.path,
        price_usdc: endpoint.price_usdc,
        amount_atomic: endpoint.price_atomic,
        asset: USDC.address,
        accepted_assets: assetPrices(endpoint.price_atomic),
        network: NETWORK_CAIP2,
        pay_to: payTo,
        mode,
        how_to_pay:
          "Decode the base64 PAYMENT-REQUIRED header, sign the EIP-3009 authorization for accepts[0] (USDC, exact scheme) or accepts[1] (EURC), retry the same request with the PAYMENT-SIGNATURE header. You are charged only if the call succeeds. " +
          `Prepaid alternative: send a credit token in the ${CREDIT_TOKEN_HEADER} header (buy one at POST ${CREDITS_PATH}).`,
      }),
    }),
    settlementFailedResponseBody,
  };
}

/** x402 RouteConfig for buying a prepaid credit pack (POST /api/v1/credits, body {pack}). */
export function buildCreditPackRouteConfig(packId: CreditPackId, mode: PaymentMode = getPaymentMode()): RouteConfig | null {
  const pack = CREDIT_PACKS[packId];
  const payTo = getPayTo(mode);
  if (!payTo) return null;
  return {
    accepts: acceptsFor(pack.price_atomic, payTo),
    description: `Ajean Ledger prepaid credit pack "${pack.id}": ${pack.price_usdc} USDC buys ${pack.credit_usdc} USDC of calls (+${pack.bonus_pct}%), valid 30 days.`,
    mimeType: "application/json",
    serviceName: "Ajean Ledger",
    tags: ["accounting", "credits", pack.id],
    unpaidResponseBody: async () => ({
      contentType: "application/json",
      body: errorBody("PAYMENT_REQUIRED", `Payment required: ${priceText(pack.price_atomic)} on ${NETWORK_NAME} for the "${pack.id}" credit pack (x402 v2).`, {
        endpoint: CREDITS_PATH,
        pack: pack.id,
        price_usdc: pack.price_usdc,
        credit_usdc: pack.credit_usdc,
        amount_atomic: pack.price_atomic,
        accepted_assets: assetPrices(pack.price_atomic),
        network: NETWORK_CAIP2,
        pay_to: payTo,
        mode,
      }),
    }),
    settlementFailedResponseBody,
  };
}
