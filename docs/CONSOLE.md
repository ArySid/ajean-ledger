# Demo console (UI)

The console is **not the product**: it is a window into agent-to-agent traffic. Everything it shows is
what an AI agent sent to, paid and received from the Ajean Ledger API. Plain CSS (`app/globals.css`),
inline SVG, no UI library, no external font or CDN. It is dark, readable on a projector (18 px base) and
works from 1280×720 down to mobile.

## Pages

| Route | File | What it shows |
|---|---|---|
| `/` | `app/page.tsx` | Pitch, "Built for agents, not humans", 4-step x402 flow diagram (`components/FlowDiagram.tsx`), a real request/response excerpt (taken from replay 03), pricing table (`components/PricingTable.tsx`, prices read from `lib/payments/pricing.ts`), discovery links (`/llms.txt`, `/openapi.json`, `/.well-known/agent.json`, `/api/v1/catalog`, `/mcp`), team and PoC disclaimer. |
| `/live` | `app/live/page.tsx` → `components/live/LiveConsole.tsx` | Live Agent Console. Left: the agent's timeline (`TraceStepItem.tsx`), revealed step by step, with kind badges, inline x402 highlights and an expandable raw HTTP exchange (headers, base64 `PAYMENT-*` headers decoded to JSON, pretty body). Right: the structured result (`ResultPanel.tsx`): compliance pill, review banner, anomalies, mini-ledger with totals and "balanced ✓", VAT treatment, explanation, checks (failed first), receipt with tx hash (explorer link, or a "SIMULATED tx" label). |
| `/operator` | `components/operator/OperatorDashboard.tsx` | KPIs (calls, USDC earned, average price per call, % needing human review), revenue per endpoint (CSS bars), recent transactions (time, endpoint, payer wallet, amount, tx hash link, mode). |
| `/office` | `app/office/page.tsx` | Small CSS-only nod to Ajean's virtual office (agents arrive, pay, leave with a document). No JS. |

### `/live` controls
- **Scenario**: 01 compliant office supplies, 03 restaurant VAT 20% instead of 10%, 04 intra-EU consulting services (reverse charge), 06 duplicate of 01, and **90 · Audit request 1.00 USDC > max_per_call 0.20 → REFUSED by policy** (`lib/console/scenarios.ts`, `kind: "policy_refusal"`). Scenario 90 runs the real agent policy path: it reads the catalog, sees `/api/v1/audit` at 1.00 USDC, refuses before any payment (`outcome: "refused_by_policy"`, no POST to the paid endpoint, nothing signed) and escalates to a human. The result column then shows a red **REFUSED BY POLICY — no payment made** panel (price vs limit, spent today unchanged, the HTTP calls actually made, the escalation message) instead of an entry.

### Result panel semantics (Phase 5 review m3, m4, m9)
- **Compliance chip = invoice mentions only.** The engine's `compliance.status` is unchanged: it covers the mandatory
  invoice mentions (e-invoicing / commercial-code rules). VAT and accounting problems are `anomalies` and drive
  `human_review_required`. The chip therefore reads **"Invoice mentions: compliant"**, and a separate amber
  **"VAT anomaly: VAT_RATE_MISMATCH"** chip appears when the engine reports one (fixture 03).
- **VAT panel = what was booked.** `vatSummary()` (`lib/console/format.ts`) reads the entry lines on 4456x (deductible)
  and 4452 (self-assessed due), the invoice totals, `vat.breakdown` and the `VAT_RATE_MISMATCH` anomalies. Fixture 03:
  "Deductible: partly · Invoiced 146.00 + VAT 29.20 at 20% · Deductible VAT booked (44566) 14.60 EUR of 29.20 ·
  Not deducted 14.60 EUR → added to the expense (VAT legally due at 10%)". 01/06: 28.00 of 28.00. 04: no VAT invoiced,
  440.00 self-assessed, due 440.00 (4452) = deductible 440.00 (44566), net 0.00.
- **No "incl. VAT" for an invoice without VAT**: 04 reads "2,200.00 EUR total payable to the supplier · reverse charge:
  VAT self-assessed"; an exempt invoice reads "…, no VAT invoiced" (same wording in the engine explanation and the
  agent's intake text).
