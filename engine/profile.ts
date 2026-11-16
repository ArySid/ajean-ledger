import type { ClientProfile } from "./types";

/** Fictional demo SME whose books are kept by default. */
export const DEMO_PROFILE: ClientProfile = {
  name: "Atelier Lumen SAS (fictional)",
  siren: "902417351",
  legal_form: "SAS",
  activity: "commercial",
  accounting_basis: "accrual",
  vat_regime: "standard",
  vat_on_debits: false,
};
