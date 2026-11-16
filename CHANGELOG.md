# Changelog

One line per meaningful change. Newest last.

- 2026-11-16 — Phase 0: repo initialised, master prompt saved verbatim, docs skeleton (prompt log, decisions, brief compliance), `.env.example`, `.gitignore`.
- 2026-11-16 — Phase 0: Next.js 16 + x402 v2 (`@x402/*` 2.31.0) scaffold, shared engine contract types, throwaway testnet wallet generator (`scripts/gen-wallets.ts`), prompt #02 decisions (ADR-009..016).
- 2026-11-16 — Phase 0: shared `AgentTrace` format (`lib/trace/types.ts`) used by the agent, the console and the replays.
- 2026-11-16 — Phase 7 (early drafts): concept note, demo script, slides outline and Q&A prep in `deliverables/`.
- 2026-11-16 — Phase 2: paid API with x402 v2 — `withX402` routes for `/entry`, `/invoice/check`, `/audit`, pricing from one config file, simulated facilitator, receipts + idempotency, optional stores (Neon / Upstash / file / memory) with memory fallback.
- 2026-11-16 — Phase 1: accounting engine — PCG mapping, VAT rates and regimes, e-invoicing mandatory mentions, entry builder, anomalies (duplicates, VAT rate mismatch, fixed assets), Factur-X / UBL / bank parsers, audit viewpoints, optional LLM extraction, 13 fixtures with tests, `npm run engine`.
- 2026-11-16 — Hosting: Vercel abandoned (account paused); Cloudflare Workers via OpenNext chosen, Netlify as fallback (ADR-017).
- 2026-11-16 — Phase 3: discovery layer — `/api/v1/catalog`, `/openapi.json`, `/llms.txt`, `/.well-known/agent.json`, remote MCP server `/mcp` and a stdio MCP bridge with spending policy for Claude Desktop.
- 2026-11-16 — Phase 4: demo purchasing agent (`npm run agent`) — inbox, catalog discovery, spending policy, x402 payment, mock ERP, human-review flags, optional Claude tool use; `npm run record:replays`.
- 2026-11-16 — Phase 5: demo console — `/` landing, `/live` agent console with REPLAY fallback ladder, `/operator` dashboard, `/office`; `/api/demo/run` and `/api/demo/replays`.
- 2026-11-16 — Hosting: Cloudflare Workers build (`npm run cf:build`, paywall dropped, secret scan), free KV namespace `AJEAN_KV`, `npm run warmup`.
- 2026-11-16 — Hosting: deployed to https://ajean-ledger.ary-sidoun.workers.dev with static assets embedded in the Worker (`npm run cf:deploy:embedded`, ADR-020).
- 2026-11-16 — Phase 1 review fixes: fixture 03 deducts only the VAT legally due (ADR-018), synthetic 000… SIRENs and renamed fictional parties (ADR-021), no article numbers in hints (broader leak tests), reform-mention timeline by supplier size (ADR-019), minor PCG/VAT fixes, simulated facilitator caches verified signatures, replays re-recorded.
- 2026-11-16 — Phase 6: README rewritten as a front page (3-command quickstart, "try it as an agent", architecture, payment modes, Cloudflare hosting, repo map); stale Vercel references removed outside the ADR history.
- 2026-11-16 — Phase 6: `pay:simulated` uses an ephemeral wallet (with a note) when `AGENT_PRIVATE_KEY` is missing; `pay:testnet -- --check-balance`; CLI-only inbox loader no longer makes `next build` trace the whole project; vitest config warning fixed.
- 2026-11-16 — Phase 6: rate limiter keys on `CF-Connecting-IP`, separate per-IP limit for `/api/demo/run` (30/min, 429 + `Retry-After`), limits published in the catalog and `llms.txt`.
- 2026-11-16 — Phase 6: `/live` explains TESTNET / SIMULATED / REPLAY (badge tooltip; clicking the badge opens a legend of the three modes) and selects the deployment's real payment mode from `/api/health`.
- 2026-11-16 — Phase 6: tests for the fallbacks (live 5xx / agent error / 429 → REPLAY, failing store → memory with a paid 200, rate limits per IP); replay test valid for both simulated and testnet recordings.
- 2026-11-16 — Phase 6: `npm run warmup` defaults to the public URL, checks the demo run and its replay, `--expect-mode`, final READY FOR DEMO / NOT READY banner; `record:replays -- --public` records against the public deployment; testnet go-live sequence in `docs/HOSTING.md` §7; `DEMO_SCRIPT.md` filled with the real URL, policy and fallback ladder.
- 2026-11-16 — Phase 6: fresh-clone run-through (`npm ci`, tests, typecheck, build, start, agent, pay, warmup, MCP check) green without any `.env`.
- 2026-11-16 — Phase 5 review fixes: `/live` scenario 90 shows the spending-policy refusal (1.00 USDC audit > 0.20, no payment, replay `demo/replays/90.json`); replays recorded from a fresh ledger per scenario; total excess VAT (14.60) in the bookkeeper message; VAT panel reads what was booked; "Invoice mentions: compliant" chip + separate VAT-anomaly chip (ADR-023); no "incl. VAT" on VAT-free invoices; exact review KPI on `/operator`; QA_PREP legal-review and retention wording fixed.