- The 402 step's `requirements_check` renders as `amount ✓ / asset (USDC) ✓ / network ✓ / payTo ✓ / scheme ✓`; long chip
  values wrap inside the card. "s of agent time" is hidden under 0.1 s (replays recorded on localhost).
- **TESTNET / SIMULATED**: payment mode of live runs. The **server** decides how agents pay (`PAYMENT_MODE`), so on
  load the console reads `GET /api/health` (`fetchServerMode`) and selects the deployment's mode; the other button
  is disabled with a tooltip ("this deployment runs in … mode; REPLAY always works"). If health is unreachable both
  stay enabled and the badge after a run shows the real mode.
- **Run scenario**: live run through the demo agent (with automatic fallback, see below).
- **Replay recorded run**: plays a stored trace directly.
- **Speed** (0.5× to 4×) and **Skip animation**.
- **Mode badge**, always visible: TESTNET (green, real test USDC), SIMULATED (violet, mock facilitator), REPLAY (grey, recorded run).
  Hovering it shows what the mode means; **clicking it (ⓘ)** opens a legend of all three modes and says which mode
  this deployment runs (texts in `lib/console/modes.ts`, shared by the badge tooltip and the legend).
- While a live call is pending: an elapsed counter (timeout 45 s) and a **Use recorded run now** button.
- Presenter URL shortcuts: `/live?scenario=03&autoplay=replay&speed=2`, `&autoplay=run&mode=simulated`, `&skip=1`.

## Data sources and fallback ladder

All `/live` data access goes through **one module**, `lib/console/source.ts`. It never throws.

```
runScenario(scenario, mode)                       loadReplay(scenario)
  1. POST /api/demo/run {scenario, mode}            1. GET /api/demo/replays?scenario=XX  (4 s timeout)
     timeout 45 s → AgentTrace (live)               2. static import demo/replays/XX.json (always works)
  2. on ANY failure → loadReplay(scenario)
     + notice "Live call failed → showing recorded run (REPLAY)"
```

"Any failure" = network error, timeout, non-2xx, a payload that is not an `AgentTrace`, or a trace
with `outcome: "error"`. The notice's `reason:` names the cause (Phase 7 review M3): the failing step of an
error trace (`agent run ended in error: <title>: <detail> [last HTTP 503]`), or the HTTP status with the
server's code (`HTTP 429 DEMO_BUSY from /api/demo/run`). `/api/demo/run` itself retries once a failure
that happened before any payment was signed (docs/AGENT.md). Replays are always displayed with `mode: "REPLAY"`, and the notice line says
where the trace came from (replay API or bundled file), when it was recorded and whether it is a sample.

The API returns the whole trace at once; the console animates it client side (it does not need a stream).

`/operator` uses `lib/console/stats.ts`:
1. `GET /api/v1/operator/stats` (5 s timeout);
2. if it fails, has an unexpected shape, or reports **0 calls** (fresh deployment), the stats are
   computed from the bundled replays and labelled **"source: recorded replays"**.
3. The API counts the deployment's **current payment mode only** (Phase 7 review M2): a TESTNET deployment
   never adds simulated calls to "Paid calls served" / "USDC earned"; a note above the tiles says
   "showing TESTNET calls only (N simulated calls hidden)" when the store holds calls of the other mode.

## How replays are loaded

`lib/console/replays.ts` statically imports `demo/replays/01.json`, `03.json`, `04.json`, `06.json`. They
are bundled into the page, so `/live` (Replay) and `/operator` work with no backend at all, including on
a static host.

The current files (`demo/replays/01|03|04|06|90.json`) are **recorded from real runs of the demo agent against a SIMULATED server**
(`recorded_from: "simulated"`, simulated `0x5151…` tx hashes, no explorer link; `npm run record:replays`). Each scenario
is recorded from a fresh spend ledger and mock ERP, like a live `/api/demo/run`, so every entry replay shows
"Spent today 0.15 / 2.00"; replay 90 has no payment and no `result`.
Once the agent wallet is funded they are re-recorded against the TESTNET deployment (`docs/HOSTING.md` §7). They follow the x402 v2 wire format (`PAYMENT-REQUIRED`,
`PAYMENT-SIGNATURE`, `PAYMENT-RESPONSE` as base64 JSON, `eip155:84532`, 150000 atomic units, test
USDC `0x036C…CF7e`, payTo `0xCB4b…dFeC`, agent `0xD25E…c1BF`) and the receipt shape of
`lib/payments/receipt.ts`. Overwrite them with real recorded runs (same file names, `AgentTrace` JSON);
nothing else needs to change. A real testnet receipt (`mode: "testnet"`, `explorer_url` set) shows a
Base Sepolia explorer link instead of the "SIMULATED tx" label.

