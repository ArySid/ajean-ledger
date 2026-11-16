/**
 * VAT rules: rates, regime detection, expected rate per category, breakdown.
 * The engine never silently corrects invoiced VAT: it books what was invoiced
 * and raises anomalies.
 */
import type { InvoiceInput, VatRegime } from "../types";
import { EU_COUNTRIES, fold } from "../text";
import { toCents, vatCents } from "../money";
import type { ExpenseCategory } from "./pcg";

export const VAT_RATES = [0.2, 0.1, 0.055, 0.021] as const;
export const VALID_RATES: readonly number[] = [...VAT_RATES, 0];

export const VAT_ACCOUNTS = {
  deductibleGoodsServices: { account: "44566", label: "TVA déductible sur autres biens et services" },
  deductibleFixedAssets: { account: "44562", label: "TVA déductible sur immobilisations" },
  dueIntraCommunity: { account: "4452", label: "TVA due intracommunautaire" },
} as const;

export function isValidRate(rate: number): boolean {
  return VALID_RATES.some((r) => Math.abs(r - rate) < 1e-9);
}

export function rateLabel(rate: number): string {
  return `${+(rate * 100).toFixed(2)}%`;
}

export function rateBasisId(rate: number): string | undefined {
  if (Math.abs(rate - 0.2) < 1e-9) return "LB-VAT-RATE-STANDARD";
  if (Math.abs(rate - 0.1) < 1e-9) return "LB-VAT-RATE-10";
  if (Math.abs(rate - 0.055) < 1e-9) return "LB-VAT-RATE-5-5";
  if (Math.abs(rate - 0.021) < 1e-9) return "LB-VAT-RATE-2-1";
  return undefined;
}

const EXEMPTION_PATTERNS = ["exoner", "exempt", "261", "262", "293 b", "293b", "non applicable", "not applicable"];
const REVERSE_CHARGE_PATTERNS = ["autoliquidation", "reverse charge", "auto liquidation", "283 2", "283-2", "196", "steuerschuldnerschaft"];

export function hasExemptionMention(inv: InvoiceInput): boolean {
  return (inv.legal_mentions ?? []).some((m) => EXEMPTION_PATTERNS.some((p) => fold(m).includes(p)));
}

export function hasReverseChargeMention(inv: InvoiceInput): boolean {
  return (inv.legal_mentions ?? []).some((m) => REVERSE_CHARGE_PATTERNS.some((p) => fold(m).replace(/-/g, " ").includes(p.replace(/-/g, " "))));
}

export function isFranchiseMention(inv: InvoiceInput): boolean {
  return (inv.legal_mentions ?? []).some((m) => /293\s*b/i.test(fold(m)));
}

export function isTrainingExemptionMention(inv: InvoiceInput): boolean {
  return (inv.legal_mentions ?? []).some((m) => /261[\s-]*4[\s-]*4/.test(fold(m)) || fold(m).includes("formation professionnelle"));
}

export type SupplierLocation = "FR" | "EU" | "NON_EU";

export function supplierLocation(inv: InvoiceInput): SupplierLocation {
  const c = (inv.supplier.country || "FR").toUpperCase();
  if (c === "FR") return "FR";
  return EU_COUNTRIES.has(c) ? "EU" : "NON_EU";
}

export interface LineVat {
  baseCents: number;
  rate: number;
  computedVatCents: number;
}

export interface RegimeDecision {
  regime: VatRegime;
  legal_basis_id?: string;
  /** true when the buyer self-assesses VAT (debit deductible / credit 4452). */
  self_assessed: boolean;
  /** Intra-EU acquisition of goods (vs services) when self_assessed. */
  self_assessed_kind?: "goods" | "services" | "mixed";
  note?: string;
}

/**
 * Regime detection from the invoice alone.
 * - EU supplier (not FR) with no VAT charged -> reverse_charge_intra_eu
 * - non-EU supplier, services only, no VAT -> reverse_charge_non_eu (no self-assessed lines proposed; review)
 * - non-EU supplier with goods, no VAT -> out_of_scope (import VAT via customs; review)
 * - all lines at 0% from a French supplier -> exempt (training / franchise / other exemption)
 * - one positive rate -> standard (20%) or reduced (10/5.5/2.1)
 * - several positive rates -> mixed_rates
 */
