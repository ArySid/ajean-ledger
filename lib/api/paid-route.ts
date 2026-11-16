/**
 * Paid API route factory: x402 v2 via `withX402` from @x402/next.
 *
 * Request pipeline (outer wrapper → withX402 → inner handler):
 *   1. rate limit, body size, Idempotency-Key format          (outer, before payment)
 *   2. idempotent replay / conflict                            (outer, BEFORE payment verification)
 *   3. withX402: no PAYMENT-SIGNATURE → 402 + PAYMENT-REQUIRED  (agent learns the price)
 *               invalid payment     → 402 PAYMENT_INVALID
 *               valid payment       → inner handler runs
 *   4. inner handler: envelope validation + engine call; any error → 4xx/5xx → withX402 does NOT settle
 *   5. withX402 settles only when the inner handler returned < 400, adds PAYMENT-RESPONSE
 *   6. outer: decodes PAYMENT-RESPONSE (tx hash, payer), rebuilds the JSON body as
 *      { request_id, receipt, ...result }, persists the receipt, returns.
 *
 * The inner handler cannot see the settlement (it happens after it returns), which is
 * why the receipt is attached in the outer wrapper from the PAYMENT-RESPONSE header.
 * The asset paid (USDC or EURC, ADR-024) is read from the PAYMENT-SIGNATURE payload (`accepted.asset`).
 *
 * Prepaid credits (ADR-025): a request with `X-Credit-Token` and no PAYMENT-SIGNATURE skips step 3:
 *   reserve the USDC price on the token (per-token lock) → engine → 200 with receipt {method: "credits"};
 *   engine error → refund (never charged on error); unknown/expired token or low balance → 402 with the
 *   normal PAYMENT-REQUIRED header (the agent can still pay with x402) + details.credits.
 * Idempotent replays are checked before either payment path, so a retried credit call is never debited twice.
 */
import { NextRequest, NextResponse } from "next/server";
import { withX402 } from "@x402/next";
import { decodePaymentRequiredHeader, decodePaymentResponseHeader, decodePaymentSignatureHeader } from "@x402/core/http";
import type { ClientProfile, InvoiceFingerprint } from "@/engine/types";
import { getPayTo, getPaymentMode, type PaymentMode } from "@/lib/payments/config";
import {
  CREDIT_REFUSAL_MESSAGES,
  creditTokenId,
  hashCreditToken,
  parseCreditToken,
  refundCredit,
  reserveCredit,
  type CreditRefusal,
} from "@/lib/payments/credits";
import { CREDITS_PATH, CREDIT_TOKEN_HEADER, atomicToUsdc, getPaidEndpoint, type PaidEndpointId } from "@/lib/payments/pricing";
import { buildCreditReceipt, buildReceipt } from "@/lib/payments/receipt";
import { buildRouteConfig, getResourceServer } from "@/lib/payments/server";
import { getStore, type ReceiptRecord } from "@/lib/store";
import { fingerprintKey } from "@/lib/store/stats";
import { defaultProfile, fingerprintOf, getEngine, llmAdapter } from "./engine";
import { parseAuditEnvelope, parseInvoiceEnvelope } from "./envelope";
import { ApiError, errorBody, errorResponse, toApiError } from "./errors";
import { IDEMPOTENT_REPLAY_HEADER, acquireKey, readIdempotencyKey, releaseKey, requestHash } from "./idempotency";
import { checkRateLimit, clientKey } from "./rate-limit";
import { newRequestId } from "./request-id";

export const MAX_BODY_BYTES = 5_000_000;
const PAYMENT_RESPONSE_HEADER = "PAYMENT-RESPONSE";
const PAYMENT_REQUIRED_HEADER = "PAYMENT-REQUIRED";
const PAYMENT_SIGNATURE_HEADER = "PAYMENT-SIGNATURE";
export const CREDIT_BALANCE_HEADER = "X-Credit-Balance";

