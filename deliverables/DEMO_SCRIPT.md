# Ajean Ledger — Live Demo Script (2–3 min)

> **First draft.** Screen labels, button names and amounts must be checked against the final build (see the placeholders `{{...}}`).
> Public URL: `{{PUBLIC_URL}}` · Network: Base Sepolia testnet · Data: synthetic only.

## The one story

*Atelier Lumenor SAS (fictional)* uses a purchasing agent. A supplier restaurant invoice lands in its inbox. The agent does not know French VAT rules, so it pays Ajean Ledger **0.15 USDC in one HTTP exchange** and gets back a correct, balanced entry **plus a warning a human would probably have missed**: the meal was billed at 20% VAT instead of 10%.

No detours: one invoice, one payment, one result. Fixture: **03, restaurant invoice billed at 20% instead of 10%**.

## Roles

| Role | Who (suggested) | Does |
|---|---|---|
| **Narrator** | {{NARRATOR}} (suggested: Ary) | Talks, faces the jury, never touches the laptop |
| **Driver** | {{DRIVER}} (suggested: Victor) | Clicks, zooms, switches modes on the narrator's cue |
| **Backup** | {{BACKUP}} (suggested: Yoann) | Second laptop open on `/live` in REPLAY mode, phone hotspot ready |

## Tabs open before you start (in this order)

1. `{{PUBLIC_URL}}/live`: mode badge set to **TESTNET**, scenario **Fixture 03** pre-selected
2. `{{PUBLIC_URL}}/operator`
3. Base Sepolia explorer (`https://sepolia.basescan.org`) for the service wallet `{{SERVICE_PAY_TO_ADDRESS}}`
4. `{{PUBLIC_URL}}/` (landing, only if a jury member asks for the overview)

## Timed script

| Time | Driver clicks | Narrator says (approx.) | Expected screen |
|---|---|---|---|
| **0:00–0:15** | Nothing: `/live` is already on screen | "What you see is not our product: it is a window onto traffic between two machines. On the left, the purchasing agent of a fictional SME. On the right, what Ajean Ledger sends back. No human is in the loop." | Empty split view, mode badge **TESTNET**, scenario "Fixture 03 – restaurant invoice" |
| **0:15–0:35** | Click **Run scenario** | "A restaurant invoice has just arrived in the agent's inbox. The agent knows nothing about French VAT, so it first reads our free catalog, sees the price, 0.15 USDC, and checks it against the budget its operator gave it." | Left timeline: `GET /api/v1/catalog` → 200; agent log: "price 0.15 ≤ max_per_call {{MAX_PER_CALL}} · daily budget OK" |
| **0:35–0:55** | Point at the 402 step (zoom if needed) | "It calls the entry endpoint. Our server answers **402 Payment Required**: the price, the asset, the network and our address, all machine-readable. No account, no API key: payment is the authentication." | `POST /api/v1/entry` → **402**, `PAYMENT-REQUIRED` header decoded: amount `150000` (0.15 USDC), network `eip155:84532`, `payTo` |
| **0:55–1:20** | Wait for the 200, then click the **tx hash** link (opens explorer) | "The agent signs a USDC transfer and retries. We verify, run the engine, and only then settle: an agent is never charged for a failed call. Here is the transaction, on-chain, on Base Sepolia." | Retry with `PAYMENT-SIGNATURE` → **200** + `PAYMENT-RESPONSE`; explorer tab shows a 0.15 USDC transfer to the service wallet |
| **1:20–2:00** | Back to `/live`, point at the right panel: ledger lines, then the anomaly | "In return the agent gets an entry an accountant can read and a machine can post: purchase journal, the meal booked as a business expense, deductible VAT in 44566, the supplier credited in 401. It balances. And here is the point: a restaurant meal is 10% VAT, not 20%. Only the VAT that is legally due is deductible, so the agent is told to ask the supplier for a corrected invoice, and the case goes to a human." | Mini ledger, e.g. debit `{{MEAL_ACCOUNT, e.g. 6257}}` {{HT}}, debit `44566` {{VAT}}, credit `401…` {{TTC}}, `balanced: true`; anomaly `VAT_RATE_MISMATCH` (warning); `human_review_required: true`; one-paragraph explanation |
| **2:00–2:20** | Point at the last log line, then switch to the `/operator` tab | "The agent posts the entry to its ERP and flags this one invoice for review. On our side, the operator view: the call served and 0.15 USDC earned, with no invoice to send and nothing to collect." | Agent log: "posted to ERP · flagged for human review"; `/operator`: calls served +1, revenue +0.15 USDC, last transaction at the top |
| **2:20–2:35** | Back to `/live` | "One HTTP request, 15 cents, a compliant entry, and the only invoice a human needs to look at. That is an accounting service built for agents." | Full run visible on one screen |

