import type { ClientProfile } from "./types";

/** Fictional demo SME whose books are kept by default. */
export const DEMO_PROFILE: ClientProfile = {
  name: "Atelier Lumenor SAS (fictional)",
  siren: "000001008",
  legal_form: "SAS",
  activity: "commercial",
  accounting_basis: "accrual",
  vat_regime: "standard",
  vat_on_debits: false,
};