/** Token address the payer chose (PaymentPayload.accepted.asset), or null. */
export function paidAssetAddress(headers: Headers): string | null {
  const sig = headers.get(PAYMENT_SIGNATURE_HEADER) ?? headers.get("X-PAYMENT");
  if (!sig) return null;
  try {
    return decodePaymentSignatureHeader(sig).accepted?.asset ?? null;
  } catch {
    return null;
  }
}

type RouteHandler = (req: NextRequest) => Promise<NextResponse>;

interface CallContext {
  requestId: string;
  endpoint: PaidEndpointId;
  body: unknown;
  parseError: ApiError | null;
  result?: unknown;
  profileSiren?: string;
  fingerprint?: InvoiceFingerprint | null;
}

const callContexts = new WeakMap<Request, CallContext>();

// ---------------------------------------------------------------------------
// Inner handler (runs only after the payment was verified)
// ---------------------------------------------------------------------------

function mergeHistory(a: InvoiceFingerprint[] = [], b: InvoiceFingerprint[] = []): InvoiceFingerprint[] {
  const m = new Map<string, InvoiceFingerprint>();
  for (const fp of [...a, ...b]) m.set(fingerprintKey(fp), fp);
  return [...m.values()];
}

export async function compute(ctx: CallContext): Promise<unknown> {
  if (ctx.parseError) throw ctx.parseError;
  if (ctx.endpoint === "audit") {
    const env = parseAuditEnvelope(ctx.body);
    return getEngine().auditEntries(env.items, { profile: env.profile, llm: llmAdapter() });
  }
  const env = parseInvoiceEnvelope(ctx.body, ctx.endpoint);
  if ((env.input.format === "pdf" || env.input.format === "image") && !process.env.ANTHROPIC_API_KEY) {
    throw new ApiError(
      "LLM_UNAVAILABLE",
      "Unstructured pdf/image extraction needs the LLM layer, which is not configured on this deployment. Send format json, facturx or ubl. Not charged.",
    );
  }
  const engine = getEngine();
  const profile: ClientProfile | undefined = env.profile;
  const siren = profile?.siren ?? defaultProfile()?.siren ?? "default";
  let history = env.history;
  if (env.use_server_history) history = mergeHistory(history, await getStore().history(siren));
  const engineCtx = { profile, history, llm: llmAdapter() };
  if (ctx.endpoint === "invoice_check") return engine.checkInvoice(env.input, engineCtx);
  const result = await engine.createEntry(env.input, engineCtx);
  ctx.profileSiren = siren;
  ctx.fingerprint = fingerprintOf(result?.invoice);
  return result;
}

function innerHandler(): RouteHandler {
  return async (req) => {
    const ctx = callContexts.get(req);
    if (!ctx) return errorResponse(new ApiError("INTERNAL", "Missing call context."));
    try {
      const result = await compute(ctx);
      ctx.result = result;
      return NextResponse.json(result, { status: 200 });
    } catch (e) {
      return errorResponse(toApiError(e), ctx.requestId);
    }
  };
}

// ---------------------------------------------------------------------------
// withX402 wrapper per (mode, endpoint, payTo), created lazily at first request
// so that `next build` never contacts the facilitator.
// ---------------------------------------------------------------------------

type Global = typeof globalThis & { __ajeanPaidHandlers?: Map<string, RouteHandler> };
function handlers(): Map<string, RouteHandler> {
  const g = globalThis as Global;
  return (g.__ajeanPaidHandlers ??= new Map());
}

function getX402Handler(endpoint: PaidEndpointId, mode: PaymentMode): RouteHandler | null {
  const payTo = getPayTo(mode);
  const cacheKey = `${mode}:${endpoint}:${payTo}`;
  let h = handlers().get(cacheKey);
  if (h) return h;
  const config = buildRouteConfig(endpoint, mode);
  if (!config) return null;
  h = withX402(innerHandler(), config, getResourceServer(mode)) as RouteHandler;
  handlers().set(cacheKey, h);
  return h;
}

/** Test helper. */
export function resetPaidRoutes(): void {
  handlers().clear();
}

// ---------------------------------------------------------------------------
// Response post-processing
// ---------------------------------------------------------------------------

export function copyHeaders(from: Headers): Headers {
  const h = new Headers(from);
  h.delete("content-length");
  h.delete("transfer-encoding");
  return h;
}