The tx label is decided **per hash**, never per page (`stepTxExplorerUrl` / `txExplorerUrl` in
`lib/console/format.ts`, Phase 7 review M1): `explorer_url` wins; `simulated: true`, `mode: "simulated"` or a
`0x5151…` hash (simulated facilitator) means SIMULATED; any other 32-byte hash is a real Base Sepolia tx and
gets `https://sepolia.basescan.org/tx/<hash>` even when `explorer_url` is missing. The agent's ERP step now
carries `explorer_url` and `simulated` too, and the recorded replays' ERP steps were patched with the same
fields (amounts untouched).

## Contracts the other workstreams provide

| Endpoint | Request | Response |
|---|---|---|
| `POST /api/demo/run` | `{"scenario": "01"\|"03"\|"04"\|"06"\|"90", "mode": "testnet"\|"simulated"}` | `AgentTrace` (`lib/trace/types.ts`), or `{trace: AgentTrace}`. `mode` = `TESTNET`/`SIMULATED`. `result` = the `/api/v1/entry` body (EntryResult + `request_id` + `receipt`); absent for 90 (`outcome: "refused_by_policy"`, which the console shows as a result, not as a failure). Must answer within 45 s. |
| `GET /api/demo/replays?scenario=XX` | — | `AgentTrace` (or `{trace}` / an array of traces). Optional: without it the bundled files are used. |
| `GET /api/v1/operator/stats` | — | Either `{calls, usdc_earned, by_endpoint:[{endpoint, calls, usdc}], recent:[{request_id, at, endpoint, payer, amount, tx_hash, explorer_url, mode, human_review_required?}], source, review_required?}` or the store's `StoreStats` (`calls_served`, `revenue_per_endpoint`, `recent_transactions`, `store`). The "% needing human review" KPI uses an exact count, never an extrapolation: `review_required` (over all calls), else `review_window: {calls, review_required}` (what `/api/v1/operator/stats` returns, counted over the store's recent window, "x of the last N calls"), else `recent[].human_review_required`. With none of them the tile is hidden. |
| `/llms.txt`, `/openapi.json`, `/.well-known/agent.json`, `/api/v1/catalog`, `/mcp` | — | Linked from the landing page. |

Timeline rendering relies on `TraceStep.kind`, `title`, `detail`, `t_ms`, `http` (`method`, `url`,
`status`, `headers`, `body`, `decoded`) and, for chips, these `data` keys: policy (`decision`,
`code`, `price_usdc`, `max_per_call_usdc`, `spent_today_usdc`, `daily_budget_usdc`), payment (`amount_usdc`,
`from`, `to`…), settlement (`tx_hash`, `explorer_url`, `request_id`), erp (`erp_file`, `status`,
`journal`, `reference`, `lines`), review (`review_reasons`). The result panel appears when the first
`http_response` with status 200 on a POST is revealed (for a policy refusal, after the last step).

## Verification

- `npx vitest run tests/console.test.ts`: replays are valid and balanced, x402 headers decode, and every
  rung of the fallback ladder (network failure, timeout, HTTP 5xx such as a Cloudflare 1102, 429, a trace with
  `outcome: "error"`, replay API, live, malformed payload), the stats normaliser, the mode legend and
  `fetchServerMode`.
- Fallbacks checked in Phase 6: live run fails → REPLAY automatically (`tests/console.test.ts`); `/operator` with an
  empty store → replay-derived stats (`tests/agent.test.ts`, and `npm run warmup` shows `store=replay` on a fresh
  server); API with a failing store → memory, the paid call still returns 200 + receipt (`tests/api.test.ts`).
- Screenshots at 1280×720 in `docs/screenshots/` (`landing.png`, `live-replay-03.png`,
  `live-402-expanded.png`, `live-run-fallback-04.png`, `operator.png`, `office.png`, `mobile-live.png`).
