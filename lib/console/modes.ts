/**
 * What the three console modes mean — shown as the ModeBadge tooltip and in the /live "Modes" legend,
 * so a jury member never has to guess whether money moved.
 */
import type { PaymentModeLabel } from "@/lib/trace/types";

export interface ModeInfo {
  mode: PaymentModeLabel;
  short: string;
  long: string;
}

export const MODE_INFO: Record<PaymentModeLabel, ModeInfo> = {
  TESTNET: {
    mode: "TESTNET",
    short: "real USDC · Base Sepolia",
    long:
      "Live run. The agent signs a real x402 payment in test USDC; the public x402.org facilitator settles it on Base Sepolia (testnet, no real money). The tx hash opens on Basescan.",
  },
  SIMULATED: {
    mode: "SIMULATED",
    short: "mock facilitator · fake tx",
    long:
      "Live run. Same HTTP 402 → signed payment → 200 exchange and the same real EIP-712 signature checks, but a local facilitator settles it: no on-chain transfer, the tx hash (0x5151…) is fake.",
  },
  REPLAY: {
    mode: "REPLAY",
    short: "recorded run",
    long:
      "No live call. The console plays back a trace recorded earlier from a real run of the same agent (date and origin shown). Used on purpose, or automatically when the live run fails.",
  },
};

export const MODE_ORDER: PaymentModeLabel[] = ["TESTNET", "SIMULATED", "REPLAY"];

/** Note shown under the legend: who decides the mode. */
export const MODE_DECIDED_BY_SERVER =
  "Live runs use the payment mode of this deployment (PAYMENT_MODE, set by the operator); the badge always shows the mode of what is on screen.";