export function jsonResponse(body: unknown, status: number, headers: Headers, requestId: string): NextResponse {
  headers.set("Content-Type", "application/json");
  headers.set("X-Request-Id", requestId);
  return new NextResponse(JSON.stringify(body), { status, headers });
}

function replayBody(rec: ReceiptRecord) {
  return { request_id: rec.request_id, receipt: rec.receipt, ...(rec.result as object) };
}

async function finalizeSuccess(
  req: NextRequest,
  res: NextResponse,
  ctx: CallContext,
  mode: PaymentMode,
  idemKey: string | null,
  hash: string,
): Promise<NextResponse> {
  const header = res.headers.get(PAYMENT_RESPONSE_HEADER);
  if (!header) {
    // Should never happen on a paid route: refuse to hand out an unpaid result.
    return errorResponse(new ApiError("INTERNAL", "Settlement response missing. Not charged."), ctx.requestId);
  }
  const settle = decodePaymentResponseHeader(header);
  const receipt = buildReceipt({ endpoint: ctx.endpoint, settle, payTo: getPayTo(mode) ?? "", mode, assetAddress: paidAssetAddress(req.headers) });
  const record: ReceiptRecord = {
    request_id: ctx.requestId,
    endpoint: ctx.endpoint,
    idempotency_key: idemKey,
    request_hash: hash,
    receipt,
    result: ctx.result,
    payment_response: header,
    created_at: receipt.paid_at,
  };
  const store = getStore();
  try {
    await store.saveReceipt(record);
    if (ctx.fingerprint && ctx.profileSiren) await store.saveFingerprint(ctx.profileSiren, ctx.fingerprint);
  } catch (e) {
    console.error("[api] could not persist receipt:", e instanceof Error ? e.message : e);
  }
  return jsonResponse(replayBody(record), 200, copyHeaders(res.headers), ctx.requestId);
}

/** Normalises SDK-generated error bodies ({ error: "string" } or {}) into the API error envelope. */
export async function finalizeError(res: NextResponse, requestId: string): Promise<NextResponse> {
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("json")) {
    res.headers.set("X-Request-Id", requestId);
    return res; // e.g. the HTML paywall for browsers
  }
  let body: unknown = {};
  try {
    body = JSON.parse(await res.text());
  } catch {
    body = {};
  }
  const b = (body ?? {}) as { error?: unknown; request_id?: string };
  if (b.error && typeof b.error === "object") {
    return jsonResponse({ ...b, request_id: b.request_id ?? requestId }, res.status, copyHeaders(res.headers), requestId);
  }
  const reason = typeof b.error === "string" ? b.error : undefined;
  let out;
  if (res.status === 402) {
    let declared: string | undefined;
    const pr = res.headers.get(PAYMENT_REQUIRED_HEADER);
    if (pr) {
      try {
        declared = decodePaymentRequiredHeader(pr).error;
      } catch {
        /* ignore */
      }
    }
    out = pr
      ? errorBody("PAYMENT_INVALID", `Payment rejected: ${reason ?? declared ?? "invalid payment"}. Not charged.`, {
          reason: reason ?? declared ?? null,
        }, requestId)
      : errorBody("PAYMENT_SETTLEMENT_FAILED", "The payment could not be settled; the result is withheld.", { reason: reason ?? null }, requestId);
  } else if (res.status === 502) {
    out = errorBody("FACILITATOR_UNAVAILABLE", `x402 facilitator error: ${reason ?? "unavailable"}. Not charged.`, undefined, requestId);
  } else if (res.status === 403) {
    out = errorBody("FORBIDDEN", reason ?? "Forbidden.", undefined, requestId);
  } else {
    out = errorBody(res.status >= 500 ? "INTERNAL" : "INVALID_INPUT", reason ?? "Request failed. Not charged.", undefined, requestId);
  }
  return jsonResponse(out, res.status, copyHeaders(res.headers), requestId);
}

// ---------------------------------------------------------------------------
// Prepaid credits path (ADR-025)
// ---------------------------------------------------------------------------

