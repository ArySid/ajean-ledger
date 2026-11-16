# Ajean Ledger — Concept Note

**An accounting API for AI agents, paid per call in stablecoins.** Team: Ary SIDOUN, Victor BONNAPETIT, Yoann POMMEROLLE, Leo COUTURIER.
**Live PoC:** <https://ajean-ledger.ary-sidoun.workers.dev> (agent console `/live`), in **TESTNET** mode on Cloudflare Workers: real x402 payments in test USDC, settled on Base Sepolia. Synthetic data only; not a substitute for a chartered accountant's review.

An AI agent sends a French invoice or bank transaction and gets back, in one HTTP exchange, a validated machine-readable accounting entry: PCG accounts, VAT treatment, e-invoicing compliance and anomaly flags. It pays per call in USDC through x402. No sign-up, no API key: **payment is the authentication.**

## 1. Economic problem

SMEs and accounting firms are handing purchasing, expense and pre-bookkeeping work to AI agents. They read invoices well but do not reliably apply French rules: wrong PCG account, wrong VAT regime (standard, intra-EU reverse charge, exempt), wrong deductible VAT, missing mandatory mentions. These errors come back later as manual corrections, rejected VAT deductions or audit findings.

The French e-invoicing reform raises the stakes. Since 1 September 2026 every company must be able to receive e-invoices; large and mid-size companies issue them from that date, SMEs from 1 September 2027. New mandatory mentions appear (buyer SIREN, nature of the operation, delivery address, VAT-on-debits option). Invoices become structured data that agents will process at scale, if they apply the rules correctly.

## 2. AI-agent use case (what the demo shows)

The direct user is an agent. The purchasing agent of *Atelier Lumenor SAS (fictional)* receives a restaurant invoice for 175.20 EUR. The meal was billed at 20% VAT instead of 10%. The agent:

1. discovers Ajean Ledger through free discovery files (catalog, `llms.txt`, OpenAPI, agent card, MCP);
2. checks the price (0.15 USDC) against its operator's spending policy (`max_per_call` 0.20, `daily_budget` 2.00 USDC); the same policy makes it refuse a 1.00 USDC audit before paying anything (demo scenario 90);
3. calls `POST /api/v1/entry`, gets `HTTP 402 Payment Required`, signs a USDC payment and retries, with no human involved;
4. receives a balanced entry: debit 6257 160.60, debit 44566 14.60, credit 401BOUCHON 175.20. Only the VAT legally due (10%) is deducted. The 14.60 EUR excess stays in the expense, flagged as `VAT_RATE_MISMATCH` with `human_review_required: true`;
5. posts the entry to its ERP and sends only this invoice to a human, to request a corrected invoice.


## 3. Innovative features

- **Machine-first.** JSON only, strict schemas, machine-readable error codes, idempotency keys, free receipts, discovery files and an MCP server (`check_invoice`, `create_entry`, `audit_entries`). The web console only observes agent traffic; no human screen sits in the product path.
- **Payment is the authentication.** x402 over plain HTTP: no account, no key, no invoice to chase; the agent pays only if the call succeeds.
- **Rules first, LLM second.** A deterministic engine decides accounts, amounts and VAT, with a stable `rule_id` per rule. An optional LLM only extracts unstructured documents or classifies ambiguous descriptions, and the response says so. Uncertain cases return `human_review_required: true` instead of a guess.
- **Expert viewpoints.** `/audit` returns structured statutory-auditor and tax-inspector findings, inherited from the expert agents of Ajean, our AI-agent platform for SMEs and accounting firms.
- **Tested.** 217 automated tests and 13 synthetic fixtures (reverse charge, credit note, fixed asset, duplicate, Factur-X, UBL, bank matching); two independent reviews (engine, live demo).

## 4. Target customers

The **caller** is the agent; the **payer** is its operator, who funds its wallet and sets its policy: accounting firms running pre-bookkeeping agents; SaaS publishers (ERP, spend, expenses) whose agents need French accounting logic; SMEs and freelancers whose assistants do their admin.

## 5. Existing alternatives

| Alternative | Strength | Limit for agent use (our assessment) |
|---|---|---|
| Pennylane | Full accounting platform with automated pre-bookkeeping | Built for its subscribers' ledgers and human users; account and subscription |
| Dext | Document capture and extraction for bookkeepers | Account and subscription; extraction, then export to accounting software |
| Generic LLMs | Read any document, low cost | No deterministic validation, no stable rule references; can invent accounts or VAT rates |
| Manual work in firms | Expert judgement, professional liability | Time-consuming; staff are scarce at peak periods |

Ajean Ledger complements them: a per-call building block whose JSON output can feed any of them.

## 6. Revenue model

Pay per call by value tier (one config file, published in the catalog). Discovery and receipts are free.

| Endpoint | What the agent gets | Price (USDC) |
|---|---|---|
| `POST /api/v1/invoice/check` | E-invoice compliance check (mentions, VAT consistency) | 0.05 |
| `POST /api/v1/entry` | Entry + VAT treatment + compliance + anomalies | 0.15 |
| `POST /api/v1/audit` | Up to 50 entries, auditor and tax-inspector viewpoints | 1.00 |

*Planned, not in the PoC:* prepaid credit packs (pay 10 USDC, get 12 of calls); EURC for euro clients.

## 7. Stablecoin revenue mechanism (x402 on Cloudflare)

1. The agent calls a paid endpoint without paying. The server answers `402` with a `PAYMENT-REQUIRED` header that gives the price in atomic USDC units (0.15 USDC = 150000), the asset, the network (Base Sepolia, `eip155:84532`) and the recipient `0xCB4b84079B1dd19828c3d5733f9e0D2DcB26dFeC`.
2. The agent signs an EIP-3009 USDC authorisation and retries with a `PAYMENT-SIGNATURE` header.
3. The x402 facilitator verifies the payment. The server runs the engine and settles **only if the call succeeds**. It then returns `200` with a `PAYMENT-RESPONSE` header carrying the transaction hash, for example [0xc155…3586 on Basescan](https://sepolia.basescan.org/tx/0xc1554772f5b9cef69564f6f621d1a12ae5af113d1723cceeec685b28e5b23586) (0.15 test USDC, live demo).

The facilitator pays the gas, so the agent's wallet only needs USDC. Revenue settles in seconds, with no chargebacks and no collection. x402 was co-created by Coinbase and Cloudflare, so we host the service on Cloudflare Workers (free plan), in the protocol's own ecosystem. Mainnet means switching the network (Base) and the asset (real USDC); the code path stays the same.

## 8. Pricing illustration

*Illustrative volume: an accounting firm whose agents process 20,000 supplier invoices a month.*

| Item | Calculation | USDC / month |
|---|---|---|
| Journal entries | 20,000 × 0.15 | 3,000 |
| Monthly audit of all entries | 20,000 ÷ 50 = 400 batches × 1.00 | 400 |
| **Total at list price** | 3,400 ÷ 20,000 = 0.17 per invoice | **3,400** |

*Assumption, for comparison only:* at two minutes of staff time per invoice, 20,000 invoices take about 667 hours a month. We do not remove human review; we focus it on flagged invoices. Illustration from our list prices, not a projection.
