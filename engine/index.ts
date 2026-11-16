/**
 * Ajean Ledger — accounting engine public API (framework-free).
 * Rules first, LLM second: structured inputs (JSON, Factur-X, UBL, bank
 * transactions) are processed deterministically; the optional LLM layer is
 * only used for unstructured documents and ambiguous classifications.
 */
export * from "./types";
export { createEntry, checkInvoice, parseInput, ENGINE_VERSION, type ParsedInput } from "./core";
export { auditEntries, MAX_AUDIT_ITEMS, DEFAULT_MATERIALITY } from "./audit";
export { fingerprint } from "./rules/duplicates";
export { DEMO_PROFILE } from "./profile";
export { EngineError, ENGINE_ERROR_CODES, isEngineError, type EngineErrorCode } from "./errors";
export { EXPENSE_CATEGORIES, CATEGORY_IDS, classifyLine, type ExpenseCategory } from "./rules/pcg";
export { LEGAL_BASES, getLegalBasis, publicLegalBasis, type LegalBasis } from "./rules/legal-basis";
export { createAnthropicAdapter } from "./llm/anthropic";