/**
 * 402 for a credit call that cannot be paid with the token: the normal x402 challenge (PAYMENT-REQUIRED
 * header from withX402, so the agent can pay this call with x402 instead) + details.credits.
 */
async function creditsRefused(
  req: NextRequest,
  x402: RouteHandler,
  requestId: string,
  endpoint: PaidEndpointId,
  reason: CreditRefusal,
  balanceAtomic: string | null,
  expiresAt: string | null,
): Promise<NextResponse> {
  const headers = new Headers(req.headers);
  headers.delete(CREDIT_TOKEN_HEADER);
  headers.set("accept", "application/json");
  const unpaid = await x402(new NextRequest(req.url, { method: "POST", headers }));
  let details: Record<string, unknown> = {};
  try {
    const b = JSON.parse(await unpaid.text()) as { error?: { details?: Record<string, unknown> } };
    details = b.error?.details ?? {};
  } catch {
    /* keep empty */
  }
  const price = getPaidEndpoint(endpoint).price_atomic;
  const code = reason === "insufficient" ? "CREDITS_INSUFFICIENT" : "CREDIT_TOKEN_INVALID";
  const body = errorBody(
    code,
    `${CREDIT_REFUSAL_MESSAGES[reason]} Nothing was debited. Pay this call with x402 (PAYMENT-REQUIRED header) or buy a pack at POST ${CREDITS_PATH}.`,
    {
      ...details,
      credits: {
        reason,
        price_usdc: atomicToUsdc(price),
        price_atomic: price,
        balance_usdc: balanceAtomic !== null ? atomicToUsdc(balanceAtomic) : null,
        balance_atomic: balanceAtomic,
        expires_at: expiresAt,
        buy: `POST ${CREDITS_PATH} {"pack":"starter"|"pro"} (x402)`,
      },
    },
    requestId,
  );
  const out = jsonResponse(body, 402, copyHeaders(unpaid.headers), requestId);
  out.headers.set("Cache-Control", "private, no-store");
  return out;
}

