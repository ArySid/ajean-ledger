/**
 * Example requests/responses for the discovery files. The request body is fixtures/01.json `.input`
 * (synthetic, fictional companies). The response is a TRUNCATED copy of the real engine output for
 * that fixture (tests/discovery.test.ts checks that the entry lines still match the engine).
 *
 * Relative imports only (also used by the stdio bridge tests).
 */
import fixture01 from "../../fixtures/01.json";
import { NETWORK_CAIP2, NETWORK_NAME, PAID_ENDPOINTS, USDC, assetPrices } from "../payments/pricing";
import { DISCLAIMER } from "./meta";

type Json = Record<string, unknown>;

/** input of fixtures/01.json: compliant office-supplies invoice, 140.00 EUR excl. VAT at 20%. */
export const EXAMPLE_INVOICE_INPUT = (fixture01 as { input: Json }).input;
const EXAMPLE_INVOICE = (EXAMPLE_INVOICE_INPUT as { invoice: Json }).invoice;

export const EXAMPLE_REQUESTS = {
  entry: { input: EXAMPLE_INVOICE_INPUT },
  invoice_check: { input: EXAMPLE_INVOICE_INPUT },
  audit: { items: [{ invoice: EXAMPLE_INVOICE }] },
} as const;

const eurcPrice = (usdcAtomic: string) => assetPrices(usdcAtomic).find((p) => p.asset === "EURC")!.amount;

/** Example receipt of a call paid with a prepaid credit token (ADR-025). */
export const EXAMPLE_CREDIT_RECEIPT = {
  method: "credits",
  amount: PAID_ENDPOINTS.entry.price_usdc,
  amount_atomic: PAID_ENDPOINTS.entry.price_atomic,
  asset: USDC.symbol,
  asset_address: USDC.address,
  network: NETWORK_NAME,
  network_caip2: NETWORK_CAIP2,
  tx_hash: "",
  payer: null,
  pay_to: "0xServiceWallet…",
  explorer_url: null,
  mode: "simulated",
  paid_at: "2026-11-16T10:05:00.000Z",
  remaining_balance: "1.05",
  remaining_balance_atomic: "1050000",
  credit_token_id: "ct_3f2a9c1b7d4e",
};

export const EXAMPLE_RECEIPT = {
  method: "x402",
  amount: PAID_ENDPOINTS.entry.price_usdc,
  amount_atomic: PAID_ENDPOINTS.entry.price_atomic,
  asset: USDC.symbol,
  asset_address: USDC.address,
  network: NETWORK_NAME,
  network_caip2: NETWORK_CAIP2,
  tx_hash: "0x5151…(64 hex)",
  payer: "0xAgentWallet…",
  pay_to: "0xServiceWallet…",
  explorer_url: null,
  mode: "simulated",
  paid_at: "2026-11-16T10:00:00.000Z",
};

/** Truncated 200 response of POST /api/v1/entry for EXAMPLE_REQUESTS.entry. */
export const EXAMPLE_ENTRY_RESPONSE = {
  request_id: "req_01JD0000000000000000000000",
  receipt: EXAMPLE_RECEIPT,
  invoice: { document_type: "invoice", number: "BE-2026-0412", date: "2026-10-05", totals: { total_excl_vat: 140, total_vat: 28, total_incl_vat: 168 } },
  compliance: {
    status: "compliant",
    checks: [{ rule_id: "FR-INV-NUMBER", label: "Unique invoice number", passed: true, severity: "error", legal_basis_id: "LB-INV-MENTIONS" }],
  },
  entry: {
    journal: "HA",
    date: "2026-10-05",
    reference: "BE-2026-0412",
    lines: [
      { account: "6064", label: "Fournitures administratives", debit: 140, credit: 0 },
      { account: "44566", label: "TVA déductible sur autres biens et services", debit: 28, credit: 0 },
      { account: "401BURO", label: "Fournisseur Buro Velours SARL (fictional)", debit: 0, credit: 168 },
    ],
    balanced: true,
  },
  vat: { regime: "standard", rate: 0.2, deductible: true, breakdown: [{ rate: 0.2, base: 140, vat: 28 }], legal_basis_id: "LB-VAT-RATE-STANDARD" },
  anomalies: [],
  confidence: 0.98,
  human_review_required: false,
  review_reasons: [],
  explanation:
    "Purchase invoice BE-2026-0412 from Buro Velours SARL (fictional) (168.00 EUR incl. VAT) is booked in journal HA: debit 6064 140.00, debit 44566 28.00, credit 401BURO 168.00. …",
  engine: { version: "0.1.0", rules_applied: ["PCG-MAP-6064", "VAT-REGIME-STANDARD", "…"], llm_used: false, extraction_method: "structured_json" },
  disclaimer: DISCLAIMER,
};

/** Unpaid call: the JSON body that comes with the 402 (the PAYMENT-REQUIRED header carries the requirements). */
export function examplePaymentRequiredBody(payTo: string, mode: string) {
  const e = PAID_ENDPOINTS.entry;
  return {
    error: {
      code: "PAYMENT_REQUIRED",
      message: `Payment required: ${e.price_usdc} USDC or ${eurcPrice(e.price_atomic)} EURC on ${NETWORK_NAME} (x402 v2).`,
      details: {
        endpoint: e.path,
        price_usdc: e.price_usdc,
        amount_atomic: e.price_atomic,
        asset: USDC.address,
        network: NETWORK_CAIP2,
        pay_to: payTo,
        mode,
      },
      docs_url: "/llms.txt#errors",
    },
    request_id: "req_01JD0000000000000000000000",
  };
}