export function decideRegime(inv: InvoiceInput, lineKinds: ("goods" | "services")[]): RegimeDecision {
  const loc = supplierLocation(inv);
  const positiveRates = [...new Set(inv.lines.filter((l) => l.vat_rate > 0).map((l) => l.vat_rate))];
  const totalVat = toCents(Math.abs(inv.totals.total_vat));

  if (loc === "EU" && positiveRates.length === 0 && totalVat === 0) {
    const hasGoods = lineKinds.includes("goods");
    const hasServices = lineKinds.includes("services");
    const kind = hasGoods && hasServices ? "mixed" : hasGoods ? "goods" : "services";
    return {
      regime: "reverse_charge_intra_eu",
      self_assessed: true,
      self_assessed_kind: kind,
      legal_basis_id: kind === "goods" ? "LB-VAT-ICA-GOODS" : "LB-VAT-REVERSE-CHARGE-SERVICES",
      note:
        kind === "goods"
          ? "Intra-community acquisition of goods: VAT is self-assessed by the buyer (due and deductible on the same return)."
          : "B2B service from an EU supplier: VAT is self-assessed by the buyer (reverse charge), due and deductible on the same return.",
    };
  }
  if (loc === "NON_EU" && positiveRates.length === 0) {
    const hasGoods = lineKinds.includes("goods");
    if (!hasGoods && lineKinds.length > 0) {
      // B2B services from a supplier established outside the EU: taxable in France,
      // VAT self-assessed by the buyer. 4452 is reserved for intra-EU operations, so
      // the engine proposes no self-assessed VAT lines; they are added after review.
      return {
        regime: "reverse_charge_non_eu",
        self_assessed: false,
        legal_basis_id: "LB-VAT-REVERSE-CHARGE-SERVICES",
        note: "B2B services from a supplier established outside the EU: VAT is self-assessed by the buyer (autoliquidation), due and deductible on the same return. No self-assessed VAT line is proposed: add it after review (VAT due on self-assessed services / deductible VAT).",
      };
    }
    return {
      regime: "out_of_scope",
      self_assessed: false,
      note: "Goods from a supplier established outside the EU: import VAT is handled through the customs declaration / VAT return, not on this invoice; to be reviewed manually.",
    };
  }
  if (positiveRates.length === 0) {
    if (isFranchiseMention(inv)) {
      return { regime: "exempt", self_assessed: false, legal_basis_id: "LB-VAT-FRANCHISE", note: "Supplier under the VAT franchise scheme: no VAT invoiced, nothing to deduct." };
    }
    if (isTrainingExemptionMention(inv)) {
      return { regime: "exempt", self_assessed: false, legal_basis_id: "LB-VAT-EXEMPT-TRAINING", note: "VAT-exempt vocational training: no VAT invoiced, nothing to deduct." };
    }
    return { regime: "exempt", self_assessed: false, note: "No VAT invoiced: exemption or out-of-scope operation; nothing to deduct." };
  }
  if (positiveRates.length > 1) return { regime: "mixed_rates", self_assessed: false, legal_basis_id: "LB-VAT-DEDUCTION-RIGHT" };
  const r = positiveRates[0];
  return {
    regime: Math.abs(r - 0.2) < 1e-9 ? "standard" : "reduced",
    self_assessed: false,
    legal_basis_id: rateBasisId(r) ?? "LB-VAT-DEDUCTION-RIGHT",
  };
}

/** Expected-rate check for one line. Returns the expected rates when the invoiced rate is unexpected. */
export function unexpectedRate(category: ExpenseCategory, description: string, rate: number): number[] | null {
  if (!category.expected_vat_rates || rate === 0) return null;
  let expected = [...category.expected_vat_rates];
  const desc = ` ${fold(description).split(/[^a-z0-9]+/).join(" ")} `;
  for (const ex of category.rate_exceptions ?? []) {
    if (ex.keywords.some((k) => desc.includes(` ${k} `))) expected = [...expected, ...ex.rates];
  }
  return expected.some((e) => Math.abs(e - rate) < 1e-9) ? null : category.expected_vat_rates;
}

/** Per-rate breakdown computed from the lines (VAT rounded per rate). */
export function breakdownByRate(lines: LineVat[]): { rate: number; baseCents: number; vatCents: number }[] {
  const map = new Map<number, number>();
  for (const l of lines) map.set(l.rate, (map.get(l.rate) ?? 0) + l.baseCents);
  return [...map.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([rate, baseCents]) => ({ rate, baseCents, vatCents: vatCents(baseCents, rate) }));
}
