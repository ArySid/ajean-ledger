# Ajean Ledger — Slides Outline (7 slides + backups, 8–10 min)

> **Final.** Target length **≈ 8:45**, including the **2:35 live demo** (`DEMO_SCRIPT.md`), which leaves about a minute of margin before the 10-minute limit. Live PoC: <https://ajean-ledger.ary-sidoun.workers.dev> (TESTNET, Cloudflare Workers).
> **Grading criteria:** **ECO** economic relevance & innovation (30%) · **AGENT** fit for AI-agent use (25%) · **POC** quality of the PoC (20%) · **COM** commercial potential (15%) · **PRES** final presentation (10%).
> **The team still has to decide:** the speakers (suggestions below) and the closing ask `{{ASK}}` on slide 7.

| # | Slide | Time | Cumulative | Speaker (suggested) | Main criterion |
|---|---|---|---|---|---|
| 1 | The problem | 1:00 | 1:00 | Ary | ECO |
| 2 | Why the customer is an agent | 0:50 | 1:50 | Leo | AGENT, ECO |
| 3 | The solution | 1:10 | 3:00 | Victor | AGENT, POC |
| 4 | Live demo | 2:45 | 5:45 | Ary (narrator) + Victor (driver) | POC, AGENT, PRES |
| 5 | Business model & crypto payments | 1:20 | 7:05 | Yoann | COM, AGENT |
| 6 | Differentiation & why now | 0:55 | 8:00 | Leo | ECO, COM |
| 7 | Proof, next steps & ask | 0:45 | 8:45 | Ary | COM, PRES |

---

## Slide 1 — The problem: agents do the paperwork, accountants fix it (1:00 · ECO)

**On the slide**
- SMEs and accounting firms are handing invoices to AI agents for purchasing, expenses and pre-bookkeeping.
- Agents read invoices well but do not reliably apply French rules: the PCG account, the VAT regime, how much VAT is deductible, the mandatory mentions.
- Each error comes back later as a manual correction, a rejected VAT deduction or an audit finding.
- E-invoicing reform: every company must receive e-invoices since 1 Sept 2026, and SMEs must issue them from 1 Sept 2027. New mentions include the buyer SIREN and the nature of the operation.

**Visual:** the synthetic restaurant invoice from scenario 03 (Le Bouchon Lumière SARL, fictional, 175.20 EUR), with the VAT line circled: "20%? A meal is 10%." A small timeline at the bottom: 1 Sept 2026 → 1 Sept 2027.

**Speaker notes:** Open with the invoice, not with us. "This invoice charges the wrong VAT rate. A purchasing agent books it as is. An accountant finds it three months later, if at all." Then the reform: invoices are becoming structured data, so agents will process them at scale. The bottleneck is no longer reading the invoice but applying the rules. Use no statistic we cannot source.

---

## Slide 2 — Why the customer is an agent, not a person (0:50 · AGENT, ECO)

**On the slide**
- The caller is software. It needs JSON, stable codes and a price it can check against a budget, not a dashboard.
- An agent cannot sign up, fill in a card form or wait for an API key by email.
- It needs a verdict it can act on: post the entry, or escalate to a human (`human_review_required`).
- The payer is the agent's operator (accounting firm, SaaS publisher, SME). It pays through the agent's wallet, under a spending policy.

**Visual:** two columns. "Built for humans" shows a login screen, a card form and a monthly subscription. "Built for agents" shows `llms.txt`, `HTTP 402` and a JSON response. Our column is highlighted.

**Speaker notes:** Answer the brief directly: "This is not a human app with a chatbot attached. There is no human screen in the product path; the web pages only observe agent traffic." Make caller and payer clear, because the jury will ask who pays. Mention Ajean in one sentence: it is our existing agent platform for SMEs and accounting firms, and we are selling its accounting brain to other agents.

---

## Slide 3 — The solution: one HTTP call, one validated entry (1:10 · AGENT, POC)

