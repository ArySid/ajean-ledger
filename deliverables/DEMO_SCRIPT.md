# Ajean Ledger — Live Demo Script (2–3 min)

> Checked against the Phase 6 build (screen labels, buttons, fixture 03 amounts = `npm run -s engine -- fixtures/03.json`). Remaining `{{...}}` placeholders are team decisions.
> Public URL: <https://ajean-ledger.ary-sidoun.workers.dev> · Network: Base Sepolia testnet · Data: synthetic only · Hosting: Cloudflare Workers (free plan).

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

1. `https://ajean-ledger.ary-sidoun.workers.dev/live?scenario=03`: scenario **03 · Restaurant VAT anomaly** selected, mode **TESTNET** (the console selects the deployment's mode by itself; hover the badge or open **ⓘ Modes** for the legend)
2. `https://ajean-ledger.ary-sidoun.workers.dev/operator`
3. Base Sepolia explorer (`https://sepolia.basescan.org`) for the service wallet `0xCB4b84079B1dd19828c3d5733f9e0D2DcB26dFeC`
4. `https://ajean-ledger.ary-sidoun.workers.dev/` (landing, only if a jury member asks for the overview)

## Timed script

| Time | Driver clicks | Narrator says (approx.) | Expected screen |
|---|---|---|---|
| **0:00–0:15** | Nothing: `/live` is already on screen | "What you see is not our product: it is a window onto traffic between two machines. On the left, the purchasing agent of a fictional SME. On the right, what Ajean Ledger sends back. No human is in the loop." | Empty split view, mode badge **TESTNET**, scenario "03 · Restaurant VAT anomaly" |
| **0:15–0:35** | Click **▶ Run scenario** | "A restaurant invoice has just arrived in the agent's inbox. The agent knows nothing about French VAT, so it first reads our free catalog, sees the price, 0.15 USDC, and checks it against the budget its operator gave it." | Left timeline: `GET /api/v1/catalog` → 200; step **Spending policy check: ALLOW**: "Price 0.15 USDC ≤ max per call 0.20 USDC … ≤ daily budget 2.00 USDC → allowed" |
| **0:35–0:55** | Point at the 402 step (zoom if needed) | "It calls the entry endpoint. Our server answers **402 Payment Required**: the price, the asset, the network and our address, all machine-readable. No account, no API key: payment is the authentication." | `POST /api/v1/entry` → **402**, `PAYMENT-REQUIRED` header decoded: amount `150000` (0.15 USDC), network `eip155:84532`, `payTo` |
| **0:55–1:20** | Wait for the 200, then click the **tx hash** link (opens explorer) | "The agent signs a USDC transfer and retries. We verify, run the engine, and only then settle: an agent is never charged for a failed call. Here is the transaction, on-chain, on Base Sepolia." | Retry with `PAYMENT-SIGNATURE` → **200** + `PAYMENT-RESPONSE`; explorer tab shows a 0.15 USDC transfer to the service wallet |
| **1:20–2:00** | Back to `/live`, point at the right panel: ledger lines, then the anomaly | "In return the agent gets an entry an accountant can read and a machine can post: purchase journal, the meal booked as a business expense, the supplier credited in 401 for the full amount. It balances. And here is the point: a restaurant meal is 10% VAT, not 20%. Only the VAT that is legally due is deductible, so only that goes to 44566; the excess stays in the expense until the supplier sends a corrected invoice, and the case goes to a human." | Mini ledger: debit `6257` 160.60 (146.00 + 14.60 excess VAT), debit `44566` 14.60, credit `401BOUCHON` 175.20, `balanced: true`; anomaly `VAT_RATE_MISMATCH` (warning); `human_review_required: true`; one-paragraph explanation |
| **2:00–2:20** | Point at the last log line, then switch to the `/operator` tab | "The agent posts the entry to its ERP and flags this one invoice for review. On our side, the operator view: the call served and 0.15 USDC earned, with no invoice to send and nothing to collect." | Timeline: **ERP: entry HA LBL-2026-1187 posted (flagged for review)**, then **Human review requested: VAT_RATE_MISMATCH**; `/operator`: calls served +1, revenue +0.15 USDC, last transaction at the top |
| **2:20–2:35** | Back to `/live` | "One HTTP request, 15 cents, a compliant entry, and the only invoice a human needs to look at. That is an accounting service built for agents." | Full run visible on one screen |

Total: about **2:35**, which leaves 25 seconds of slack within 3 minutes.

> Amounts above are the fixture 03 engine output after the Phase 1 review fix (ADR-018): 6257 160.60 / 44566 14.60 / 401BOUCHON 175.20. Do not say a number on stage that is not on screen.

## Fallback ladder (each step is one click; never debug on stage)

The public deployment runs **one** payment mode (`PAYMENT_MODE`, chosen by us, not by the browser), so the ladder is TESTNET → REPLAY. The console falls back **by itself**: any live failure (network, timeout after 45 s, HTTP 5xx such as a Cloudflare CPU-limit error, rate limit, agent error) shows the recorded run with a yellow notice *"Live call failed → showing recorded run (REPLAY)"* and the badge turns **REPLAY**.

| Level | Trigger | Driver action | Narrator line |
|---|---|---|---|
| **1. TESTNET** (default) | — | — | — |
| **2. REPLAY (automatic or manual)** | The yellow notice appears, or the 402 → 200 step takes more than **10 s** | Nothing if automatic; otherwise click **Use recorded run now** (while waiting) or **⟲ Replay recorded run** | "The conference Wi-Fi is the one thing we don't control, so here is the same exchange recorded from a real testnet run: same requests, same 402, same payment, with its real transaction hash you can check on the explorer afterwards." |
| **3. Backup laptop** | The public URL does not load at all | Backup laptop takes over, already on `/live` with a replay loaded (works offline once the page is open: replays are bundled in the page) | Same line as level 2. |
| **4. Last resort** | No network and no browser | Play the backup screen recording `{{BACKUP_VIDEO_PATH}}` | "Same run, recorded." Then move on to the slides. |

If the deployment is still in SIMULATED mode on the day (testnet go-live not done), the badge says **SIMULATED** and the tx hash is labelled fake: say "simulated facilitator, same wire format" instead of "on-chain", and skip the explorer click.

Rules: switch at the first sign of trouble; never retry the same mode twice; whatever the level, finish the story (402 → payment → result → warning).

## Pre-flight checklist

### Day-J warmup (mandatory)

Run **`npm run warmup -- --pay --expect-mode testnet`** from the repo root twice: the **evening before** and **one hour before** the presentation (on a SIMULATED deployment: plain `npm run warmup`).
It targets the public URL by default (<https://ajean-ledger.ary-sidoun.workers.dev>), checks the 17 things the demo needs (pages, discovery files, the 402 on the three paid endpoints, one paid `/api/v1/entry` call, its receipt, one full demo run of scenario 03 and its recorded replay) and warms the Cloudflare Worker isolates so the first live click is not a cold start. It ends with a banner:

- **`✔ READY FOR DEMO`** → nothing to do.
- **`✖ NOT READY`** → the failed lines say why; fix it, or decide right away to start the demo on REPLAY and tell the narrator.

With `--pay` on a TESTNET deployment it spends 0.30 test USDC (one paid call + one demo run). Running it, plus two full rehearsals, stays far below the rate limits (120 paid calls and 30 demo runs per IP and minute).

- [ ] Evening before: `npm run warmup -- --pay --expect-mode testnet` → READY FOR DEMO (note any failure and fix it that evening)
- [ ] T-1h: same command → READY FOR DEMO
- [ ] If the T-1h warmup says NOT READY: start the demo on REPLAY and tell the narrator

### The evening before

- [ ] Agent wallet holds enough test USDC on Base Sepolia (at least 3 USDC: `npm run pay:testnet -- --check-balance`; top up from the Circle faucet `https://faucet.circle.com` if needed)
- [ ] `https://ajean-ledger.ary-sidoun.workers.dev/live` runs Fixture 03 end to end in TESTNET, twice in a row
- [ ] Replays re-recorded from the TESTNET deployment (`npm run record:replays -- --public`, see `docs/HOSTING.md` §7) and redeployed; **⟲ Replay recorded run** on 03 plays and its tx hash opens on the explorer
- [ ] Agent spending policy shown on screen matches what the narrator says (`max_per_call` 0.20, `daily_budget` 2.00)
- [ ] Backup screen recording `{{BACKUP_VIDEO_PATH}}` is on both laptops, offline
- [ ] Operator stats: decide whether to reset them before the demo or show cumulative figures ({{OPERATOR_RESET_DECISION}})

### At the venue (T-15 min)

- [ ] Laptop plugged in, display mirrored, resolution checked on the projector
- [ ] Browser zoom 125–150%, dark theme, notifications and sleep off, bookmarks bar hidden
- [ ] The 4 tabs above open in order; `/live` shows **TESTNET** with scenario 03 selected
- [ ] Venue Wi-Fi tested on `https://ajean-ledger.ary-sidoun.workers.dev`; phone hotspot ready as a second network
- [ ] Backup laptop open on `/live` in REPLAY mode
- [ ] One dry click on **▶ Run scenario** (scenario 01, so 03 stays fresh for the jury) to confirm the page answers; reload `/live?scenario=03`

### Right before going on stage

- [ ] Driver and narrator agree on the code word for "switch mode" ({{CODE_WORD}})
- [ ] Narrator has the timing card: 0:15 run · 0:35 402 · 0:55 payment · 1:20 result · 2:00 operator · 2:20 close
