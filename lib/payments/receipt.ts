import type { SettleResponse } from "@x402/core/types";
import type { PaymentMode } from "./config";
import {
  NETWORK_CAIP2,
  NETWORK_NAME,
  USDC,
  assetByAddress,
  atomicToUsdc,
  explorerTxUrl,
  getPaidEndpoint,
  priceInAsset,
  type AssetSymbol,
  type PaidEndpointId,
} from "./pricing";

/** How a call was paid: one x402 payment, or a debit on a prepaid credit token (ADR-025). */
export type PaymentMethod = "x402" | "credits";

/** Payment receipt attached to every paid response (§5.4, ADR-006; asset + method: ADR-024/027). */
export interface Receipt {
  /**
   * "x402" (one on-chain/simulated payment) or "credits" (debit on a prepaid credit token, no settlement).
   * Always set on new receipts; absent on receipts stored before ADR-024/027 (read as "x402").
   */
  method?: PaymentMethod;
  /** Amount paid in `asset`, e.g. "0.15" (USDC) or "0.14" (EURC). */
  amount: string;
  /** Same amount in atomic units (6 decimals), e.g. "150000". */
  amount_atomic: string;
  /** Asset actually paid. Credit debits are always USDC-denominated. */
  asset: AssetSymbol;
  /** Token contract of `asset` on Base Sepolia (absent on receipts stored before ADR-024). */
  asset_address?: string;
  network: typeof NETWORK_NAME;
  network_caip2: typeof NETWORK_CAIP2;
  /** Settlement transaction hash; "" for credit debits (no settlement). */
  tx_hash: string;
  payer: string | null;
  pay_to: string;
  /** Base Sepolia explorer link; null in simulated mode (no on-chain tx) and for credit debits. */
  explorer_url: string | null;
  mode: PaymentMode;
  paid_at: string;
  /** Credits only: balance left on the token after this debit (USDC). */
  remaining_balance?: string;
  remaining_balance_atomic?: string;
  /** Credits only: non-secret id of the token (first 12 hex chars of its SHA-256). */
  credit_token_id?: string;
}

/**
 * Receipt of a settled x402 payment. The asset is the one the payer actually chose among the
 * `accepts` (read from the PaymentPayload's `accepted.asset`); defaults to USDC.
 */
export function buildReceipt(args: {
  /** The paid endpoint (its USDC price is the fallback amount); omit with `listedUsdcAtomic` (credit packs). */
  endpoint?: PaidEndpointId;
  settle: SettleResponse;
  payTo: string;
  mode: PaymentMode;
  /** Token address of the accepted requirement the payer signed (PaymentPayload.accepted.asset). */
  assetAddress?: string | null;
  /** Fallback amount (USDC atomic) when the settlement does not echo it (credit pack purchases). */
  listedUsdcAtomic?: string;
  paidAt?: Date;
}): Receipt {
  const asset = assetByAddress(args.assetAddress) ?? USDC;
  const listed = args.listedUsdcAtomic ?? getPaidEndpoint(args.endpoint ?? "entry").price_atomic;
  const atomic = args.settle.amount && /^\d+$/.test(args.settle.amount) ? args.settle.amount : priceInAsset(listed, asset.symbol);
  const tx = args.settle.transaction;
  return {
    method: "x402",
    amount: atomicToUsdc(atomic, asset.decimals),
    amount_atomic: atomic,
    asset: asset.symbol,
    asset_address: asset.address,
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

/** Receipt of a call paid with a prepaid credit token: no settlement, no tx hash. */
export function buildCreditReceipt(args: {
  amountAtomic: string;
  remainingAtomic: string;
  tokenId: string;
  payTo: string;
  mode: PaymentMode;
  paidAt?: Date;
}): Receipt {
  return {
    method: "credits",
    amount: atomicToUsdc(args.amountAtomic),
    amount_atomic: args.amountAtomic,
    asset: "USDC",
    asset_address: USDC.address,
    network: NETWORK_NAME,
    network_caip2: NETWORK_CAIP2,
    tx_hash: "",
    payer: null,
    pay_to: args.payTo,
    explorer_url: null,
    mode: args.mode,
    paid_at: (args.paidAt ?? new Date()).toISOString(),
    remaining_balance: atomicToUsdc(args.remainingAtomic),
    remaining_balance_atomic: args.remainingAtomic,
    credit_token_id: args.tokenId,
  };
}

/** Old stored receipts (before ADR-024/027) have no `method` / `asset_address`: read them as x402 USDC. */
export function receiptMethod(r: Pick<Receipt, "method"> | null | undefined): PaymentMethod {
  return r?.method === "credits" ? "credits" : "x402";
}
export function receiptAsset(r: Pick<Receipt, "asset"> | null | undefined): AssetSymbol {
  return r?.asset === "EURC" ? "EURC" : "USDC";
}
