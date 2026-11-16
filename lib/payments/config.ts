/**
 * Payment configuration read from the environment at call time (never at import
 * time, so `next build` and tests do not depend on env values).
 * Never reads or exposes private keys: the server only needs the payTo ADDRESS.
 */
import { DEFAULT_FACILITATOR_URL, NETWORK_CAIP2 } from "./pricing";

export type PaymentMode = "testnet" | "simulated";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
/** Used only in simulated mode when SERVICE_PAY_TO_ADDRESS is not configured. Clearly fake. */
export const SIMULATED_FALLBACK_PAY_TO = "0x5151515151515151515151515151515151515151";

let warnedMode = false;
let warnedNetwork = false;

/** PAYMENT_MODE: "testnet" | "simulated" (default, also used for any unknown value). */
export function getPaymentMode(): PaymentMode {
  const raw = (process.env.PAYMENT_MODE ?? "").trim().toLowerCase();
  if (raw === "testnet") return "testnet";
  if (raw && raw !== "simulated" && !warnedMode) {
    warnedMode = true;
    console.warn(`[payments] Unknown PAYMENT_MODE="${raw}", falling back to "simulated".`);
  }
  return "simulated";
}

/** Only Base Sepolia is allowed (testnet only, master prompt §4). */
export function getNetwork(): typeof NETWORK_CAIP2 {
  const raw = process.env.X402_NETWORK?.trim();
  if (raw && raw !== NETWORK_CAIP2 && !warnedNetwork) {
    warnedNetwork = true;
    console.warn(`[payments] X402_NETWORK="${raw}" ignored: this PoC is testnet only (${NETWORK_CAIP2}).`);
  }
  return NETWORK_CAIP2;
}

export function getFacilitatorUrl(): string {
  return process.env.X402_FACILITATOR_URL?.trim() || DEFAULT_FACILITATOR_URL;
}

function isAddress(v: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(v);
}

/**
 * The service wallet that receives payments.
 * - testnet: must be a real non-zero address, otherwise null (routes answer 503 SERVICE_MISCONFIGURED).
 * - simulated: falls back to an obviously fake address.
 */
export function getPayTo(mode: PaymentMode = getPaymentMode()): string | null {
  const raw = process.env.SERVICE_PAY_TO_ADDRESS?.trim() ?? "";
  const valid = isAddress(raw) && raw.toLowerCase() !== ZERO_ADDRESS;
  if (valid) return raw;
  return mode === "simulated" ? SIMULATED_FALLBACK_PAY_TO : null;
}
