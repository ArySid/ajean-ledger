import { MODE_INFO } from "@/lib/console/modes";
import type { PaymentModeLabel } from "@/lib/trace/types";

export function ModeBadge({ mode, sub }: { mode: PaymentModeLabel; sub?: string }) {
  const info = MODE_INFO[mode];
  return (
    <span
      className={`mode-badge mode-${mode}`}
      role="status"
      aria-label={`Payment mode: ${mode}. ${info.long}`}
      title={`${mode}: ${info.long}`}
      data-testid="mode-badge"
    >
      <span className="dot" aria-hidden="true" />
      {mode}
      <span className="mode-sub">{sub ?? info.short}</span>
    </span>
  );
}
