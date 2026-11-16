/**
 * Machine-readable engine errors. The API layer maps `code` to an HTTP status
 * (INVALID_INPUT / UNSUPPORTED_FORMAT / BATCH_TOO_LARGE -> 400 or 422,
 * LLM_UNAVAILABLE -> 422/503).
 */

export const ENGINE_ERROR_CODES = [
  "INVALID_INPUT",
  "UNSUPPORTED_FORMAT",
  "INVALID_PDF",
  "FACTURX_XML_NOT_FOUND",
  "INVALID_XML",
  "LLM_UNAVAILABLE",
  "LLM_OUTPUT_INVALID",
  "BATCH_TOO_LARGE",
  "EMPTY_BATCH",
] as const;

export type EngineErrorCode = (typeof ENGINE_ERROR_CODES)[number];

export class EngineError extends Error {
  readonly code: EngineErrorCode;
  readonly details?: unknown;

  constructor(code: EngineErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "EngineError";
    this.code = code;
    this.details = details;
  }

  toJSON(): { code: EngineErrorCode; message: string; details?: unknown } {
    return { code: this.code, message: this.message, ...(this.details !== undefined ? { details: this.details } : {}) };
  }
}

export function isEngineError(e: unknown): e is EngineError {
  return e instanceof EngineError;
}