Total: about **2:35**, which leaves 25 seconds of slack within 3 minutes.

> Amounts to fill from the final fixture 03 output: `{{HT}}`, `{{VAT}}`, `{{TTC}}`, `{{MEAL_ACCOUNT}}`. Do not say a number on stage that is not on screen.

## Fallback ladder (each step is one click; never debug on stage)

| Level | Trigger | Driver action | Narrator line |
|---|---|---|---|
| **1. TESTNET** (default) | — | — | — |
| **2. SIMULATED** | The 402 → 200 step takes more than **10 s**, or any payment error | Click the mode badge → **SIMULATED**, then **Run scenario** again | "The conference Wi-Fi is the one thing we don't control, so here is the same exchange with a simulated facilitator. The wire format is identical; the badge says SIMULATED and the hash is clearly fake." |
| **3. REPLAY** | The public URL does not load, or SIMULATED fails too | Click **Replay recorded run** (or the backup laptop takes over, already on REPLAY) | "Here is a real testnet run we recorded earlier, with its real transaction hash, which you can check on the explorer afterwards." |
| **4. Last resort** | No network and no browser | Play the backup screen recording `{{BACKUP_VIDEO_PATH}}` | "Same run, recorded." Then move on to the slides. |

Rules: switch at the first sign of trouble; never retry the same mode twice; whatever the level, finish the story (402 → payment → result → warning).

## Pre-flight checklist

### Day-J warmup (mandatory)

Run **`npm run warmup` twice**: the **evening before** and **one hour before** the presentation.
It calls the public URL, the database and one paid endpoint in **simulated** mode, to wake the whole stack (serverless functions, database, cache) so the first live call is not a cold start.

- [ ] Evening before: `npm run warmup` → all checks green (note any failure and fix it that evening)
- [ ] T-1h: `npm run warmup` → all checks green
- [ ] If the T-1h warmup fails: decide right away to start the demo in SIMULATED, and tell the narrator

### The evening before

- [ ] Agent wallet holds enough test USDC on Base Sepolia (at least {{MIN_TEST_USDC, e.g. 2}} USDC; top up from the Circle faucet `https://faucet.circle.com` if needed)
- [ ] `{{PUBLIC_URL}}/live` runs Fixture 03 end to end in TESTNET, twice in a row
- [ ] At least one recorded replay of Fixture 03 exists and plays (`demo/replays/`), and its tx hash opens on the explorer
- [ ] Agent spending policy shown on screen matches what the narrator says (`max_per_call` {{MAX_PER_CALL}}, `daily_budget` {{DAILY_BUDGET}})
- [ ] Backup screen recording `{{BACKUP_VIDEO_PATH}}` is on both laptops, offline
- [ ] Operator stats: decide whether to reset them before the demo or show cumulative figures ({{OPERATOR_RESET_DECISION}})

### At the venue (T-15 min)

- [ ] Laptop plugged in, display mirrored, resolution checked on the projector
- [ ] Browser zoom 125–150%, dark theme, notifications and sleep off, bookmarks bar hidden
- [ ] The 4 tabs above open in order; `/live` on TESTNET with Fixture 03 selected
- [ ] Venue Wi-Fi tested on `{{PUBLIC_URL}}`; phone hotspot ready as a second network
- [ ] Backup laptop open on `/live` in REPLAY mode
- [ ] One dry click on **Run scenario** in SIMULATED to confirm the page answers, then switch the badge back to TESTNET

### Right before going on stage

- [ ] Driver and narrator agree on the code word for "switch mode" ({{CODE_WORD}})
- [ ] Narrator has the timing card: 0:15 run · 0:35 402 · 0:55 payment · 1:20 result · 2:00 operator · 2:20 close
