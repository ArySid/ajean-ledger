# Ajean Ledger — Concept Note

**An accounting API for AI agents, paid per call in stablecoins.**
Team: Ary SIDOUN, Victor BONNAPETIT, Yoann POMMEROLLE, Leo COUTURIER · PoC: https://ajean-ledger.ary-sidoun.workers.dev
*Proof of concept on Base Sepolia testnet, synthetic data only. Not a substitute for a chartered accountant's review.*

Ajean Ledger lets any AI agent send a French invoice or bank transaction and immediately get back a validated, machine-readable accounting entry (PCG accounts, VAT treatment, e-invoicing compliance status, anomaly flags). The agent pays per call in USDC through the x402 protocol. No sign-up, no API key: **payment is the authentication.**

## 1. Economic problem

SMEs and accounting firms increasingly hand purchasing, expense and pre-bookkeeping tasks to AI agents. These agents read invoices well but do not reliably apply French accounting and tax rules: which PCG account, which VAT regime (standard, intra-EU reverse charge, exempt), how much VAT is deductible, whether mandatory mentions are present. Errors are cheap to make and costly to fix: they return as manual corrections, rejected VAT deductions or audit findings.

The French e-invoicing reform raises the stakes. Since 1 September 2026 every company must be able to receive e-invoices, and SMEs must issue them from 1 September 2027, with new mandatory mentions (buyer SIREN, nature of the operation, delivery address if different, option for VAT on debits). Invoices become structured data that agents can process, if they apply French rules correctly.

## 2. AI-agent use case

The direct user is an agent. In our demo, the purchasing agent of *Atelier Lumenor SAS (fictional)* watches an inbox of supplier invoices. For each invoice it:

1. discovers Ajean Ledger through free machine-readable files (`/api/v1/catalog`, `llms.txt`, OpenAPI, MCP);
2. checks the price (0.15 USDC) against its operator's spending policy (`max_per_call`, `daily_budget`);
3. calls `POST /api/v1/entry`, receives `HTTP 402 Payment Required`, pays in USDC and retries, with no human;
4. receives a balanced journal entry, the VAT treatment, compliance checks with stable `rule_id`s, anomalies, a confidence score and a `human_review_required` flag;
5. posts the entry to its ERP and sends only the flagged cases to a human: a restaurant invoice billed at 20% instead of 10%, a duplicate invoice, a missing buyer SIREN.

## 3. Innovative features

- **Machine-first.** JSON only, strict schema, machine-readable error codes, idempotency keys, receipts, discovery files (`llms.txt`, `/.well-known/agent.json`) and an MCP server (`check_invoice`, `create_entry`, `audit_entries`).
- **Payment is the authentication.** x402 runs over plain HTTP: no account, no key, no invoice to chase.
- **Rules first, LLM second.** A deterministic engine decides the accounts, amounts and VAT. An LLM only extracts data from unstructured documents or classifies ambiguous descriptions, and the response says when it was used. Uncertain cases return `human_review_required: true` instead of a guess.
- **Expert viewpoints.** The audit endpoint returns structured findings from a statutory-auditor and a tax-inspector perspective, inherited from the expert agents of Ajean, our existing AI-agent platform for SMEs and accounting firms.

## 4. Target customers

The **caller** is the agent. The **payer** is the agent's operator:

- accounting firms running pre-bookkeeping agents across client portfolios;
- SaaS publishers (ERP, spend management, expense tools) whose agents need French accounting logic without building it;
- SMEs and freelancers whose general-purpose assistants handle their admin.

## 5. Existing alternatives

| Alternative | Strength | Limit for agent use |
|---|---|---|
| Pennylane | Complete accounting platform for SMEs and firms, with automated pre-bookkeeping | Built around its own subscribers' ledgers and a human interface; needs an account and a subscription |
| Dext | Document capture and data extraction for bookkeepers | Account and subscription; focused on extraction, exports to accounting software |
| Generic LLMs | Read any document, low cost | No deterministic validation, no stable rule references; can invent accounts or VAT rates |
| Manual work in firms | Expert judgement and professional liability | Time-consuming; staff are scarce at peak periods |

Ajean Ledger does not replace these tools: it is a per-call building block for any agent, and its output can feed any ERP or accounting software.

## 6. Revenue model

Pay per call, priced by value tier. Discovery is free.

| Endpoint | What the agent gets | Price |
|---|---|---|
| `POST /api/v1/invoice/check` | E-invoice compliance check | 0.05 USDC |
| `POST /api/v1/entry` | Full entry + VAT + compliance + anomalies | 0.15 USDC |
| `POST /api/v1/audit` | Batch of up to 50 entries, auditor and tax-inspector viewpoints | 1.00 USDC |
| Catalog, OpenAPI, `llms.txt`, agent.json, receipts | Discovery and proof of payment | free |

Volume option: **prepaid credit packs** (e.g. pay 10 USDC, get 12 USDC of calls).

## 7. Stablecoin revenue mechanism (x402)

1. The agent calls a paid endpoint without payment. The server answers `402` with a `PAYMENT-REQUIRED` header: the price in atomic USDC units (0.15 USDC = 150000), the recipient address, the asset and the network.
2. The agent signs a USDC transfer authorisation (EIP-3009) with its wallet and retries with a `PAYMENT-SIGNATURE` header.
3. An x402 facilitator verifies the payment; the server runs the engine, settles **only if the call succeeds**, and returns `200` with a `PAYMENT-RESPONSE` header containing the transaction hash.

The facilitator pays the gas, so the agent wallet only needs USDC; the operator funds it and sets its spending policy. Revenue settles in seconds, with no chargebacks and no collection work. The PoC runs on Base Sepolia with test USDC. EURC is a natural second stablecoin for euro-based clients.

## 8. Pricing illustration

*An accounting firm whose agents process 20,000 supplier invoices a month:*

| Item | Calculation | USDC / month |
|---|---|---|
| Journal entries | 20,000 × 0.15 | 3,000 |
| Monthly audit of all entries | 20,000 ÷ 50 = 400 batches × 1.00 | 400 |
| **Total at list price** | 3,400 ÷ 20,000 = 0.17 per invoice | **3,400** |
| With credit packs (12 for 10) | 3,400 × 10 ÷ 12 | ≈ 2,833 |

For comparison, *assuming* two minutes of staff time per invoice for entry and checks, the same volume is 20,000 × 2 = 40,000 minutes, about 667 hours a month. Ajean Ledger does not remove human review; it focuses it on flagged invoices. Illustration only, not a financial projection.
