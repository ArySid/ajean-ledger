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
  MAX_TIMEOUT_SECONDS,
  NETWORK_CAIP2,
  NETWORK_NAME,
  PAYMENT_SCHEME,
  USDC,
  getPaidEndpoint,
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
 * x402 RouteConfig for a paid endpoint. The price is an explicit AssetAmount
 * (USDC address + atomic amount + EIP-712 domain) taken from pricing.ts, so the
 * PAYMENT-REQUIRED header always carries exactly the configured atomic amount.
 * Returns null when the payTo address is missing in testnet mode.
 */
export function buildRouteConfig(id: PaidEndpointId, mode: PaymentMode = getPaymentMode()): RouteConfig | null {
  const endpoint = getPaidEndpoint(id);
  const payTo = getPayTo(mode);
  if (!payTo) return null;
  return {
    accepts: {
      scheme: PAYMENT_SCHEME,
      network: NETWORK_CAIP2,
      payTo,
      price: {
        asset: USDC.address,
        amount: endpoint.price_atomic,
        extra: { name: USDC.eip712.name, version: USDC.eip712.version },
      },
      maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
    },
    description: endpoint.description,
    mimeType: "application/json",
    serviceName: "Ajean Ledger",
    tags: ["accounting", "france", "e-invoicing", "vat", endpoint.mcp_tool],
    unpaidResponseBody: async () => ({
      contentType: "application/json",
      body: errorBody("PAYMENT_REQUIRED", `Payment required: ${endpoint.price_usdc} USDC on ${NETWORK_NAME} (x402 v2).`, {
        endpoint: endpoint.path,
        price_usdc: endpoint.price_usdc,
        amount_atomic: endpoint.price_atomic,
        asset: USDC.address,
        network: NETWORK_CAIP2,
        pay_to: payTo,
        mode,
        how_to_pay:
          "Decode the base64 PAYMENT-REQUIRED header, sign the EIP-3009 authorization for accepts[0] (exact scheme), retry the same request with the PAYMENT-SIGNATURE header. You are charged only if the call succeeds.",
      }),
    }),
    settlementFailedResponseBody: async (_ctx, failure) => ({
      contentType: "application/json",
      body: errorBody("PAYMENT_SETTLEMENT_FAILED", "The payment could not be settled; the result is withheld.", {
        reason: failure.errorReason ?? null,
        message: failure.errorMessage ?? null,
      }),
    }),
  };
}
