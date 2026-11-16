# MASTER PROMPT: Ajean Ledger (AI Agent Economy Challenge)

> Paste everything below into a new Claude Code session, opened on an empty folder named `ajean-ledger`.
> Replace the `[PLACEHOLDERS]` first.

---

## 0. WHO YOU ARE AND WHAT WE ARE BUILDING

You are my senior full-stack engineer and product partner. You are also a French chartered accountant (expert-comptable) with solid PCG, VAT (CGI) and e-invoicing reform knowledge. We are building **Ajean Ledger**, a **real, working proof of concept** for a graded master's course: *Digital Transformation & FinTech – "The AI Agent Economy Challenge"* (team project, 50% of the course grade).

**One-sentence product definition:**
Ajean Ledger is an API that lets any AI agent send a French invoice or bank transaction and immediately get back a validated, machine-readable accounting entry (PCG accounts, VAT treatment, e-invoicing compliance status, anomaly flags). The agent pays per call in USDC stablecoin through the x402 HTTP payment protocol.

**Context:**
- Team: Ary SIDOUN, Victor BONNAPETIT, Yoann POMMEROLLE, Leo COUTURIER . Final presentation: Session 10
- Ajean is my existing AI-agent platform for SMEs and accounting firms. It has a 3D virtual office, an accounting-firm module and expert agents (accountant, statutory auditor, tax inspector). Ajean Ledger takes its "accounting brain" and turns it into a service **consumed by AI agents, not humans**.
- Why now: French e-invoicing reform. Reception of e-invoices has been mandatory for all companies since 1 Sept 2026, and SMEs must issue them from 1 Sept 2027. Agent-native stablecoin payments (x402) are now mature.

---

## 1. THE COURSE BRIEF (NON-NEGOTIABLE CONSTRAINTS)

Every decision must serve these requirements. Re-read this section before each phase.

**The challenge:** an original business idea plus a PoC for an application **specifically designed to serve AI agents (bots)**. AI agents, not humans, are the direct users. **Payments for the service must be made in cryptocurrencies, including stablecoins.**

**Hard rule from the brief:** it must NOT be "a conventional application for humans with a chatbot attached". We must **show what an AI agent requests and what it receives.**

**PoC scope (from the brief):** "Build just enough to make the idea tangible and operational for demonstration purposes. Demonstrate a representative request from an AI agent, the service's key function, and the result provided to the agent. Simulated data and agent interactions must be shown in a demo and clearly logically defined." A real API, MCP server and payment integration are *not required*. **We will build them anyway, in a simple and reliable way**, because a real working service is our differentiator. The demo must still never depend on a fragile live component (see §6, fallback mode).

**Final deliverables:**
1. **PoC**: a shareable link to the prototype UI, plus a logical, step-by-step demo sequence. **We must also submit the prompts used to develop the prototype** (see §2, mandatory).
2. **Concept note**: max 2 pages. Economic problem, AI-agent use case, innovative features, target customers, existing alternatives, revenue model, crypto/stablecoin revenue mechanism, simple pricing illustration (no detailed financial projections).
3. **Final presentation**: 8–10 min, including a 2–3 min live demo, 6–8 slides, then Q&A.

**Grading (optimise in this order):**
| Criterion | Weight | What it means for us |
|---|---|---|
| Economic relevance & innovation | 30% | Real pain (manual correction of agent bookkeeping errors, e-invoicing reform), original approach |
| Fit for AI-agent use | 25% | Machine-first: discovery files, JSON-only, HTTP 402 payments, no sign-up, no human UI in the product path |
| Quality of the PoC | 20% | Coherent, credible, demonstrable end to end |
| Commercial potential | 15% | Clear payer, plausible per-call pricing, business rationale |
| Final presentation | 10% | Clear pitch and a demo that cannot fail |

The brief states that originality, economic relevance, fit for agents and commercial potential count more than technical complexity. **Never over-engineer.** Choose the simplest thing that is real.

---

## 2. TRACEABILITY RULES (MANDATORY, FROM THE FIRST MINUTE)

