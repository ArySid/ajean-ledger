/**
 * Error catalogue for the discovery files: API codes (lib/api/errors.ts) + engine codes passed
 * through by the API (ENGINE_CODE_STATUS). Single list used by catalog, openapi.json and llms.txt.
 */
import { ENGINE_CODE_STATUS, ERROR_DESCRIPTIONS, ERROR_STATUS } from "@/lib/api/errors";

/** Same value as MAX_BODY_BYTES in lib/api/paid-route.ts (not imported to keep @x402/next out of discovery bundles). */
export const MAX_BODY_BYTES = 5_000_000;

/** Codes the engine can raise that have no entry in ERROR_DESCRIPTIONS. */
const EXTRA_DESCRIPTIONS: Record<string, string> = {
  EMPTY_BATCH: "Audit batch is empty. Not charged.",
  INVALID_PDF: "document_base64 is not a readable PDF. Not charged.",
  INVALID_XML: "The UBL / CII XML could not be parsed. Not charged.",
  FACTURX_XML_NOT_FOUND: "The PDF has no embedded Factur-X / ZUGFeRD XML. Send it as format pdf (LLM extraction) or send structured JSON. Not charged.",
  LLM_OUTPUT_INVALID: "The LLM extraction of a pdf/image did not produce a valid invoice. Not charged.",
  FORBIDDEN: "The payment SDK refused the request. Not charged.",
};

export interface ErrorCodeInfo {
  code: string;
  status: number;
  description: string;
}

export function allErrorCodes(): ErrorCodeInfo[] {
  const out = new Map<string, ErrorCodeInfo>();
  for (const [code, status] of Object.entries(ERROR_STATUS)) {
    out.set(code, { code, status, description: ERROR_DESCRIPTIONS[code as keyof typeof ERROR_DESCRIPTIONS] });
  }
  for (const [code, status] of Object.entries(ENGINE_CODE_STATUS)) {
    if (!out.has(code)) out.set(code, { code, status, description: EXTRA_DESCRIPTIONS[code] ?? "Engine error. Not charged." });
  }
  if (!out.has("FORBIDDEN")) out.set("FORBIDDEN", { code: "FORBIDDEN", status: 403, description: EXTRA_DESCRIPTIONS.FORBIDDEN });
  return [...out.values()].sort((a, b) => a.status - b.status || a.code.localeCompare(b.code));
}
