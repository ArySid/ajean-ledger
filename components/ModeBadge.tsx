import type { PaymentModeLabel } from "@/lib/trace/types";

const SUB: Record<PaymentModeLabel, string> = {
  TESTNET: "real USDC · Base Sepolia",
  SIMULATED: "mock facilitator · fake tx",
  REPLAY: "recorded run",
};

export function ModeBadge({ mode, sub }: { mode: PaymentModeLabel; sub?: string }) {
  return (
    <span className={`mode-badge mode-${mode}`} role="status" aria-label={`Payment mode: ${mode}`} data-testid="mode-badge">
      <span className="dot" aria-hidden="true" />
      {mode}
      <span className="mode-sub">{sub ?? SUB[mode]}</span>
    </span>
  );
}
