# Brief Compliance Checklist

Living map from each course-brief requirement and grading criterion (master prompt §1) to concrete evidence.
Legend: ✅ done · 🟡 in progress / partial · ⬜ not started.
**Last updated:** 2026-11-16, end of Phase 0.

## A. Core challenge requirements

| # | Requirement (brief) | Status | Evidence (file / endpoint / screen / demo step) | Phase |
|---|---|---|---|---|
| A1 | Original business idea | 🟡 | Product definition in `docs/prompts/00_MASTER_PROMPT.md` §0; concept note to come in `deliverables/CONCEPT_NOTE.md` | 0 / 7 |
| A2 | Application **specifically designed for AI agents** (agents are the direct users) | ⬜ | JSON-only API, discovery files, MCP server | 2–3 |
| A3 | **Not** a human app with a chatbot attached | ⬜ | No human UI in the product path; the console only *observes* agent traffic (`/live`) | 5 |
| A4 | Show **what an agent requests and what it receives** | ⬜ | `/live` raw HTTP timeline (request → 402 → payment → 200); `npm run agent` log | 4–5 |
| A5 | Payments in **crypto / stablecoins** | 🟡 | x402 v2 + USDC on Base Sepolia chosen (`docs/DECISIONS.md` ADR-002, ADR-005, ADR-007) | 2 |

## B. PoC deliverable

| # | Requirement | Status | Evidence | Phase |
|---|---|---|---|---|
| B1 | Representative agent request | ⬜ | Demo agent processing `inbox/` invoices | 4 |
| B2 | Service's key function | ⬜ | `/engine` + `POST /api/v1/entry` on 12 fixtures | 1–2 |
| B3 | Result returned to the agent | ⬜ | Response contract §5.4, JSON schema | 1–2 |
| B4 | Simulated data / interactions clearly defined | 🟡 | Synthetic-only rule (§4); fixtures 01–12 to come; SIMULATED / REPLAY labels | 1, 5 |
| B5 | Shareable link to prototype UI | ⬜ | Vercel public URL | 5 |
| B6 | Step-by-step demo sequence | ⬜ | `deliverables/DEMO_SCRIPT.md` | 7 |
| B7 | **Prompts used to build the prototype** | 🟡 | `docs/prompts/00_MASTER_PROMPT.md`, `docs/prompts/PROMPT_LOG.md` (#01); final export `PROMPTS_SUBMISSION.md` | 0 → 7 |

## C. Other deliverables

| # | Requirement | Status | Evidence | Phase |
|---|---|---|---|---|
| C1 | Concept note ≤ 2 pages, brief structure | ⬜ | `deliverables/CONCEPT_NOTE.md` | 7 |
| C2 | Presentation 8–10 min, 6–8 slides | ⬜ | `deliverables/SLIDES_OUTLINE.md` | 7 |
| C3 | 2–3 min live demo that cannot fail | ⬜ | Testnet / simulated / replay modes (ADR-005); `DEMO_SCRIPT.md` fallbacks | 2, 5, 6 |
| C4 | Q&A preparation | ⬜ | `deliverables/QA_PREP.md` | 7 |

## D. Grading criteria

| Criterion | Weight | Status | Evidence so far |
|---|---|---|---|
| Economic relevance & innovation | 30% | 🟡 | Problem framing (e-invoicing reform 2026/2027, agent bookkeeping errors) in master prompt §0; to be argued in concept note |
| Fit for AI-agent use | 25% | 🟡 | Design choices logged: payment = authentication (x402, ADR-002), no sign-up, discovery files + MCP planned |
| Quality of the PoC | 20% | ⬜ | — |
| Commercial potential | 15% | 🟡 | Per-call pricing table (§5.2): 0.05 / 0.15 / 1.00 USDC |
| Final presentation | 10% | ⬜ | — |

## E. Traceability & safety rules (§2, §4)

| Rule | Status | Evidence |
|---|---|---|
| Master prompt saved verbatim | ✅ | `docs/prompts/00_MASTER_PROMPT.md` |
| Prompt log entry per message | ✅ | `docs/prompts/PROMPT_LOG.md` (#01) |
| Decisions log | ✅ | `docs/DECISIONS.md` (ADR-001 → ADR-008) |
| Changelog | ✅ | `CHANGELOG.md` |
| Git, one commit per step | ✅ | `git log` |
| Testnet only, no secrets committed | ✅ | `.gitignore` ignores `.env*` except `.env.example` |
| Synthetic data only, PoC disclaimer | 🟡 | `README.md` disclaimer; to be enforced in fixtures and API responses |