async function payWithCredits(
  req: NextRequest,
  ctx: CallContext,
  x402: RouteHandler,
  mode: PaymentMode,
  rawToken: string,
  idemKey: string | null,
  hash: string,
): Promise<NextResponse> {
  const token = parseCreditToken(rawToken);
  if (!token) return creditsRefused(req, x402, ctx.requestId, ctx.endpoint, "unknown", null, null);
  const tokenHash = hashCreditToken(token);
  const price = getPaidEndpoint(ctx.endpoint).price_atomic;
  const store = getStore();
  const reserved = await reserveCredit(store, tokenHash, price, mode);
  if (!reserved.ok) {
    const showBalance = reserved.reason === "insufficient" || reserved.reason === "expired";
    return creditsRefused(
      req,
      x402,
      ctx.requestId,
      ctx.endpoint,
      reserved.reason,
      showBalance ? (reserved.account?.balance_atomic ?? null) : null,
      showBalance ? (reserved.account?.expires_at ?? null) : null,
    );
  }
  try {
    ctx.result = await compute(ctx);
  } catch (e) {
    await refundCredit(store, tokenHash, price).catch((err) => console.error("[api] credit refund failed:", err instanceof Error ? err.message : err));
    return errorResponse(toApiError(e), ctx.requestId);
  }
  const receipt = buildCreditReceipt({
    amountAtomic: price,
    remainingAtomic: reserved.remaining.toString(),
    tokenId: creditTokenId(tokenHash),
    payTo: getPayTo(mode) ?? "",
    mode,
  });
  const record: ReceiptRecord = {
    request_id: ctx.requestId,
    endpoint: ctx.endpoint,
    idempotency_key: idemKey,
    request_hash: hash,
    receipt,
    result: ctx.result,
    payment_response: null,
    created_at: receipt.paid_at,
  };
  try {
    await store.saveReceipt(record);
    if (ctx.fingerprint && ctx.profileSiren) await store.saveFingerprint(ctx.profileSiren, ctx.fingerprint);
  } catch (e) {
    console.error("[api] could not persist receipt:", e instanceof Error ? e.message : e);
  }
  const headers = new Headers({ "Cache-Control": "private, no-store", [CREDIT_BALANCE_HEADER]: receipt.remaining_balance ?? "" });
  return jsonResponse(replayBody(record), 200, headers, ctx.requestId);
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

export function paidRoute(endpoint: PaidEndpointId): (req: NextRequest) => Promise<NextResponse> {
  // Fail fast on a typo at module load.
  getPaidEndpoint(endpoint);

  return async function paidHandler(req: NextRequest): Promise<NextResponse> {
    const requestId = newRequestId();
    let heldKey: string | null = null;
    try {
      const wait = checkRateLimit(clientKey(req.headers));
      if (wait !== null) {
        throw new ApiError("RATE_LIMITED", `Too many requests. Retry in ${wait}s.`, {
          headers: { "Retry-After": String(wait) },
          details: { retry_after_seconds: wait },
        });
      }
      const declaredLen = Number(req.headers.get("content-length") ?? "0");
      if (declaredLen > MAX_BODY_BYTES) {
        throw new ApiError("PAYLOAD_TOO_LARGE", `Request body exceeds ${MAX_BODY_BYTES} bytes.`);
      }
      const idemKey = readIdempotencyKey(req.headers);

      const raw = await req.clone().text();
      if (raw.length > MAX_BODY_BYTES) throw new ApiError("PAYLOAD_TOO_LARGE", `Request body exceeds ${MAX_BODY_BYTES} bytes.`);
      let body: unknown;
      let parseError: ApiError | null = null;
      try {
        body = JSON.parse(raw);
      } catch {
        parseError = new ApiError("INVALID_JSON", "Request body is not valid JSON (send Content-Type: application/json).");
      }
      const hash = requestHash(endpoint, body, raw);

      // Idempotency short-circuit BEFORE any payment verification.
      if (idemKey) {
        const existing = await getStore().getByIdempotencyKey(idemKey);
        if (existing) {
          if (existing.request_hash !== hash) {
            throw new ApiError("IDEMPOTENCY_CONFLICT", "This Idempotency-Key was already used with a different request (body or endpoint).", {
              details: { original_request_id: existing.request_id, original_endpoint: existing.endpoint },
            });
          }
          const headers = new Headers({
            "Content-Type": "application/json",
            "Cache-Control": "private, no-store",
            [IDEMPOTENT_REPLAY_HEADER]: "true",
            "X-Request-Id": existing.request_id,
          });
          if (existing.payment_response) headers.set(PAYMENT_RESPONSE_HEADER, existing.payment_response);
          return new NextResponse(JSON.stringify(replayBody(existing)), { status: 200, headers });
        }
        if (!acquireKey(idemKey)) {
          throw new ApiError("IDEMPOTENCY_IN_PROGRESS", "A request with this Idempotency-Key is already in progress. Retry shortly.", {
            headers: { "Retry-After": "2" },
          });
        }
        heldKey = idemKey;
      }

      const mode = getPaymentMode();
      const x402 = getX402Handler(endpoint, mode);
      if (!x402) {
        throw new ApiError("SERVICE_MISCONFIGURED", "SERVICE_PAY_TO_ADDRESS is not configured for testnet mode. Not charged.");
      }
      const ctx: CallContext = { requestId, endpoint, body, parseError };
      const creditToken = req.headers.get(CREDIT_TOKEN_HEADER);
      if (creditToken !== null && !req.headers.has(PAYMENT_SIGNATURE_HEADER) && !req.headers.has("X-PAYMENT")) {
        return await payWithCredits(req, ctx, x402, mode, creditToken, idemKey, hash);
      }
      callContexts.set(req, ctx);
      const res = await x402(req);
      if (res.status === 200 && ctx.result !== undefined) return await finalizeSuccess(req, res, ctx, mode, idemKey, hash);
      if (res.status >= 400) return await finalizeError(res, requestId);
      res.headers.set("X-Request-Id", requestId);
      return res;
    } catch (e) {
      return errorResponse(toApiError(e), requestId);
    } finally {
      if (heldKey) releaseKey(heldKey);
    }
  };
}
