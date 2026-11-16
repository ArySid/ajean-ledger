# Decisions (ADR log)

Format: **Context → Decision → Why → Alternatives rejected.** Status: `accepted`, `proposed` (awaiting team validation) or `needs-review` (accounting rule to be checked by Ary).

---

## ADR-001 — Prompt log entry #01 references the master prompt instead of duplicating it
- **Status:** accepted
- **Context:** §2 asks for every prompt verbatim in `PROMPT_LOG.md`. Prompt #01 is the ~400-line master prompt, which §2.1 also stores verbatim in `00_MASTER_PROMPT.md`.
- **Decision:** Entry #01 links to `00_MASTER_PROMPT.md` (the unabridged verbatim copy) and quotes only its closing instruction. All later prompts are copied in full in the log.
- **Why:** The same text twice makes the log hard to read for the jury. Nothing is lost, because the verbatim copy is one click away.
- **Rejected:** Duplicating the full text (noise); summarising it (breaks the "verbatim" rule).

## ADR-002 — x402 protocol v2 with the `@x402/*` packages, pinned to 2.31.0
- **Status:** accepted (versions checked on 2026-11-16)
- **Context:** §3 requires checking current official x402 docs before use. The x402 SDK has two generations on npm: legacy v1 (`x402`, `x402-next`, `x402-fetch` at 1.2.0, last updated April 2026) and v2 (`@x402/*`, 2.31.0, published 2026-11-12). GitHub API access to `coinbase/x402` was not enabled in this session, so the facts below come from the official published package tarballs (READMEs + compiled code).
- **Decision:** Use v2, pinned:
  | Package | Version | Role |
  |---|---|---|
  | `@x402/core` | 2.31.0 | protocol types, `HTTPFacilitatorClient`, `x402ResourceServer` |
  | `@x402/next` | 2.31.0 | `withX402()` route wrapper for Next.js API routes (peer: `next >= 16.4.1`, `@x402/paywall`) |
  | `@x402/evm` | 2.31.0 | `ExactEvmScheme` (server + client), EIP-3009 USDC transfers |
  | `@x402/fetch` | 2.31.0 | client: `wrapFetchWithPayment` for the demo agent |
  | `@x402/mcp` | 2.31.0 | `createPaymentWrapper` (server) / `createx402MCPClient` (client) |
  | `next` | 16.4.x | App Router |
  | `viem` | 2.x | wallets for the demo agent |
  | `@modelcontextprotocol/sdk` | 1.32.x | MCP server |
- **Protocol facts confirmed in the v2 code:**
  - Headers: `PAYMENT-REQUIRED` (server → client, on the 402), `PAYMENT-SIGNATURE` (client → server, the signed payment), `PAYMENT-RESPONSE` (server → client, settlement result incl. tx hash). Legacy v1 `X-PAYMENT` / `X-PAYMENT-RESPONSE` are still understood by the SDK.
  - Networks use CAIP-2 ids: Base Sepolia = `eip155:84532`.
  - Public testnet facilitator: `https://x402.org/facilitator` (no API key needed).
  - Test USDC on Base Sepolia: `0x036CbD53842c5426634e7929541eC2318f3dCF7e` (present in `@x402/evm`).
  - `withX402` settles the payment **only after a successful response (status < 400)**, so an agent is never charged for a failed call.
- **Why:** v2 is the maintained line, and has first-party Next.js and MCP integrations, which removes custom protocol code.
- **Rejected:** v1 packages (legacy, lagging); hand-rolled 402 logic (risk of spec drift, the brief says "follow the current spec exactly").

## ADR-003 — Stack: one Next.js 16 app + a framework-free engine package
- **Status:** proposed (awaiting validation)
- **Decision:** Next.js 16 App Router + TypeScript, deployed on Vercel. The accounting engine lives in `/engine` as pure TypeScript with zero Next.js imports, so the API routes, the MCP server, the CLI (`npm run engine`) and the demo agent all call the same functions. Tests with Vitest.
- **Why:** One deployable, one URL for the jury, one language end to end (§3).
- **Rejected:** Separate backend (Express/Hono) + frontend (two deployments for no gain); Python engine (breaks "TypeScript end to end").

## ADR-004 — Receipts, idempotency and operator stats storage
- **Status:** proposed — see blocking question Q2
- **Context:** Vercel serverless functions have no persistent filesystem and requests can hit different instances. `/api/v1/receipts/{id}`, idempotency keys and the `/operator` dashboard need shared state.
- **Decision (proposed):** A tiny `Store` interface with two adapters: `file` (local dev, `data/*.local.json`) and one hosted adapter for the public URL. Recommended hosted adapter: **one Supabase table** (`receipts`), because the Supabase connector is already available in this workspace.
- **Rejected:** In-memory only (receipts vanish between instances, so the idempotency demo is not credible); SQLite on Vercel (not persistent).

## ADR-005 — Payment modes implemented behind the same x402 server object
- **Status:** accepted
- **Decision:** `PAYMENT_MODE=testnet` registers the real `HTTPFacilitatorClient` (x402.org facilitator, Base Sepolia). `PAYMENT_MODE=simulated` registers a local mock facilitator (same interface: `verify` / `settle`) that returns a clearly fake tx hash (`0xSIMULATED…`). The wire format (402 body + headers) is identical in both modes. **Replay** is not a server mode: the demo console plays back recorded JSON traces from `demo/replays/` (recorded from real testnet runs).
- **Why:** The agent and the console code are the same in all modes, so the fallback cannot diverge from the real thing.

## ADR-006 — Receipt `network` field
- **Status:** accepted
- **Context:** §5.4 shows `"network": "base-sepolia"`; x402 v2 uses CAIP-2 (`eip155:84532`).
- **Decision:** The receipt carries both: `"network": "base-sepolia"` (human-readable, as in the spec) and `"network_caip2": "eip155:84532"` (protocol value), plus `"explorer_url"`.

## ADR-007 — Agent gas: USDC only
- **Status:** accepted
- **Context:** The x402 `exact` EVM scheme uses EIP-3009 `transferWithAuthorization`: the agent signs an off-chain authorisation and the facilitator submits the transaction and pays gas.
- **Decision:** The demo agent wallet needs **test USDC only** (Circle faucet), no Base Sepolia ETH. The service `payTo` wallet needs nothing; its private key is never needed by the server.

## ADR-008 — Accounting defaults (to confirm in Phase 1)
- **Status:** needs-review (Ary) — see blocking question Q5
- Low-value fixed-asset threshold: **€500 excl. VAT** (French administrative tolerance). Above it, IT equipment → `2183` + VAT on fixed assets `44562`; below → expense `6063`/`6064`.
- Supplier accounts: general account `401` + auxiliary code, e.g. `401BURO` (shown as `401XXXX` in §5.4).
- Purchase journal code `HA`; bank journal `BQ`.
- Restaurant: on-site meals are 10%, alcohol 20%. A restaurant invoice at 20% on food → `VAT_RATE_MISMATCH` warning + `human_review_required: true`. The engine **never** silently corrects the VAT amount: it books what was invoiced and flags it.
- Legal bases: only from a curated table in `engine/rules/legal-basis.ts`, each entry with `id`, `label`, `reference` and a `reviewed_by` field (empty until Ary signs it off). No article number is shown to an agent until it is reviewed.