The brief requires us to submit the prompts used to build the prototype. You must maintain these files throughout the session, **without being asked again**:

1. `docs/prompts/00_MASTER_PROMPT.md`: save this entire prompt **verbatim** as your very first action.
2. `docs/prompts/PROMPT_LOG.md`: append an entry for **every message I send you**:
   ```
   ## #NN — YYYY-MM-DD HH:MM — <short title>
   **Prompt (verbatim):**
   > <my exact message>
   **What was done:** <3–6 bullet summary>
   **Files touched:** <list>
   **Phase:** <phase number>
   ```
3. `docs/DECISIONS.md`: short ADR-style log of every technical or product decision (context → decision → why → alternatives rejected).
4. `docs/BRIEF_COMPLIANCE.md`: a living checklist mapping each requirement and grading criterion in §1 to concrete evidence (file, endpoint, screen, demo step). Update it at the end of each phase.
5. `CHANGELOG.md`: one line per meaningful change.
6. Git: init the repo, make one commit per completed step, and use clear messages (`feat(engine): ...`, `docs(prompts): ...`).

At the end of the project, generate `docs/prompts/PROMPTS_SUBMISSION.md`. It is a clean, chronological, presentable export of all prompts, with one line of context each, ready to hand in.

---

## 3. HOW WE WORK

- Work **phase by phase** (§7). At the end of each phase, stop and show me what works, how to test it in one command, and the updated `BRIEF_COMPLIANCE.md`. Then wait for my "go".
- Before Phase 1, ask me **all your blocking questions in one batch** (max 8). Otherwise make sensible defaults and log them in `DECISIONS.md`.
- Before using the x402 SDK, check its **current official docs** (x402.org and the coinbase/x402 GitHub repo). Package names, versions and header names change; do not rely on memory. Log the versions you used.
- If an `accounting` / `comptable` skill is available in your environment, use it as reference knowledge for PCG and VAT rules.
- Write code, comments and docs in English. API error messages and explanations are in English; accounting labels may stay in French (e.g. "TVA déductible sur ABS").
- Prefer TypeScript end to end.

---

## 4. SECURITY & SAFETY RULES

- **Testnet only** (Base Sepolia, test USDC). Never real funds, never mainnet.
- Never commit private keys or secrets. Use `.env.local`, ship `.env.example`, and add `.env*` to `.gitignore`.
- Generate dedicated **throwaway testnet wallets** (one for the service `payTo`, one for the demo agent). Tell me exactly which manual step I must do (e.g. get test USDC from the Circle faucet), and give me the link from the official docs.
- **No real client data**, ever. All invoices are synthetic, with fictional companies and fictional SIREN numbers that are clearly labelled as such.
- Clearly label the service as a PoC: "not a substitute for a chartered accountant's review". Ambiguous cases return `human_review_required: true`.

---

## 5. PRODUCT SPECIFICATION

