/** Small deterministic text helpers (accent folding, tokenising, keys). */

export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’']/g, " ")
    .toLowerCase();
}

export function tokens(s: string): string[] {
  return fold(s)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

/** Upper-case alphanumeric key, e.g. for invoice numbers ("BE-2026/0412" -> "BE20260412"). */
export function alnumKey(s: string): string {
  return fold(s).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

const NOISE_WORDS = new Set([
  "SAS", "SASU", "SARL", "EURL", "SA", "SNC", "SCP", "SCI", "SELARL", "SELAS", "SELAFA", "GMBH", "AG", "UG", "KG", "LTD",
  "LLC", "INC", "BV", "NV", "SRL", "SPA", "SL", "LE", "LA", "LES", "L", "DE", "DU", "DES", "D", "ET", "THE", "AND", "CABINET",
  "SOCIETE", "STE", "GROUPE", "ETS", "ETABLISSEMENTS", "MAITRE", "ME", "FICTIONAL", "FICTIF", "FICTIVE",
]);

/**
 * Auxiliary supplier code (max 8 chars, A-Z0-9) derived from the supplier name:
 * first significant word, extended with the next words when shorter than 4 chars.
 */
export function auxiliaryCode(name: string): string {
  const cleaned = fold(name.replace(/\([^)]*\)/g, " ")).toUpperCase();
  const words = cleaned.split(/[^A-Z0-9]+/).filter((w) => w.length > 0 && !NOISE_WORDS.has(w));
  let code = "";
  for (const w of words) {
    code += w;
    if (code.length >= 4) break;
  }
  if (code.length === 0) code = "DIVERS";
  return code.slice(0, 8);
}

/** Sanitise a caller-supplied auxiliary code. */
export function sanitiseAux(code: string): string {
  return fold(code).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

/** Days between two YYYY-MM-DD dates (absolute), deterministic (UTC). */
export function daysBetween(a: string, b: string): number {
  const pa = Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10));
  const pb = Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10));
  return Math.abs(Math.round((pa - pb) / 86_400_000));
}

/** 0 = Sunday ... 6 = Saturday. */
export function dayOfWeek(date: string): number {
  return new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10))).getUTCDay();
}

/** Luhn check used by French SIREN numbers (9 digits). */
export function isValidSiren(siren: string): boolean {
  if (!/^\d{9}$/.test(siren)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let d = Number(siren[8 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export const EU_COUNTRIES = new Set([
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "EL", "HR", "HU", "IE", "IT", "LT", "LU", "LV",
  "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK",
]);
