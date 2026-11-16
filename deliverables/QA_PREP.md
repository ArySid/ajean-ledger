# Ajean Ledger — Q&A Preparation

> **Final.** 16 likely jury questions with short answers; say each in 20–30 seconds. Team rule: **never quote a figure we cannot compute from our own prices or code, and label every assumption.** If you don't know an answer, say what we would check and how.
> The owner of each question is in brackets. These are suggestions; the team decides. The facts were checked on 2026-11-16 against the code and the live deployment <https://ajean-ledger.ary-sidoun.workers.dev> (TESTNET mode).

---

### Q1. Why would an agent pay instead of just asking an LLM? *(Leo)*
An LLM can propose an entry, but it cannot guarantee it. It may invent an account, apply the wrong VAT rate or miss a mandatory mention, and it gives no stable reference for its answer. We return a deterministic, balanced entry with stable `rule_id`s, a confidence score and an explicit `human_review_required` flag. For 0.15 USDC the agent buys a result it can act on, and a trace its operator can audit. In the demo's restaurant invoice, a generic model may well book the 20% VAT as invoiced; we deduct only the 10% legally due and flag the rest, every time. (We have not benchmarked general-purpose models, so we do not quote an error rate.)

### Q2. Why stablecoins rather than card payments? *(Yoann)*
There are three reasons:
- **Micropayments.** Card fixed fees per transaction are of the same order as, or above, a 0.05 USDC call.
- **Autonomy.** An agent cannot hold a card, sign up or pass 3-D Secure. It can hold a wallet with a spending policy set by its operator.
- **Settlement.** x402 settles in seconds, with no chargebacks and no invoice to collect.

USDC is dollar-denominated; EURC (planned) would let euro-based clients pay in euros.

### Q3. Who is liable if the entry is wrong? *(Ary)*
The output is a proposal, not certified bookkeeping. Every response carries a confidence score, the rules applied and `human_review_required` for ambiguous cases. Every response is also labelled "not a substitute for a chartered accountant's review". The operator (SME or accounting firm) stays responsible for its books. Keeping accounts for third parties is a regulated profession in France (experts-comptables), so we position Ajean Ledger as a tool, not an accounting service. In production we would add terms of use with a liability cap and versioned rules. Each call already leaves a trace (`request_id`, rules applied, engine version, receipt) that can be used to investigate a dispute.

### Q4. Why can't Pennylane (or Dext) do this? *(Leo)*
Technically they could; they have strong accounting products. Their model is different: software for human users, with accounts and subscriptions, organised around their own customers' ledgers. Ours is a per-call function that any agent can discover and pay for in one HTTP exchange, with no account. We are complementary: our output is plain JSON and can feed Pennylane, another accounting tool or an ERP. We are betting on distribution to agents, not on replacing accounting platforms.

### Q5. What happens on mainnet? *(Victor)*
Technically, little changes. The network moves from Base Sepolia (`eip155:84532`) to Base (`eip155:8453`), the asset becomes real USDC, and the public x402.org testnet facilitator is replaced by a production facilitator (a hosted one or our own). The code path stays the same, because we use the official x402 SDK (`@x402/*` 2.31.0) instead of custom payment logic. The real work is outside the code:
- terms of use;
- a regulated provider to convert stablecoins into euros;
- the accounting and tax treatment of stablecoin receipts;
- a legal check of our positioning with counsel, including the regulatory status of the stablecoin.

These are open items, not done. Until then we stay on testnet only: no real funds, ever.