**On the slide**
- `POST /api/v1/entry` takes an invoice (JSON, Factur-X, UBL, or PDF as best effort). It returns a balanced journal entry, the VAT treatment, compliance checks with stable `rule_id`s, anomalies, a confidence score and an explanation.
- Rules first, LLM second. A deterministic engine decides the accounts, amounts and VAT. An optional LLM only extracts or classifies, and the response says when it did.
- Free discovery: `/api/v1/catalog`, `/openapi.json`, `/llms.txt`, `/.well-known/agent.json`, plus an MCP server with `check_invoice`, `create_entry` and `audit_entries`.
- Payment is the authentication: x402, USDC, no sign-up, no API key.

**Visual:** the 4-step flow from the landing page, **Request → 402 Payment Required → USDC payment → Result**. Beside it, a trimmed JSON response for scenario 03: `6257 160.60 / 44566 14.60 / 401BOUCHON 175.20`, `VAT_RATE_MISMATCH`, `human_review_required: true`.

**Speaker notes:** Walk through the flow once, slowly; it frames the demo. Point at the JSON: debits equal credits, every check has a `rule_id`, and the one-paragraph explanation can be relayed to the operator. Say plainly what is real: a working API, real testnet payments, a real MCP server, and synthetic data only. Close with: "Let's watch an agent use it."

---

## Slide 4 — Live demo (2:45 incl. switching to the browser · POC, AGENT, PRES)

**On the slide** (minimal: this is a title card to fall back on)
- Atelier Lumenor SAS (fictional): its purchasing agent receives a restaurant invoice.
- Discover → check budget → 402 → pay 0.15 USDC → entry + warning.
- Modes: TESTNET (live) · REPLAY (recorded from a real testnet run) · SIMULATED (offline development).

**Visual:** switch to `https://ajean-ledger.ary-sidoun.workers.dev/live?scenario=03&speed=0.5`.

**Speaker notes:** Follow `DEMO_SCRIPT.md` exactly. The moments to land are:
- the **402**: payment is the authentication;
- the **tx hash** on Basescan: it is real;
- the **VAT_RATE_MISMATCH** warning with `human_review_required: true`: that is the value;
- the **operator view**, +0.15 USDC: that is the business.

If anything stalls for more than 10 s, the driver switches to REPLAY without discussion; REPLAY is a recording of a real testnet run. Optionally, if there is slack, run scenario 90: the agent refuses a 1.00 USDC audit because of its policy.

---

## Slide 5 — Business model & crypto payments (1:20 · COM, AGENT)

**On the slide**
- Pay per call: check 0.05 USDC · entry 0.15 USDC · audit (≤ 50 entries, auditor and tax-inspector viewpoints) 1.00 USDC. Discovery and receipts are free.
- The x402 flow: `PAYMENT-REQUIRED` → the agent signs an EIP-3009 USDC authorisation → `PAYMENT-SIGNATURE` → verify, run, settle only on success → `PAYMENT-RESPONSE` with the tx hash.
- The facilitator pays the gas. The agent is never charged for a failed call. There are no chargebacks and nothing to collect.
- **Why Cloudflare:** x402 was created by Coinbase, and Cloudflare co-founded the x402 Foundation with Coinbase (Sept. 2025) and supports x402 in its Agents SDK and MCP tooling, so we run the service on Cloudflare Workers, in the protocol's own ecosystem (free plan for the PoC).
- Example: a firm whose agents process 20,000 invoices a month pays 20,000 × 0.15 = 3,000 USDC, plus 400 audits × 1.00 = 400 USDC. That is **3,400 USDC a month, or 0.17 per invoice**.

**Visual:** a sequence diagram Agent ↔ Ajean Ledger (Cloudflare Workers) ↔ x402 facilitator ↔ Base, with the three headers labelled. Beside it, the pricing table and the 20,000-invoice calculation.

**Speaker notes:** Insist on who pays. The operator funds the agent's wallet and sets `max_per_call` (0.20) and `daily_budget` (2.00), and the agent enforces them itself, as the demo showed. Why stablecoins: a 0.05 call is uneconomic with card fixed fees, and an agent cannot hold a card or pass 3-D Secure. Present the 20,000-invoice example as an illustration from our own prices, not a forecast. Credit packs (pay 10 USDC, get 12 USDC of calls) and EURC as a second stablecoin are live in the PoC (Q&A Q17). Optionally, add an assumption: at 2 minutes of staff time per invoice, that volume is about 667 hours a month. We do not remove review; we focus it.

