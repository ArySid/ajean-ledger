/**
 * Machine-readable API errors: `{ error: { code, message, details?, docs_url }, request_id? }`.
 * Every error status is >= 400, so `withX402` never settles the payment: an agent
 * is never charged for a failed call.
 */
import { NextResponse } from "next/server";

export const DOCS_BASE_URL = "/llms.txt#errors";

export const ERROR_STATUS = {
  INVALID_JSON: 400,
  INVALID_INPUT: 400,
  BATCH_TOO_LARGE: 400,
  INVALID_IDEMPOTENCY_KEY: 400,
  INVALID_RECEIPT_ID: 400,
  INVALID_CREDIT_PACK: 400,
  PAYMENT_REQUIRED: 402,
  PAYMENT_INVALID: 402,
  PAYMENT_SETTLEMENT_FAILED: 402,
  CREDITS_INSUFFICIENT: 402,
  CREDIT_TOKEN_INVALID: 402,
  NOT_FOUND: 404,
  IDEMPOTENCY_CONFLICT: 409,
  IDEMPOTENCY_IN_PROGRESS: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_FORMAT: 415,
  UNPROCESSABLE: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  FACILITATOR_UNAVAILABLE: 502,
  LLM_UNAVAILABLE: 503,
  ENGINE_UNAVAILABLE: 503,
  SERVICE_MISCONFIGURED: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

/** Human/agent-readable meaning of each code (for catalog / openapi / llms.txt). */
export const ERROR_DESCRIPTIONS: Record<ErrorCode, string> = {
  INVALID_JSON: "Request body is not valid JSON. Not charged.",
  INVALID_INPUT: "Body does not match the request envelope or the invoice schema. Not charged.",
  BATCH_TOO_LARGE: "Audit batch has more than 50 items. Not charged.",
  INVALID_IDEMPOTENCY_KEY: "Idempotency-Key header is empty or longer than 128 characters.",
  INVALID_RECEIPT_ID: "Receipt id is not a valid request_id (req_...).",
  INVALID_CREDIT_PACK: 'POST /api/v1/credits: body.pack must be one of the credit pack ids of the catalog (e.g. "starter", "pro"). Not charged.',
  PAYMENT_REQUIRED: "No payment attached. Read the PAYMENT-REQUIRED header, pay, and retry with PAYMENT-SIGNATURE.",
  PAYMENT_INVALID: "The PAYMENT-SIGNATURE was rejected (bad signature, amount, recipient, expired or reused nonce). Not charged.",
  PAYMENT_SETTLEMENT_FAILED: "The result was computed but settlement failed; the result is withheld. Retry with a new payment.",
  CREDITS_INSUFFICIENT: "The X-Credit-Token balance is lower than the price of the call. Nothing was debited; pay this call with x402 (PAYMENT-REQUIRED header) or buy a new pack. details.credits has the balance.",
  CREDIT_TOKEN_INVALID: "The X-Credit-Token is malformed, unknown, expired or from another payment mode. Nothing was debited; pay with x402 (PAYMENT-REQUIRED header) or buy a pack.",
  NOT_FOUND: "Unknown resource (e.g. receipt id, credit token on GET /api/v1/credits/balance).",
  IDEMPOTENCY_CONFLICT: "This Idempotency-Key was already used with a different request body or endpoint.",
  IDEMPOTENCY_IN_PROGRESS: "A request with this Idempotency-Key is still being processed. Retry shortly.",
  PAYLOAD_TOO_LARGE: "Request body exceeds the size limit (5 MB). Not charged.",
  UNSUPPORTED_FORMAT: "input.format is not supported by this endpoint. Not charged.",
  UNPROCESSABLE: "The engine could not process the document. Not charged.",
  RATE_LIMITED: "Too many requests. Respect the Retry-After header.",
  INTERNAL: "Unexpected server error. Not charged.",
  FACILITATOR_UNAVAILABLE: "The x402 facilitator could not be reached. Not charged.",
  LLM_UNAVAILABLE: "Unstructured documents (pdf/image) need the LLM layer, which is not configured. Send structured JSON, Factur-X or UBL. Not charged.",
  ENGINE_UNAVAILABLE: "The accounting engine is not available in this deployment. Not charged.",
  SERVICE_MISCONFIGURED: "The service payment configuration is incomplete (payTo address). Not charged.",
};

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown; docs_url: string };
  request_id?: string;
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;
  readonly headers?: Record<string, string>;

  constructor(code: ErrorCode | string, message: string, opts: { status?: number; details?: unknown; headers?: Record<string, string> } = {}) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = opts.status ?? (ERROR_STATUS as Record<string, number>)[code] ?? 400;
    this.details = opts.details;
    this.headers = opts.headers;
  }
}

export function errorBody(code: string, message: string, details?: unknown, requestId?: string): ApiErrorBody {
  return {
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
      docs_url: DOCS_BASE_URL,
    },
    ...(requestId ? { request_id: requestId } : {}),
  };
}

export function errorResponse(err: ApiError, requestId?: string): NextResponse {
  const res = NextResponse.json(errorBody(err.code, err.message, err.details, requestId), { status: err.status });
  if (requestId) res.headers.set("X-Request-Id", requestId);
  for (const [k, v] of Object.entries(err.headers ?? {})) res.headers.set(k, v);
  return res;
}

/** Engine error codes → HTTP status. Unknown engine codes → 422 with the code passed through. */
export const ENGINE_CODE_STATUS: Record<string, number> = {
  INVALID_INPUT: 400,
  INVALID_JSON: 400,
  BATCH_TOO_LARGE: 400,
  EMPTY_BATCH: 400,
  UNSUPPORTED_FORMAT: 415,
  INVALID_PDF: 422,
  INVALID_XML: 422,
  FACTURX_XML_NOT_FOUND: 422,
  LLM_OUTPUT_INVALID: 422,
  LLM_UNAVAILABLE: 503,
};

/** Duck-typed so it works whether or not the engine's EngineError class is loaded. */
export function isEngineError(e: unknown): e is { code: string; message: string; details?: unknown } {
  return (
    !!e &&
    typeof e === "object" &&
    typeof (e as { code?: unknown }).code === "string" &&
    typeof (e as { message?: unknown }).message === "string" &&
    ((e as { name?: unknown }).name === "EngineError" || (e as { code: string }).code in ENGINE_CODE_STATUS)
  );
}

export function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  if (isEngineError(e)) {
    return new ApiError(e.code, e.message, { status: ENGINE_CODE_STATUS[e.code] ?? 422, details: e.details });
  }
  console.error("[api] unexpected error:", e);
  return new ApiError("INTERNAL", "Internal error. The call was not charged.");
}
