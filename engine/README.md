# engine/

Framework-free accounting engine. Public API in `engine/index.ts`:
`createEntry(input, ctx)`, `checkInvoice(input, ctx)`, `auditEntries(items, ctx)`, `parseInput`, `fingerprint`, `EngineError`, `DEMO_PROFILE`, `ENGINE_VERSION`.
Contract types in `engine/types.ts` (do not change field names without updating all consumers).

Layout: `core.ts` (pipeline), `audit.ts`, `entry.ts`, `money.ts`, `rules/` (pcg, vat, mentions, duplicates, legal-basis), `parsers/` (json, facturx, cii, ubl, bank), `llm/anthropic.ts`.
Full documentation: `docs/ENGINE.md`. Legal references to review: `docs/LEGAL_REVIEW.md`.