---

## Slide 6 — Differentiation & why now (0:55 · ECO, COM)

**On the slide**
- Pennylane and Dext are strong tools for humans, with accounts and subscriptions. We are a per-call building block any agent can use, and our output can feed them.
- Generic LLMs are cheap, but they have no deterministic validation and no stable rule references, and they can invent accounts or rates.
- Our edge: French accounting expertise from Ajean (accountant, statutory-auditor and tax-inspector agents), packaged as a machine-readable, auditable service.
- Why now: the e-invoicing reform turns invoices into structured data (2026–2027), and agent-native stablecoin payments (x402) are ready.

**Visual:** a 2×2 matrix. The x-axis runs from "built for humans" to "built for agents"; the y-axis from "generic" to "French-rules expert". Ajean Ledger sits alone top-right, Pennylane and Dext top-left, generic LLMs bottom-right.

**Speaker notes:** Be fair to competitors; the jury may know them. Our claim is not "better accounting software". It is "the first accounting function an agent can discover, pay for and trust without a human signing up". Why now: two clocks, the regulation and the payment rails, both ticking in 2026.

---

## Slide 7 — Proof, next steps & ask (0:45 · COM, PRES)

**On the slide**
- **Today: it works.** A live API, an MCP server and real x402 payments on Base Sepolia. Proof: [0xc155…3586 on Basescan](https://sepolia.basescan.org/tx/0xc1554772f5b9cef69564f6f621d1a12ae5af113d1723cceeec685b28e5b23586), the 0.15 test USDC paid by the agent for scenario 03. 217 automated tests, 13 synthetic fixtures, two independent reviews.
- **Next:** a chartered accountant signs off the legal references (pending: until then none is shown to agents), a pilot with one or two accounting firms on their own agents, and listing in agent and x402 directories.
- **Then:** mainnet (Base + USDC and EURC), a production facilitator, terms of use with a liability cap, and a GDPR set-up.
- **Our ask:** {{ASK}} (e.g. jury feedback, introductions to accounting firms or SaaS publishers for a pilot).

**Visual:** a three-step roadmap (PoC → Pilot → Production), a QR code to `https://ajean-ledger.ary-sidoun.workers.dev`, and a small Basescan screenshot of the tx.

**Speaker notes:** Close on the one-liner: "An accounting service whose customers are agents, paid by the call in stablecoins." Leave the QR code on screen during Q&A, then hand over to Q&A (`QA_PREP.md`).

---

## Backup slides (not presented; for Q&A)

- **B1. Response contract:** the full JSON of `POST /api/v1/entry` for fixture 03 (`npm run -s engine -- fixtures/03.json`).
- **B2. Architecture:** Next.js 16 on Cloudflare Workers (OpenNext, free plan, KV for receipts); a framework-free TypeScript engine; x402 v2 (`@x402/*` 2.31.0); the x402.org facilitator on Base Sepolia; MCP (remote `/mcp` and a stdio bridge).
- **B3. Free-plan limits:** 100k requests a day, 10 ms of CPU per request, 1,000 KV writes a day. Impact and mitigations: see `QA_PREP.md` Q13.
- **B4. Real vs simulated:** the API, testnet payments and MCP are real; the data is synthetic; REPLAY is a recording of a real testnet run, labelled on screen.
- **B5. Accounting rules covered:** the 13 fixtures — standard 20%, missing buyer SIREN, restaurant VAT, intra-EU reverse charge, exempt training, duplicate, credit note, fixed asset 2183 + 44562, lawyer fees (BNC, cash basis), mixed goods/services, Factur-X (PDF of fixture 01), bank matching, UBL (XML of fixture 10).
- **B6. Security & GDPR:** see `QA_PREP.md` Q6 and Q9.
