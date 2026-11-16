import { MODE_INFO } from "@/lib/console/modes";
import type { PaymentModeLabel } from "@/lib/trace/types";

/** `hint` adds a small ⓘ: the badge then opens the modes legend (see LiveConsole). */
export function ModeBadge({ mode, sub, hint }: { mode: PaymentModeLabel; sub?: string; hint?: boolean }) {
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
      {hint && (
        <span className="mode-hint" aria-hidden="true">
          ⓘ
        </span>
      )}
    </span>
  );
}
