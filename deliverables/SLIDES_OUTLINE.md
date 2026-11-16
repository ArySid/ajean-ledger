# Ajean Ledger — Slides Outline (7 slides + backup, 8–10 min pitch)

> **First draft.** Target length: **about 8:45**, including a 2:35 live demo, which leaves about a minute of margin before the 10-minute limit. Speakers are suggestions.
> Grading criteria: **ECO** Economic relevance & innovation (30%) · **AGENT** Fit for AI-agent use (25%) · **POC** Quality of the PoC (20%) · **COM** Commercial potential (15%) · **PRES** Presentation (10%).

| # | Slide | Time | Cumulative | Speaker (suggested) | Main criterion |
|---|---|---|---|---|---|
| 1 | The problem | 1:00 | 1:00 | Ary | ECO |
| 2 | Why agents | 0:50 | 1:50 | Leo | AGENT, ECO |
| 3 | The solution | 1:10 | 3:00 | Victor | AGENT, POC |
| 4 | Live demo | 2:45 | 5:45 | Ary (narrator) + Victor (driver) | POC, AGENT, PRES |
| 5 | Business model & crypto payments | 1:20 | 7:05 | Yoann | COM, AGENT |
| 6 | Differentiation & why now | 0:55 | 8:00 | Leo | ECO, COM |
| 7 | Ask & next steps | 0:45 | 8:45 | Ary | COM, PRES |

---

## Slide 1 — The problem: agents do the paperwork, accountants fix it

**Bullets**
- SMEs and accounting firms now hand invoices to AI agents (purchasing, expenses, pre-bookkeeping).
- Agents read invoices well, but they do not reliably apply French rules: PCG account, VAT regime, how much VAT is deductible, mandatory mentions.
- Every error comes back later as a manual correction, a rejected VAT deduction or an audit finding.
- E-invoicing reform: reception mandatory for every company since 1 Sept 2026, issuance for SMEs from 1 Sept 2027, with new mentions (buyer SIREN, nature of the operation…).

**Visual:** a real-looking (synthetic) restaurant invoice with the VAT line circled in red: "20%? It should be 10%." Small timeline at the bottom: 1 Sept 2026 → 1 Sept 2027.

**Speaker notes (1:00):** Open with the invoice, not with us. "This invoice was billed at the wrong VAT rate. A purchasing agent would book it as is. An accountant finds it three months later, if at all." Then the reform: invoices become structured data, so agents will process them at scale. The bottleneck is no longer reading the invoice; it is applying the rules correctly. No statistics we cannot source.

**Criterion:** ECO (real pain, timely regulatory driver).

---

## Slide 2 — Why the customer is an agent, not a person

**Bullets**
- The caller is software: it needs JSON, stable codes and a price it can check against a budget, not a dashboard.
- An agent cannot sign up, fill in a card form or wait for an API key by email.
- It needs a verdict it can act on: post the entry, or escalate to a human (`human_review_required`).
- The payer is the agent's operator (accounting firm, SaaS publisher, SME), through the agent's wallet and a spending policy.

**Visual:** two columns, "Built for humans" (login screen, card form, monthly subscription) vs "Built for agents" (`llms.txt`, `HTTP 402`, JSON response). Our side highlighted.

**Speaker notes (0:50):** Address the brief directly: "This is not a human app with a chatbot attached. There is no human screen in the product path." Introduce caller vs payer clearly; the jury will ask who pays. Mention Ajean in one sentence: our existing agent platform for SMEs and accounting firms, whose accounting brain we are now selling to other agents.

**Criterion:** AGENT (machine-first design), ECO (original approach).

---

## Slide 3 — The solution: one HTTP call, one validated entry

**Bullets**
- `POST /api/v1/entry` with an invoice (JSON, Factur-X, UBL, or PDF as best effort) → balanced journal entry, VAT treatment, compliance checks, anomalies, confidence score.
- Rules first, LLM second: a deterministic engine decides accounts, amounts and VAT; the LLM only extracts or classifies, and the response says so.
- Free discovery: `/api/v1/catalog`, `/openapi.json`, `/llms.txt`, `/.well-known/agent.json`, plus an MCP server (`check_invoice`, `create_entry`, `audit_entries`).
- Payment is the authentication: x402, USDC, no sign-up, no API key.

**Visual:** the 4-step flow from the landing page: **Request → 402 Payment Required → USDC payment → Result**, with a trimmed JSON response next to it (entry lines with 6257 / 44566 / 401, `anomalies`, `human_review_required`).

**Speaker notes (1:10):** Walk through the flow once, slowly; it is the frame for the demo. Point at the JSON: stable `rule_id`s, debits equal credits, a one-paragraph explanation the agent can relay to its operator. Say plainly what is real: a working API, real testnet payments, a real MCP server, synthetic data only. End with: "Let's watch an agent use it."

**Criterion:** AGENT (discovery, JSON contract, MCP), POC (coherent end to end).

---

## Slide 4 — Live demo

**Bullets** (on the slide, minimal; the screen does the talking)
- Atelier Lumenor SAS (fictional): its purchasing agent receives a restaurant invoice.
- Discover → check budget → 402 → pay 0.15 USDC → entry + warning.
- Modes: TESTNET · SIMULATED · REPLAY.

**Visual:** switch to `https://ajean-ledger.ary-sidoun.workers.dev/live`. The slide is only a title card to fall back on.

