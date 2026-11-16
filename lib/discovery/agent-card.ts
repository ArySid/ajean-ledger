/**
 * GET /.well-known/agent.json — A2A-style agent card. Skills = the paid endpoints (pricing.ts).
 */
import { CREDIT_PACK_LIST, CREDIT_TOKEN_HEADER, CREDITS_PATH, PAID_ENDPOINT_LIST, assetPrices, type PaidEndpointId } from "@/lib/payments/pricing";
import { paymentInfo } from "./catalog";
import { DISCLAIMER, PROVIDER, SERVICE_NAME, SERVICE_TAGLINE, SERVICE_VERSION, discoveryLinks } from "./meta";

const SKILL_META: Record<PaidEndpointId, { tags: string[]; examples: string[] }> = {
  invoice_check: {
    tags: ["e-invoicing", "compliance", "france", "vat", "invoice"],
    examples: [
      "Is this supplier invoice compliant with the French 2026 e-invoicing mandatory mentions?",
      "Check the VAT consistency of this UBL invoice before I pay it.",
    ],
  },
  entry: {
    tags: ["accounting", "journal-entry", "pcg", "vat", "france", "bookkeeping"],
    examples: [
      "Book this office-supplies invoice in French accounts (PCG) with the right VAT treatment.",
      "Propose the journal entry for this intra-EU service invoice (reverse charge).",
      "Match this bank transaction with its invoice and propose the bank entry.",
    ],
  },
  audit: {
    tags: ["audit", "fec", "duplicates", "vat", "statutory-auditor", "tax-inspector"],
    examples: [
      "Audit these 30 purchase entries for duplicates and VAT inconsistencies.",
      "What would a statutory auditor and a tax inspector flag in this FEC extract?",
    ],
  },
};

export function buildAgentCard(baseUrl: string) {
  const links = discoveryLinks(baseUrl);
  const payment = paymentInfo();
  return {
    protocolVersion: "0.3.0",
    name: SERVICE_NAME,
    description: `${SERVICE_TAGLINE} ${DISCLAIMER}`,
    url: baseUrl,
    version: SERVICE_VERSION,
    provider: { ...PROVIDER, url: baseUrl },
    documentationUrl: links.llms_txt,
    preferredTransport: "HTTP+JSON",
    additionalInterfaces: [
      { url: `${baseUrl}/api/v1`, transport: "HTTP+JSON" },
      { url: links.mcp, transport: "MCP (streamable-http)" },
    ],
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false, payments: ["x402"] },
    authentication: { schemes: ["x402"], note: "No sign-up, no API key: payment is the authentication (HTTP 402)." },
    defaultInputModes: ["application/json"],
    defaultOutputModes: ["application/json"],
    skills: PAID_ENDPOINT_LIST.map((e) => ({
      id: e.mcp_tool,
      name: e.title,
      description: `${e.description} Price: ${assetPrices(e.price_atomic).map((p) => `${p.amount} ${p.asset}`).join(" or ")} per call (x402), or prepaid credits.`,
      tags: SKILL_META[e.id].tags,
      examples: SKILL_META[e.id].examples,
      inputModes: ["application/json"],
      outputModes: ["application/json"],
      endpoint: { method: e.method, url: `${baseUrl}${e.path}` },
      price: {
        amount: e.price_usdc,
        amount_atomic: e.price_atomic,
        currency: "USDC",
        network: payment.network,
        alternatives: assetPrices(e.price_atomic).filter((p) => p.asset !== "USDC").map((p) => ({ amount: p.amount, amount_atomic: p.amount_atomic, currency: p.asset })),
      },
      input_schema: `${links.openapi}#/paths/${encodeURIComponent(e.path.replace(/\//g, "~1"))}/post/requestBody`,
    })),
    x402: {
      x402Version: payment.x402Version,
      scheme: payment.scheme,
      network: payment.network,
      testnet: true,
      asset: payment.asset,
      accepted_assets: payment.accepted_assets,
      fx: payment.fx,
      payTo: payment.payTo,
      mode: payment.mode,
      facilitator: payment.facilitator,
      how_to_pay: payment.how_to_pay,
      prices: Object.fromEntries(
        PAID_ENDPOINT_LIST.map((e) => [
          e.mcp_tool,
          { usdc: e.price_usdc, atomic: e.price_atomic, endpoint: e.path, eurc: assetPrices(e.price_atomic).find((p) => p.asset === "EURC")?.amount },
        ]),
      ),
      prepaid_credits: {
        buy: `${baseUrl}${CREDITS_PATH}`,
        header: CREDIT_TOKEN_HEADER,
        packs: CREDIT_PACK_LIST.map((p) => ({ id: p.id, price_usdc: p.price_usdc, credit_usdc: p.credit_usdc, bonus_pct: p.bonus_pct })),
      },
    },
    links: {
      catalog: links.catalog,
      openapi: links.openapi,
      llms_txt: links.llms_txt,
      mcp: links.mcp,
      health: links.health,
    },
    disclaimer: DISCLAIMER,
  };
}
