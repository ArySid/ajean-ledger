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
- **Status:** accepted (team validation, prompt #02)
- **Decision:** Next.js 16 App Router + TypeScript, deployed on Vercel. The accounting engine lives in `/engine` as pure TypeScript with zero Next.js imports, so the API routes, the MCP server, the CLI (`npm run engine`) and the demo agent all call the same functions. Tests with Vitest.
- **Why:** One deployable, one URL for the jury, one language end to end (§3).
- **Rejected:** Separate backend (Express/Hono) + frontend (two deployments for no gain); Python engine (breaks "TypeScript end to end").

## ADR-004 — Receipts, idempotency and operator stats storage
- **Status:** superseded by ADR-010 (no Supabase)
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

## ADR-008 — Accounting defaults
- **Status:** accepted (prompt #02). Legal citations remain gated by `docs/LEGAL_REVIEW.md`.
- Low-value fixed-asset threshold: **€500 excl. VAT** (French administrative tolerance). Above it, IT equipment → `2183` + VAT on fixed assets `44562`; below → expense `6063`/`6064`.
- Supplier accounts: general account `401` + auxiliary code, e.g. `401BURO` (shown as `401XXXX` in §5.4).
- Purchase journal code `HA`; bank journal `BQ`.
- Restaurant: on-site meals are 10%, alcohol 20%. A restaurant invoice at 20% on food → `VAT_RATE_MISMATCH` warning + `human_review_required: true`. The engine **never** silently corrects the VAT amount: it books what was invoiced and flags it.
- Legal bases: only from a curated table in `engine/rules/legal-basis.ts`, each entry with `id`, `label`, `reference` and a `reviewed_by` field (empty until Ary signs it off). No article number is shown to an agent until it is reviewed.

---

## ADR-009 — GitHub repository: user creates it once, then push after every step
- **Status:** accepted (workaround)
- **Context:** Prompt #02 asks for a new private repo `ajean-ledger` on the user's account. The account was identified as `ArySid` (`gh api user`). This cloud session's GitHub credential is scoped to configured repositories only: the repo-creation API path is blocked (HTTP 403) and `add_repo` cannot attach a repo that does not exist.
- **Decision:** The user creates the empty private repo `ArySid/ajean-ledger` once (Action required). The session then attaches it with push access and pushes the full local history; every later step is pushed. Until then, commits are kept locally.
- **Rejected:** Pushing to another existing repo (forbidden: never touch existing assets).
- **Outcome (2026-11-16):** the user created `ArySid/ajean-ledger`; it was attached with push access and the local history was pushed to `main`.

## ADR-010 — Storage: optional, Neon → Upstash → memory (no Supabase)
- **Status:** accepted (prompt #02)
- **Decision:** `lib/store` exposes one `Store` interface with adapters `neon` (`DATABASE_URL`/`POSTGRES_URL`, table `ajean_receipts` created on first use), `upstash` (REST URL/token), `file` (local dev) and `memory`. Any store error falls back to memory, so the API and demo keep working; `/operator` falls back to recorded replays. Nothing is created on Supabase.
- **Note:** The Neon marketplace integration (free plan) is already installed on the Vercel team, but the Vercel MCP exposes no "create integration resource" call, so the database is attached from the Vercel dashboard (Storage → Neon) once the project exists.

## ADR-011 — Vercel: team blocked for fair-use → deployment pending, fallbacks prepared
- **Status:** accepted (workaround)
- **Context:** Creating project `ajean-ledger` on team "arysidoun-5003's projects" (Hobby) returned `402 resource_creation_blocked: Your Team exceeded our fair use limits and has been blocked`. Changing plan/billing is out of bounds (free tiers only) and existing projects (e.g. `ajeanai`) must not be touched.
- **Decision:** Keep building and verifying locally (all flows run from this container: x402.org facilitator and Base Sepolia RPC are reachable). Ask the user to check the block in the Vercel dashboard (Usage). As a guaranteed fallback for the shareable link, the demo console is designed to also run as a static page in **REPLAY / SIMULATED** mode (engine is pure TypeScript and can run in the browser), clearly labelled.
- **Rejected:** Upgrading the Vercel plan (paid); deploying under another account without the user.

## ADR-012 — Throwaway testnet wallets
- **Status:** accepted
- **Decision:** `scripts/gen-wallets.ts` generates two Base Sepolia wallets (service `payTo`, demo agent) into `.env.local` (gitignored, mode 600); keys are never printed. Public addresses: service `0xCB4b84079B1dd19828c3d5733f9e0D2DcB26dFeC`, agent `0xD25Eb53E57bCF0DE8785d9a0D0722CC98BB0c1BF`. The agent needs only test USDC (ADR-007). If the container is recycled before keys are stored in Vercel env vars, new wallets are generated (only faucet funds are lost).

## ADR-013 — Anthropic key optional; scripted mode first
- **Status:** accepted (prompt #02)
- **Decision:** Everything is built and tested without an LLM (structured inputs, scripted demo agent). The key is requested once via the secure form; when present, `createAnthropicAdapter()` enables LLM extraction/classification and the agent's LLM reasoning. Default model `claude-sonnet-5-5` (env `ANTHROPIC_MODEL`).
- **Outcome:** the session's secure credential form refuses Anthropic hosts (they are authenticated by the session itself), so the key cannot be collected that way. The key is therefore added by the user directly as the `ANTHROPIC_API_KEY` environment variable of the Vercel project (sensitive). Until then the deployed service runs in scripted / rules-only mode, which is the designed default.

## ADR-014 — Fixture 9: the lawyer is the BNC client whose books we keep
- **Status:** accepted (prompt #02)
- **Decision:** Client profile `activity: "bnc"`, `accounting_basis: "cash"`. The engine proposes the entry but returns `human_review_required: true` (reason `CASH_BASIS_CLIENT`), since a recettes-dépenses ledger records it at payment date.

## ADR-015 — Fictional demo SME and language
- **Status:** accepted (prompt #02)
- **Decision:** Demo client "Atelier Lumenor SAS (fictional)", fictional SIREN. Course deliverables (concept note, slides, demo script, Q&A) in English. Bonuses (credit packs, EURC) only after Phases 1–7 are complete and verified.

## ADR-016 — Autonomous orchestrator mode
- **Status:** accepted (prompt #02)
- **Decision:** No more stops between phases. Independent workstreams are delegated to subagents with explicit file ownership (engine / payments-API / deliverables first; then discovery+MCP, demo agent, console). Independent reviewer subagents (that did not write the code) after Phases 1, 5 and 7 check accounting correctness of the 12 fixtures, brief compliance and an error-free demo from the public URL. User reports in French, ≤ 15 lines; technical detail stays in `docs/`.

## ADR-017 — Hosting: Cloudflare Workers (OpenNext), Netlify as fallback — Vercel abandoned
- **Status:** accepted (prompt #04) — supersedes the Vercel part of ADR-003 and ADR-011
- **Context:** The user's Vercel account is paused until 2026-12-12 (Fast Origin Transfer overage). No Vercel deployment, repo import or Marketplace integration may be used, and no existing Vercel project may be touched.
- **Decision:** Host on a free plan, tested in order, keeping the first one that runs the full demo without errors from a public URL: (1) **Cloudflare Workers** via `@opennextjs/cloudflare` (free plan: 100,000 requests/day, 10 ms CPU per request, worker size limit); (2) **Netlify** free plan. Storage: the host's native free option (Cloudflare KV/D1), else Neon free directly; never Supabase; storage remains optional (memory + replay fallback).
- **Mitigations for the free limits:** heavy steps that could exceed 10 ms CPU (Factur-X PDF parsing, large audits) are measured; if needed they move client-side or the demo uses precomputed results, clearly labelled. Details and measurements: `docs/HOSTING.md`.
- **Pitch argument (if Cloudflare is kept):** x402 was co-created by Coinbase and Cloudflare, so hosting the agent-payment service on Cloudflare is coherent with the protocol's ecosystem.
- **Rejected:** Vercel (paused, forbidden by the user); paid plans of any host.

## ADR-020 — Cloudflare retained; static assets embedded in the Worker for deploys from the cloud session
- **Status:** accepted
- **Outcome of ADR-017:** Cloudflare Workers (free plan) is **retained**: the full demo passes from the public URL `https://ajean-ledger.ary-sidoun.workers.dev` (warmup 15/15 green: pages, discovery files, 402 on the three paid endpoints, paid `/entry` 200 + receipt, receipts lookup, `/api/demo/run`, KV-backed operator stats). Netlify was not needed.
- **Context:** `wrangler deploy` uploads Workers static assets with a short-lived JWT in the `Authorization` header. This session's egress proxy injects the stored Cloudflare API token into every request to `api.cloudflare.com`, overwriting that JWT → `401 Unauthorized` on `/workers/assets/upload`.
- **Decision:** `scripts/cf-embed-assets.mjs` embeds `.open-next/assets` (~1.1 MiB, 22 files) into the Worker bundle and generates `.open-next/entry.mjs`, which serves them and passes an `ASSETS`-compatible shim to the OpenNext worker. Deploy with `npm run cf:deploy:embedded` (`wrangler.embedded.jsonc`, same name/vars/KV as `wrangler.jsonc`). From a normal terminal, the standard `npm run cf:deploy` (Workers Assets) also works.
- **Free-plan impact:** bundle 12.6 MiB raw / 2.8 MiB gzip (limit 64 MiB uncompressed on Workers Free per current docs; also under the historical 3 MiB gzip limit), startup 14 ms. Static files are served by the Worker, so each page view costs a few extra requests out of the 100,000/day: negligible for a demo.
- **Secrets:** `SERVICE_PAY_TO_ADDRESS` and `AGENT_PRIVATE_KEY` are set with `wrangler secret put` (piped from `.env.local`, never printed). Storage: free KV namespace `AJEAN_KV` bound.
- **Rejected:** asking the user to deploy from their own machine (slower loop); Netlify (not needed); Cloudflare Workers Builds via the GitHub integration (needs a dashboard step from the user; possible later for automatic deploys on push).
