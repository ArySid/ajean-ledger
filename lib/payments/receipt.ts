import type { SettleResponse } from "@x402/core/types";
import type { PaymentMode } from "./config";
import {
  NETWORK_CAIP2,
  NETWORK_NAME,
  atomicToUsdc,
  explorerTxUrl,
  getPaidEndpoint,
  type PaidEndpointId,
} from "./pricing";

/** Payment receipt attached to every paid response (§5.4, ADR-006). */
export interface Receipt {
  /** Amount paid in USDC, e.g. "0.15". */
  amount: string;
  /** Same amount in USDC atomic units (6 decimals), e.g. "150000". */
  amount_atomic: string;
  asset: "USDC";
  network: typeof NETWORK_NAME;
  network_caip2: typeof NETWORK_CAIP2;
  tx_hash: string;
  payer: string | null;
  pay_to: string;
  /** Base Sepolia explorer link; null in simulated mode (no on-chain tx). */
  explorer_url: string | null;
  mode: PaymentMode;
  paid_at: string;
}

export function buildReceipt(args: {
  endpoint: PaidEndpointId;
  settle: SettleResponse;
  payTo: string;
  mode: PaymentMode;
  paidAt?: Date;
}): Receipt {
  const endpoint = getPaidEndpoint(args.endpoint);
  const atomic = args.settle.amount && /^\d+$/.test(args.settle.amount) ? args.settle.amount : endpoint.price_atomic;
  const tx = args.settle.transaction;
  return {
    amount: atomicToUsdc(atomic),
    amount_atomic: atomic,
    asset: "USDC",
    network: NETWORK_NAME,
    network_caip2: NETWORK_CAIP2,
    tx_hash: tx,
    payer: args.settle.payer ?? null,
    pay_to: args.payTo,
    explorer_url: args.mode === "testnet" && tx ? explorerTxUrl(tx) : null,
    mode: args.mode,
    paid_at: (args.paidAt ?? new Date()).toISOString(),
  };
}