### Q6. GDPR and data retention? *(Yoann)*
Invoices can contain personal data (sole traders' names and addresses), so we say exactly what is kept, as the current code does it (`lib/store/cloudflare-kv.ts`):
- **The invoice document** is processed in memory and not stored as such.
- **The receipt** (request id, price, tx hash and the **full result**, which includes party names, addresses and SIRENs) and the idempotency key expire after **30 days** (KV TTL).
- **Not expiring today:** the operator dashboard's last 100 request ids and per-endpoint counters (no personal data). When the caller sends a client profile, a small duplicate-detection fingerprint is also kept per supplier invoice (supplier id, number, date, amount). In production that fingerprint would get a retention period aligned with accounting retention rules.
- **On-chain:** nothing from the invoice. The blockchain only sees two wallet addresses and an amount.
- **LLM:** the optional LLM layer would be a subprocessor, used only for unstructured documents. It is not configured on the live demo.

In the PoC all data is synthetic and the companies are fictional (unallocated `000…` SIRENs).

### Q7. How does an agent find the service? *(Victor)*
Through free machine-readable files: `/api/v1/catalog` (services and prices), `/openapi.json` (with the price of each paid operation), `/llms.txt` and `/.well-known/agent.json`. There is also an MCP server with `check_invoice`, `create_entry` and `audit_entries`, available remotely at `/mcp` and as a stdio bridge for Claude Desktop. The 402 response itself describes the price, asset, network and recipient. Next steps: listing in agent and x402 discovery directories, and integration by SaaS publishers whose agents already process invoices.

### Q8. How did you set the prices? *(Yoann)*
By value tier. A compliance check (0.05) is the cheapest. A full entry with VAT and anomalies (0.15) is the core product. An audit of up to 50 entries with two expert viewpoints (1.00) costs 0.02 per entry. On structured inputs the marginal cost is very low, because the engine is deterministic and the LLM only runs on unstructured documents. Example: 20,000 invoices a month at 0.15 is 3,000 USDC. These are PoC list prices, to be tested in pilots. Credit packs (pay 10, get 12 USDC of calls) are planned for volume.

### Q9. What stops a malicious agent? *(Victor)*
- **Payment itself.** Every paid call costs money, which limits abuse. Each EIP-3009 authorisation has a nonce, so a payment cannot be replayed.
- **Guard rails.** Per-IP rate limits (120 calls per minute on the paid endpoints and `/mcp`, 30 on demo runs), a 5 MB body limit, strict schema validation and machine-readable errors.
- **Prompt injection.** An instruction hidden in an invoice cannot change the result: the LLM, when used, only extracts fields, and the rules engine decides accounts, amounts and VAT.

Settlement happens only after a successful response, so honest agents are never charged for errors.

### Q10. How accurate is it, and how do you validate it? *(Ary)*
The engine is rules first, LLM second. Accounts, amounts and VAT come from deterministic tables: PCG mapping, VAT rates of 20 / 10 / 5.5 / 2.1%, regimes including intra-EU reverse charge, and the mandatory mentions. Debits always equal credits. Validation:
- **226 automated tests** (`npm test`), all green.
- **13 synthetic fixtures** with expected outputs: reverse charge, credit note, fixed asset in 2183 with VAT in 44562, duplicate, Factur-X, UBL, bank matching…
- **Two independent reviews** by reviewers who did not write the code. The Phase 1 review checked the engine as an expert-comptable would and found 2 blocking issues, both fixed: the excess-VAT deduction on fixture 03, and fictional SIRENs that were real. The Phase 5 review checked the live demo and found 0 blocking issues; its major findings were fixed.

When the engine is unsure, it flags the case for review instead of guessing.

### Q11. Are your legal references reviewed? *(Ary)*
Not yet, and we say so. The engine cites a curated table of 25 legal bases (`engine/rules/legal-basis.ts`). Each entry has a `reviewed_by` field, and **all of them are still pending accountant sign-off**: by Ary (finance/audit) for the PoC, and by a chartered accountant before any production use (`docs/LEGAL_REVIEW.md`, with open questions such as the reform timeline per company size and the excess-VAT treatment). Until an entry is signed off, agents only see a stable `legal_basis_id`, never an article number, and tests enforce this on every output and discovery file.

### Q12. Are you an e-invoicing platform (PA, formerly PDP) under the reform? *(Ary)*
No, and we don't claim to be. Approved platforms are registered with the tax administration to transmit e-invoices and e-reporting data; we transmit nothing to the administration. Ajean Ledger is a bookkeeping and compliance pre-check service. It analyses an invoice the agent already has, before issuing it or after receiving it, and returns the entry and the compliance status. It sits next to the platform in the chain, not in its place.

### Q13. You run on Cloudflare's free plan. What are the limits, and what happens if you hit them? *(Victor)*

| Limit (Workers Free) | Our usage | If exceeded | Mitigation |
|---|---|---|---|
| **100,000 requests/day** | One demo run ≈ 5 requests (the console call plus the agent's catalog, health, 402 and paid call); a page view adds a few for static files | Error until the daily reset (00:00 UTC) | Per-IP rate limits; Day-J warmup; backup laptop with the replays bundled in the page |
| **10 ms CPU per request** (network waits excluded) | Paid JSON call ≈ 6 ms warm (measured in Node, ±50%); in TESTNET the facilitator calls are network waits, not CPU | Error 1102 on heavy paths: Factur-X PDF (≈ 8–13 ms) and 50-item audits (≈ 11–16 ms) | The live demo uses JSON invoices; the warmup absorbs cold starts; any live failure → automatic REPLAY |
| **KV: 1,000 writes/day** | ≈ 4–5 writes per paid call → about 200–250 paid calls/day | KV refuses writes | `ResilientStore` falls back to memory: the API keeps answering; receipts then live only in the isolate |

In production we would move to a paid Workers plan and a database for receipts. That is a configuration change, not a redesign. Measurements are in `docs/HOSTING.md` §4–5.

### Q14. Why Cloudflare? *(Yoann)*
x402 was created by Coinbase (launched May 2025). Cloudflare co-founded the x402 Foundation with Coinbase (announced September 2025) and supports x402 in its Agents SDK and MCP tooling. Running an agent-payment service on Cloudflare Workers puts it inside the protocol's own ecosystem. There are practical reasons too: a free plan for the PoC, global edge hosting, KV storage and a one-command deploy. Our first plan was another host, which became unavailable. Cloudflare was the first host we tested, and it ran the full demo from a public URL, so we kept it (`docs/DECISIONS.md` ADR-017, ADR-020).

### Q15. Is the payment in the demo real? *(Victor)*
Yes, on testnet. The live deployment runs in TESTNET mode: the agent signs a real EIP-3009 authorisation, and the x402.org facilitator settles 0.15 test USDC on Base Sepolia. The tx hash opens on Basescan, for example the scenario 03 run [0xc155…3586](https://sepolia.basescan.org/tx/0xc1554772f5b9cef69564f6f621d1a12ae5af113d1723cceeec685b28e5b23586), which moves 0.15 USDC from the agent wallet `0xD25E…c1BF` to the service wallet `0xCB4b…dFeC`. Test USDC has no monetary value. If the network fails, the console shows a REPLAY recorded from that same real testnet run, labelled on screen.

### Q16. Does it scale? *(Victor)*
The engine is stateless and deterministic, so it scales horizontally on serverless workers. The only shared state is receipts and idempotency keys in a small store. Batch work goes through `/audit` (up to 50 entries per call). The main question is payment volume: one on-chain settlement per call is fine at PoC scale, and prepaid credit packs (planned) would reduce the number of transactions for high-volume customers. We would measure this in a pilot rather than claim figures now.

---

## Rapid-fire extras (one sentence each)

- **"Can the agent overspend?"** No. Its spending policy (max 0.20 USDC per call, 2.00 per day) is plain code checked before any signature, and scenario 90 on `/live` shows it refusing a 1.00 USDC audit: no payment, no call to the paid endpoint, escalated to a human.
- **"Who pays the gas?"** The facilitator; the agent wallet only needs USDC.
- **"What if the call fails?"** The payment is settled only after a successful response, so the agent pays nothing.
- **"What if the facilitator is down?"** The paid call fails before settlement (nothing is charged), and the console falls back to REPLAY.
- **"Why French rules only?"** The reform creates the urgency in France and Ajean's expertise is French; the same model can extend to other EU e-invoicing regimes later.
- **"Does it use AI at all?"** Only where rules cannot decide: an optional LLM extracts unstructured PDFs and classifies ambiguous descriptions. The live demo runs without one (`llm_configured: false`), on structured invoices.