**Speaker notes (2:45, including the switch to the browser):** Follow `DEMO_SCRIPT.md` exactly. Key moments to land: the **402** (payment is the authentication), the **tx hash** on the Base Sepolia explorer (it is real), the **VAT_RATE_MISMATCH** warning with `human_review_required: true` (the value), the **operator view** +0.15 USDC (the business). If anything stalls for more than 10 s, the driver switches mode without discussion.

**Criterion:** POC (end-to-end, credible), AGENT (shows what the agent requests and receives), PRES (a demo that cannot fail).

---

## Slide 5 — Business model & crypto payments

**Bullets**
- Pay per call: check 0.05 USDC · entry 0.15 USDC · audit (≤ 50 entries, auditor and tax-inspector viewpoints) 1.00 USDC; discovery free.
- x402 flow: `PAYMENT-REQUIRED` → agent signs an EIP-3009 USDC authorisation → `PAYMENT-SIGNATURE` → verify, run, settle only on success → `PAYMENT-RESPONSE` + tx hash.
- The facilitator pays gas; the agent is never charged for a failed call; no chargebacks, no collection.
- Example: a firm whose agents process 20,000 invoices a month → 20,000 × 0.15 = 3,000 USDC + 400 audits × 1.00 = 400 USDC → **3,400 USDC/month (0.17 per invoice)**.
- Volume: prepaid credit packs (10 USDC → 12 USDC of calls); EURC as a second stablecoin.

**Visual:** sequence diagram Agent ↔ Ajean Ledger ↔ Facilitator ↔ Base, with the three headers labelled. Beside it, the pricing table and the 20,000-invoice calculation.

**Speaker notes (1:20):** Insist on who pays: the operator funds the agent wallet and sets `max_per_call` and `daily_budget`, and the agent enforces them itself (shown in the demo). Explain why stablecoins: a 0.05 call is uneconomic with card fixed fees, and an agent cannot hold a card or go through 3-D Secure. Present the 20,000-invoice example as an illustration from our own prices, not a forecast. Optional: under the assumption of 2 minutes of staff time per invoice, that volume is about 667 hours a month; we do not remove review, we focus it.

**Criterion:** COM (clear payer, plausible pricing), AGENT (native machine payments).

---

## Slide 6 — Differentiation & why now

**Bullets**
- Pennylane, Dext: strong tools for humans with accounts and subscriptions; we are a per-call building block any agent can use, and our output can feed them.
- Generic LLMs: cheap, but no deterministic validation, no stable rule references, and they can invent accounts or rates.
- Our edge: French accounting expertise from Ajean (accountant, statutory-auditor and tax-inspector agents) packaged as a machine-readable, auditable service.
- Why now: the e-invoicing reform makes invoices structured data (2026–2027), and agent-native stablecoin payments (x402) are ready.

**Visual:** 2×2 matrix: x-axis "built for humans → built for agents", y-axis "generic → French-rules expert". Ajean Ledger alone in the top-right; Pennylane/Dext top-left; generic LLMs bottom-right.

**Speaker notes (0:55):** Be fair to competitors; the jury may know them. Our claim is not "better accounting software", it is "the first accounting function an agent can discover, pay for and trust without a human signing up". Why now: two clocks, the regulation and the payment rails, both ticking in 2026.

**Criterion:** ECO (innovation, timing), COM (positioning).

---

## Slide 7 — Ask & next steps

**Bullets**
- Today: working PoC, real API, real MCP server, real testnet payments, 12 synthetic fixtures with tests. Link: `https://ajean-ledger.ary-sidoun.workers.dev`.
- Next: review of the accounting rules by a chartered accountant, pilot with 1–2 accounting firms on their own agents, listing in agent and x402 discovery directories.
- Then: mainnet (Base + USDC/EURC), production facilitator, terms of use and liability framework, GDPR set-up.
- Our ask: {{ASK — e.g. feedback from the jury, introductions to accounting firms or SaaS publishers for a pilot}}.

**Visual:** three-step roadmap (PoC → Pilot → Production), with a QR code to `https://ajean-ledger.ary-sidoun.workers.dev`.

**Speaker notes (0:45):** Close on the one-liner: "An accounting service whose customers are agents, paid by the call in stablecoins." Leave the QR code on screen during Q&A. Thank the jury; hand over to Q&A (see `QA_PREP.md`).

**Criterion:** COM (path to market), PRES (clear close).

---

## Backup slides (not presented; for Q&A)

- **B1 — Response contract:** full JSON of `POST /api/v1/entry` for fixture 03.
- **B2 — Architecture:** Next.js 16 on Cloudflare Workers (free plan, OpenNext), framework-free engine, x402 v2 (`@x402/*` 2.31.0), facilitator, Base Sepolia, MCP server, store for receipts.
- **B3 — What is real vs simulated:** real API, payments (testnet), MCP; synthetic data; SIMULATED and REPLAY modes clearly labelled.
- **B4 — Accounting rules covered:** the 12 fixtures (standard 20%, missing buyer SIREN, restaurant VAT, intra-EU reverse charge, exempt training, duplicate, credit note, fixed asset 2183 + 44562, lawyer fees, mixed goods/services, Factur-X, bank matching).
- **B5 — Security & GDPR:** see `QA_PREP.md` Q6 and Q9.
