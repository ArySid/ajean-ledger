# Ajean Ledger — Q&A Preparation

> **First draft.** 12 likely jury questions, with short answers (say them in 20–30 seconds). Rule for the whole team: **no figure we cannot compute from our own prices or clearly call an assumption.** If you don't know, say what we would check and how.
> Suggested owner per question in brackets; adjust to the team.

---

### Q1. Why would an agent pay instead of just asking an LLM? *(Leo)*
An LLM can propose an entry, but it cannot guarantee it: it may invent an account, apply the wrong VAT rate or miss a mandatory mention, and it gives no stable reference for why. We return a deterministic, balanced entry with stable `rule_id`s, a confidence score and an explicit `human_review_required` flag. For 0.15 USDC the agent buys certainty it can act on, and a trace its operator can audit. In the demo, the 20% vs 10% restaurant VAT is exactly the kind of error a generic model books without a warning.

### Q2. Why stablecoins rather than card payments? *(Yoann)*
Three reasons. Micropayments: card fixed per-transaction fees are of the same order as, or higher than, a 0.05 USDC call. Autonomy: an agent cannot hold a card, sign up or pass 3-D Secure, but it can hold a wallet with a spending policy set by its operator. Settlement: x402 settles in seconds, with no chargebacks and no invoice to collect. USDC is dollar-denominated; EURC would let euro-based clients pay in euros.

### Q3. Who is liable if the entry is wrong? *(Ary)*
The output is a proposal, not certified bookkeeping: every response carries a confidence score, the rules applied and `human_review_required` for ambiguous cases, and the service is labelled "not a substitute for a chartered accountant's review". The operator (SME or accounting firm) remains responsible for its books; keeping accounts for third parties is a regulated profession in France (experts-comptables), which is why we position Ajean Ledger as a tool, not as an accounting service. In production: terms of use with a liability cap, versioned rules, and a full trace per call (request id, rules, engine version) to investigate any dispute.

### Q4. Why can't Pennylane (or Dext) do this? *(Leo)*
They could technically build it; they have strong accounting products. Their model is different: software for human users with accounts and subscriptions, organised around their own customers' ledgers. Ours is a per-call function any agent can discover and pay for in one HTTP exchange, with no account. We are complementary: our output is plain JSON and can feed Pennylane, another accounting tool or an ERP. Our bet is on distribution to agents, not on replacing accounting platforms.

### Q5. What happens on mainnet? *(Victor)*
Technically little changes: the network moves from Base Sepolia (`eip155:84532`) to Base mainnet (`eip155:8453`), the asset becomes real USDC, and we use a production facilitator (a hosted one or our own). The code path is the same; that is why we used the x402 SDK instead of custom logic. The real work is non-technical: terms of use, a regulated provider to convert stablecoins to euros, accounting and tax treatment of stablecoin receipts, and a legal check of our positioning, to be validated with counsel and our auditor before going live.

### Q6. GDPR and data retention? *(Yoann)*
Invoices can contain personal data (sole traders, names, addresses), so we apply data minimisation: the invoice is processed in memory, and we store only what the receipt and idempotency need (request id, price, tx hash, result) for a limited period ({{RETENTION_PERIOD — to be decided, e.g. 30 days}}). Nothing from the invoice goes on-chain: the blockchain only sees a wallet address and an amount. The optional LLM layer is a subprocessor, used only for unstructured documents. In the PoC all data is synthetic and the companies are fictional.

### Q7. How does an agent find the service? *(Victor)*
Through free, machine-readable files: `/api/v1/catalog` (services and prices), `/openapi.json`, `/llms.txt` and `/.well-known/agent.json`, plus an MCP server with three tools (`check_invoice`, `create_entry`, `audit_entries`) that Claude Desktop or any MCP client can connect to. The 402 response itself is self-describing: price, asset, network and recipient. Next step: listing in agent and x402 discovery directories, and integration by SaaS publishers whose agents already process invoices.

### Q8. How did you set the prices? *(Yoann)*
By value tier: a compliance check (0.05) is the cheapest, a full entry with VAT and anomalies (0.15) is the core product, and an audit of up to 50 entries with two expert viewpoints (1.00) costs 0.02 per entry. On structured inputs the marginal cost is very low, because the engine is deterministic; the LLM only runs on unstructured documents. Example: 20,000 invoices a month at 0.15 is 3,000 USDC. These are PoC list prices, to be tested in pilots, with credit packs (10 → 12 USDC) for volume.

### Q9. What stops a malicious agent? *(Victor)*
Payment itself: every paid call costs money, which limits abuse, and each EIP-3009 authorisation has a nonce, so a payment cannot be replayed. On top of that: rate limiting, payload size limits, strict schema validation and machine-readable errors. Prompt injection hidden in an invoice cannot change the result, because the LLM only extracts fields and the rules engine decides accounts, amounts and VAT. Payment is settled only after a successful response, so honest agents are never charged for errors.

### Q10. How accurate is it, and how do you validate it? *(Ary)*
Rules first, LLM second. Accounts, amounts and VAT come from deterministic tables (PCG mapping, VAT rates 20 / 10 / 5.5 / 2.1%, regimes including intra-EU reverse charge, mandatory mentions); debits always equal credits. The LLM is used only for extraction and classification, and the response says so (`extraction_method: "llm"` with a confidence score). We test {{TEST_COUNT}} cases on 12 synthetic fixtures with expected outputs (reverse charge, credit note, fixed asset in 2183 with VAT in 44562, duplicate…). Legal references come only from a curated table reviewed by a qualified accountant. When unsure, the engine flags for review instead of guessing.

### Q11. Are you an e-invoicing platform (PDP / PA) under the reform? *(Ary)*
No, and we don't claim to be. Approved platforms (PA, formerly PDP) are registered with the tax administration to transmit e-invoices and e-reporting data; we transmit nothing to the administration. Ajean Ledger is a bookkeeping and compliance pre-check service: it analyses an invoice the agent already has, before issuing it or after receiving it, and returns the entry and the compliance status. It sits next to the PA in the chain, not in its place.

### Q12. Does it scale? *(Victor)*
The engine is stateless and deterministic, so it scales horizontally on serverless functions; the only shared state is receipts and idempotency keys in a small store. Batch work goes through `/audit` (up to 50 entries per call). The main scaling question is payment volume: one on-chain settlement per call is fine at PoC scale, and for high-volume customers prepaid credit packs reduce the number of transactions. We would measure this in a pilot rather than claim figures now.

---

## Rapid-fire extras (one sentence each)

- **"Is the demo real?"** The API, the MCP server and the testnet payments are real; the data is synthetic, and the SIMULATED and REPLAY modes are labelled on screen.
- **"Who pays the gas?"** The facilitator; the agent wallet only needs USDC.
- **"What if the call fails?"** The payment is settled only after a successful response, so the agent pays nothing.
- **"Why French rules only?"** The reform creates the urgency in France and Ajean's expertise is French; the same model can extend to other EU e-invoicing regimes later.