### 5.1 Target users (who calls / who pays)
- **Caller:** autonomous AI agents (an SME purchasing/AP agent, an expense agent, an accounting firm's pre-bookkeeping agent, a general-purpose assistant acting for a freelancer).
- **Payer:** the agent's operator (SaaS publishers that embed agents, accounting firms, SMEs). The payment comes from the agent's wallet, under a spending policy set by its operator.

### 5.2 Endpoints and pricing

| Endpoint | Function | Price (USDC) |
|---|---|---|
| `GET /api/v1/catalog` | Free. Machine-readable service and pricing manifest | free |
| `GET /openapi.json` | Free. Full OpenAPI 3.1 spec | free |
| `GET /llms.txt` and `GET /.well-known/agent.json` | Free. Agent discovery files (what the service does, how to pay, examples) | free |
| `POST /api/v1/invoice/check` | E-invoice compliance check (mandatory mentions, format, VAT consistency) | 0.05 |
| `POST /api/v1/entry` | Full journal entry proposal + VAT treatment + compliance + anomalies | 0.15 |
| `POST /api/v1/audit` | Batch audit of up to 50 entries or a mini FEC extract (duplicates, VAT inconsistencies, suspicious accounts, statutory-auditor and tax-inspector viewpoints) | 1.00 |
| `GET /api/v1/receipts/{id}` | Free. Payment receipt + result retrieval (idempotency) | free |

Optional (only if time allows, Phase 6 bonus): prepaid credit packs (e.g. 10 USDC → 12 USDC of calls) to illustrate volume pricing in the concept note.

### 5.3 Input formats
- JSON structured invoice (our documented schema)
- Factur-X / ZUGFeRD PDF (extract the embedded CII XML)
- UBL 2.1 XML
- Bank transaction JSON (date, label, amount, counterparty, optional attachment)
- Plain PDF/image: best-effort LLM extraction, and the response must flag `extraction_method: "llm"` with a confidence score

### 5.4 Response contract (`POST /api/v1/entry`): design it carefully, it is the heart of the demo
```json
{
  "request_id": "req_...",
  "receipt": { "amount": "0.15", "asset": "USDC", "network": "base-sepolia", "tx_hash": "0x..." },
  "invoice": { "number": "...", "date": "...", "supplier": {...}, "customer": {...}, "totals": {...} },
  "compliance": {
    "status": "compliant | non_compliant | warning",
    "checks": [ { "rule_id": "FR-EINV-SIREN-BUYER", "label": "...", "passed": false, "severity": "error", "fix_hint": "..." } ]
  },
  "entry": {
    "journal": "HA",
    "lines": [
      { "account": "6064", "label": "Fournitures administratives", "debit": 100.00, "credit": 0 },
      { "account": "44566", "label": "TVA déductible sur ABS", "debit": 20.00, "credit": 0 },
      { "account": "401XXXX", "label": "Fournisseur ...", "debit": 0, "credit": 120.00 }
    ],
    "balanced": true
  },
  "vat": { "regime": "standard | reverse_charge_intra_eu | exempt | ...", "rate": 0.20, "deductible": true, "legal_basis_id": "..." },
  "anomalies": [ { "code": "DUPLICATE_SUSPECTED", "detail": "...", "severity": "warning" } ],
  "confidence": 0.94,
  "human_review_required": false,
  "explanation": "One short paragraph an agent can relay to its operator.",
  "engine": { "version": "0.x", "rules_applied": ["..."], "llm_used": false }
}
```
Rules: amounts are numbers with 2 decimals, debits always equal credits, and every rule is identified by a stable `rule_id`. **Never invent legal article numbers.** If you cite a legal basis, it must come from a curated rules table in the code that I can review.

### 5.5 Accounting engine design (rules first, LLM second)
- **Deterministic core** (`/engine`): PCG account mapping table (expense categories → accounts, e.g. 6064, 6226, 6251, 6256, 6257, 613x, 2183 for fixed assets above the low-value threshold); VAT rates (20 / 10 / 5.5 / 2.1 %); VAT regimes (standard, intra-EU reverse charge, exempt, out of scope); e-invoicing mandatory mentions, including the reform's new ones (buyer SIREN, delivery address if different, nature of the operation goods/services/mixed, option for VAT on debits) plus the classic ones (number, date, parties, VAT IDs, description, qty, unit price excl. VAT, VAT rate and amount, totals, payment terms, late-payment penalties, €40 fixed recovery indemnity in B2B); duplicate detection; balance checks.
- **LLM layer** (Anthropic API, model configurable in `.env`): only for (a) extracting data from unstructured documents and (b) classifying ambiguous expense descriptions into a category. The LLM never decides amounts or VAT on its own; the rules engine validates everything.
- `/audit` adds two "expert viewpoints" generated from the results: **statutory auditor** (materiality, anomalies) and **tax inspector** (deductibility risks, VAT). Both are structured JSON, not prose only.
- **Without an LLM key, the engine must still work** on structured inputs (JSON / Factur-X / UBL).

### 5.6 Test fixtures (synthetic, in `/fixtures`, each with an expected output and a unit test)
1. Compliant standard invoice, office supplies, 20%
2. Missing buyer SIREN → non_compliant
3. Restaurant invoice billed at 20% instead of 10% → VAT anomaly
4. Intra-EU service supplier → reverse charge (VAT due + deductible lines)
5. Exempt training invoice (VAT-exempt mention present)
6. Duplicate of invoice #1 → DUPLICATE_SUSPECTED
7. Credit note (avoir) → reversed entry
8. Laptop above the fixed-asset threshold → account 2183 + VAT on fixed assets account
9. Lawyer (BNC profession) client: legal fees invoice
10. Mixed goods + services invoice → nature of operation = mixed
11. A Factur-X PDF version of fixture 1
12. A bank transaction to match against fixture 1

---

## 6. MACHINE-FIRST DESIGN + DEMO RELIABILITY

**Fit for agents (25% of the grade), so implement all of these:**
- Zero sign-up, zero API key: **payment is the authentication** (x402).
- Unpaid call → `HTTP 402` with the x402 payment requirements (price in atomic USDC units, `payTo`, asset, network, resource, description). Paid call → result + payment response header with the tx hash. Follow the current x402 spec exactly.
- Discovery: `catalog`, `openapi.json`, `llms.txt`, `.well-known/agent.json`.
- **MCP server** (`/mcp` or a small standalone package) exposing `check_invoice`, `create_entry` and `audit_entries` tools, so that Claude Desktop or any MCP agent can use Ajean Ledger. Payment goes through x402 under the hood.
- Idempotency key header + receipts endpoint, deterministic outputs, a strict JSON schema and machine-readable error codes.
- Agent spending policy example: the demo agent has `max_per_call` and `daily_budget`. It refuses to pay if the price exceeds its policy, and logs why.

**Payment modes**, set via env `PAYMENT_MODE`:
- `testnet`: real x402 payment on Base Sepolia with test USDC (the default for the live demo)
- `simulated`: same 402 → pay → 200 flow, with a mocked facilitator and fake tx hash, clearly labelled "SIMULATED" in the UI
- **Recorded replay**: the demo console can replay a previously recorded real run (stored JSON trace) if the network fails during the presentation. **The live demo must never be able to fail.**

---

## 7. BUILD PHASES (stop at the end of each one)

**Phase 0 — Setup & questions**
Save the master prompt (§2) and create the docs skeleton. Ask your blocking questions. Propose the stack (default: Next.js App Router + TypeScript on Vercel, no database or SQLite/JSON file for receipts; Supabase only if really needed), the folder structure and the x402 package versions after checking the docs.
✅ Done when: the repo is initialised, the docs files exist, and the stack is validated by me.

**Phase 1 — Accounting engine**
`/engine` with the rules tables, compliance checks, entry builder, VAT logic, anomaly detection, Factur-X/UBL parsers and the optional LLM extraction. Add all fixtures + tests (Vitest).
✅ Done when: `npm test` is green on all 12 fixtures, and I can run `npm run engine -- fixtures/03.json` to print the JSON result.

**Phase 2 — Paid API (x402)**
API routes + 402 middleware + pricing from a single config file + receipts + idempotency + the 3 payment modes.
✅ Done when: a `curl` without payment returns 402 with correct requirements, a scripted paid call on Base Sepolia returns 200 + tx hash visible on the Base Sepolia explorer, and simulated mode works offline.

**Phase 3 — Agent discovery layer**
`catalog`, `openapi.json`, `llms.txt`, `.well-known/agent.json`, plus the MCP server.
✅ Done when: Claude Desktop (or the MCP inspector) can list and call the tools, and documented config snippets are in the README.

**Phase 4 — Demo client agent**
`/agent`: an autonomous "SME purchasing agent" (TypeScript, Anthropic SDK tool use, with a scripted fallback without an LLM). Scenario: it watches an `inbox/` folder of incoming supplier invoices, discovers Ajean Ledger via the catalog, checks the price against its budget policy, pays via x402, receives the entry, posts it into a mock ERP (`erp.json`) and flags anything requiring human review.
✅ Done when: `npm run agent` processes the inbox end to end and prints a clear step-by-step log.

**Phase 5 — Demo console (the shareable PoC link)**
This UI is **not the product**. It is a **window into agent-to-agent traffic** and must make that obvious. Pages:
- `/` Landing for the jury: one-sentence pitch, "Built for agents, not humans", the 4-step flow diagram (Request → 402 Payment Required → USDC payment → Result), pricing table, and links to `llms.txt`, OpenAPI and MCP.
- `/live` **Live Agent Console**: a split view. On the left, the agent's reasoning and raw HTTP exchange (request, 402 response, payment header, 200 response) shown step by step with a timeline. On the right, the structured result (compliance checks, entry lines as a mini ledger, anomalies, explanation) plus the tx hash linked to the explorer. Buttons: "Run scenario" (pick fixtures 1, 3, 4 or 6), mode badge (TESTNET / SIMULATED / REPLAY), "Replay recorded run".
- `/operator` A minimal operator view of the agent economy: calls served, USDC earned, revenue per endpoint, and recent transactions. It shows the business model in action.
- Optional visual nod to Ajean (the virtual office): an animated view where agent "visitors" arrive, pay and leave with their result. Keep it light and do not let it slow down the demo.
Design: clean, dark, fintech-grade, readable on a projector (large fonts, high contrast).
✅ Done when: deployed on Vercel with a public URL, and the full scenario runs in under 60 seconds per invoice.

**Phase 6 — Hardening for the presentation**
Record 3 replay runs, check the fallbacks, add rate limiting (simple), write a README quickstart (3 commands) and run a final run-through on a fresh clone. Bonus if time allows: credit packs, EURC as a second accepted stablecoin.
✅ Done when: I can run the full demo twice in a row from the public URL with no errors.

**Phase 7 — Course deliverables (drafts for me to review)**
In `/deliverables`:
1. `CONCEPT_NOTE.md`: **max 2 pages** in the brief's structure (economic problem, AI-agent use case, innovative features, target customers, existing alternatives such as Pennylane / Dext / generic LLMs / accounting-firm manual work, revenue model with crypto/stablecoin flow, simple pricing illustration with one example such as "an accounting firm whose agents process 20,000 invoices/month"). No detailed financial projections.
2. `DEMO_SCRIPT.md`: a timed **2–3 min** live demo script (who clicks what, what to say, fallback if something fails).
3. `SLIDES_OUTLINE.md`: **6–8 slides** for an **8–10 min** pitch (problem → why agents → solution → live demo → business model & crypto payments → differentiation & why now → ask/next steps), with speaker notes.
4. `QA_PREP.md`: 12 likely jury questions with short answers (e.g. "Why would an agent pay instead of using an LLM?", "Why stablecoins rather than card payments?", "Liability if the entry is wrong?", "Why can't Pennylane do this?", "What happens on mainnet?", "GDPR and data retention?").
5. `docs/prompts/PROMPTS_SUBMISSION.md`: the final prompt export (§2).
6. Final update of `BRIEF_COMPLIANCE.md` with every requirement ticked and its evidence.
✅ Done when: all files exist and the concept note fits on 2 pages when exported.

---

## 8. QUALITY BAR

- Every result must be **accounting-correct** on the fixtures. If unsure about a rule, mark it `human_review_required` rather than guess, and list it in `DECISIONS.md` for my review (I work in finance/audit and will check).
- The demo must tell one story with no detours: an SME's purchasing agent receives an invoice → it doesn't know French rules → it pays Ajean Ledger 0.15 USDC in one HTTP request → it gets a correct, compliant entry plus a warning a human would have missed.
- Keep it simple, real and reliable. Real where it is cheap (testnet payments, real API, real MCP), simulated where it is risky (with clear labels).

**Start now with Phase 0: save this prompt verbatim to `docs/prompts/00_MASTER_PROMPT.md`, create the PROMPT_LOG entry #01 for this message, then ask me your blocking questions.**
