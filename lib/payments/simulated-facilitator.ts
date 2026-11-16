/**
 * Local mock x402 facilitator used when PAYMENT_MODE=simulated (ADR-005).
 *
 * Implements the same `FacilitatorClient` interface as `HTTPFacilitatorClient`
 * (`verify`, `settle`, `getSupported`), so the x402ResourceServer, the 402
 * response, the PAYMENT-SIGNATURE / PAYMENT-RESPONSE headers and the client code
 * are byte-for-byte the same protocol as in testnet mode. Only the last hop
 * differs: no transaction is broadcast. The returned tx hash starts with
 * `0x5151` ("SISI" — simulated) and is the keccak256 of the payment payload,
 * so it is deterministic and obviously fake.
 *
 * verify() really checks the EIP-3009 authorisation: shape, recipient, amount,
 * validity window, nonce reuse and the EIP-712 signature (local ecrecover via
 * viem, no RPC). Works fully offline.
 */
import { getAddress, keccak256, toHex, verifyTypedData, type Hex } from "viem";
import type { FacilitatorClient } from "@x402/core/server";
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  SupportedResponse,
  VerifyResponse,
} from "@x402/core/types";
import { canonicalJson } from "@/lib/api/canonical";
import { CHAIN_ID, NETWORK_CAIP2, PAYMENT_SCHEME, X402_VERSION } from "./pricing";

export const SIMULATED_TX_PREFIX = "0x5151";
/** Pseudo address reported as the facilitator signer. Not a real wallet. */
export const SIMULATED_FACILITATOR_SIGNER = "0x5151000000000000000000000000000000005151";

const authorizationTypes = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

interface Authorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

type Global = typeof globalThis & { __ajeanSimulatedNonces?: Set<string>; __ajeanVerifiedSignatures?: Map<string, string> };
function usedNonces(): Set<string> {
  const g = globalThis as Global;
  return (g.__ajeanSimulatedNonces ??= new Set<string>());
}

/**
 * Small LRU of payloads whose EIP-712 signature already verified (verify() runs
 * just before settle() on every paid call). The key is the signature itself and
 * the value is every signed field (authorization + EIP-712 domain), so a hit
 * means "this exact signature was verified for these exact values"; anything
 * else falls back to a full ecrecover. Saves one signature recovery (~2 ms CPU)
 * per paid call on the Cloudflare free plan. All the cheap checks (recipient,
 * amount, validity window, nonce reuse) still run on every settle().
 */
export const VERIFIED_CACHE_MAX = 256;
function verifiedSignatures(): Map<string, string> {
  const g = globalThis as Global;
  return (g.__ajeanVerifiedSignatures ??= new Map<string, string>());
}
function rememberVerified(signature: string, signed: string): void {
  const m = verifiedSignatures();
  m.delete(signature);
  m.set(signature, signed);
  while (m.size > VERIFIED_CACHE_MAX) m.delete(m.keys().next().value as string);
}

/** Test helper. */
export function resetSimulatedFacilitator(): void {
  usedNonces().clear();
  verifiedSignatures().clear();
}

/** Test helper: number of cached verified signatures. */
export function verifiedCacheSize(): number {
  return verifiedSignatures().size;
}

/** Deterministic, obviously fake tx hash: 0x5151 + 60 hex chars of keccak256(canonical payload). */
export function simulatedTxHash(paymentPayload: PaymentPayload): string {
  const digest = keccak256(toHex(canonicalJson(paymentPayload.payload)));
  return SIMULATED_TX_PREFIX + digest.slice(2 + 4);
}

export function isSimulatedTxHash(hash: string | null | undefined): boolean {
  return typeof hash === "string" && hash.startsWith(SIMULATED_TX_PREFIX) && hash.length === 66;
}

function isHex(v: unknown, bytes?: number): v is Hex {
  if (typeof v !== "string" || !/^0x[0-9a-fA-F]*$/.test(v)) return false;
  return bytes === undefined || v.length === 2 + bytes * 2;
}

function readAuthorization(payload: PaymentPayload): { auth: Authorization; signature: Hex } | null {
  const p = payload.payload as Record<string, unknown> | undefined;
  const a = p?.authorization as Record<string, unknown> | undefined;
  const signature = p?.signature;
  if (!a || !isHex(signature)) return null;
  const fields = ["from", "to", "value", "validAfter", "validBefore", "nonce"] as const;
  for (const f of fields) if (typeof a[f] !== "string") return null;
  const auth = a as unknown as Authorization;
  if (!isHex(auth.from, 20) || !isHex(auth.to, 20) || !isHex(auth.nonce, 32)) return null;
  if (![auth.value, auth.validAfter, auth.validBefore].every((n) => /^\d+$/.test(n))) return null;
  return { auth, signature };
}

