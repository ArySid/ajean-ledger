# engine/

Framework-free accounting engine. Public API in `engine/index.ts`:
`createEntry(input, ctx)`, `checkInvoice(input, ctx)`, `auditEntries(items, ctx)`.
Contract types in `engine/types.ts` (do not change field names without updating all consumers).