function invalid(invalidReason: string, invalidMessage: string, payer?: string): VerifyResponse {
  return { isValid: false, invalidReason, invalidMessage, ...(payer ? { payer } : {}) };
}

export class SimulatedFacilitatorClient implements FacilitatorClient {
  readonly kind = "simulated" as const;

  async getSupported(): Promise<SupportedResponse> {
    return {
      kinds: [{ x402Version: X402_VERSION, scheme: PAYMENT_SCHEME, network: NETWORK_CAIP2 }],
      extensions: [],
      signers: { "eip155:*": [SIMULATED_FACILITATOR_SIGNER] },
    };
  }

  async verify(paymentPayload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResponse> {
    return this.check(paymentPayload, requirements, false);
  }

  /** Full verification; with `useCache`, a signature already verified for the same signed values skips ecrecover. */
  private async check(paymentPayload: PaymentPayload, requirements: PaymentRequirements, useCache: boolean): Promise<VerifyResponse> {
    if (paymentPayload.x402Version !== X402_VERSION) {
      return invalid("invalid_x402_version", `Only x402 v${X402_VERSION} is supported`);
    }
    if (requirements.scheme !== PAYMENT_SCHEME) return invalid("invalid_exact_evm_scheme", "Unsupported scheme");
    if (requirements.network !== NETWORK_CAIP2 || paymentPayload.accepted?.network !== NETWORK_CAIP2) {
      return invalid("invalid_exact_evm_network_mismatch", `Network must be ${NETWORK_CAIP2}`);
    }
    const parsed = readAuthorization(paymentPayload);
    if (!parsed) return invalid("invalid_exact_evm_payload", "Malformed EIP-3009 authorization payload");
    const { auth, signature } = parsed;
    const payer = getAddress(auth.from);

    if (getAddress(auth.to) !== getAddress(requirements.payTo)) {
      return invalid("invalid_exact_evm_recipient_mismatch", "Authorization recipient is not the payTo address", payer);
    }
    if (BigInt(auth.value) !== BigInt(requirements.amount)) {
      return invalid(
        "invalid_exact_evm_payload_authorization_value_mismatch",
        `Authorized value ${auth.value} does not equal the required amount ${requirements.amount}`,
        payer,
      );
    }
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (BigInt(auth.validBefore) < now + 6n) {
      return invalid("invalid_exact_evm_payload_authorization_valid_before", "Authorization expired", payer);
    }
    if (BigInt(auth.validAfter) > now) {
      return invalid("invalid_exact_evm_payload_authorization_valid_after", "Authorization not yet valid", payer);
    }
    if (usedNonces().has(auth.nonce.toLowerCase())) {
      return invalid("invalid_exact_evm_nonce_already_used", "This authorization nonce was already settled", payer);
    }
    const name = requirements.extra?.name;
    const version = requirements.extra?.version;
    if (typeof name !== "string" || typeof version !== "string") {
      return invalid("invalid_exact_evm_payload", "Missing EIP-712 token domain (name, version)", payer);
    }
    const verifyingContract = getAddress(requirements.asset);
    const signed = [payer, getAddress(auth.to), auth.value, auth.validAfter, auth.validBefore, auth.nonce.toLowerCase(), name, version, CHAIN_ID, verifyingContract].join("|");
    const sigKey = signature.toLowerCase();
    if (useCache && verifiedSignatures().get(sigKey) === signed) return { isValid: true, payer };
    let ok = false;
    try {
      ok = await verifyTypedData({
        address: payer,
        domain: { name, version, chainId: CHAIN_ID, verifyingContract },
        types: authorizationTypes,
        primaryType: "TransferWithAuthorization",
        message: {
          from: payer,
          to: getAddress(auth.to),
          value: BigInt(auth.value),
          validAfter: BigInt(auth.validAfter),
          validBefore: BigInt(auth.validBefore),
          nonce: auth.nonce as Hex,
        },
        signature,
      });
    } catch {
      ok = false;
    }
    if (!ok) return invalid("invalid_exact_evm_signature", "EIP-712 signature does not match the payer", payer);
    rememberVerified(sigKey, signed);
    return { isValid: true, payer };
  }

  async settle(paymentPayload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse> {
    const check = await this.check(paymentPayload, requirements, true);
    if (!check.isValid) {
      return {
        success: false,
        errorReason: check.invalidReason,
        errorMessage: check.invalidMessage,
        payer: check.payer,
        transaction: "",
        network: requirements.network,
      };
    }
    const parsed = readAuthorization(paymentPayload)!;
    usedNonces().add(parsed.auth.nonce.toLowerCase());
    verifiedSignatures().delete(parsed.signature.toLowerCase());
    return {
      success: true,
      payer: check.payer,
      transaction: simulatedTxHash(paymentPayload),
      network: requirements.network,
      amount: requirements.amount,
      extra: { simulated: true, note: "SIMULATED settlement: no on-chain transaction was broadcast." },
    };
  }
}
