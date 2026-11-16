# Ajean Ledger — Live Demo Script (2–3 min)

> **Final.** Checked on 2026-11-16 against the live deployment: `/api/health` reports `payment.mode: "testnet"`; `/live` lists scenarios 01, 03, 04, 06 and 90; the recorded run of 03 is from a real testnet run. Amounts come from `npm run -s engine -- fixtures/03.json` and `demo/replays/03.json`.
> **Public URL:** <https://ajean-ledger.ary-sidoun.workers.dev> · **Mode on the day:** TESTNET (real x402 payments in test USDC on Base Sepolia) · **Data:** synthetic only · **Hosting:** Cloudflare Workers (free plan).

**The team still has to decide these placeholders:**

| Placeholder | What to decide |
|---|---|
| `{{NARRATOR}}`, `{{DRIVER}}`, `{{BACKUP}}` | Who talks, who clicks, who holds the backup laptop (suggestions below) |
| `{{BACKUP_VIDEO_PATH}}` | Where the backup screen recording is stored on both laptops (record it after the evening-before warmup) |
| `{{OPERATOR_RESET_DECISION}}` | Show cumulative `/operator` figures, or reset them before the demo (see the checklist) |
| `{{CODE_WORD}}` | The word the narrator says to make the driver switch to REPLAY |

## The one story

*Atelier Lumenor SAS (fictional)* uses a purchasing agent. A restaurant invoice lands in its inbox. The agent does not know French VAT rules, so it pays Ajean Ledger **0.15 USDC in one HTTP exchange**. It gets back a correct, balanced entry **plus a warning a human would probably have missed**: the meal was billed at 20% VAT instead of 10%.

No detours: one invoice, one payment, one result. Scenario **03 · Restaurant VAT anomaly**, with **90 · policy refusal** as an option.

## Roles

| Role | Who | Does |
|---|---|---|
| **Narrator** | {{NARRATOR}} (suggested: Ary) | Talks, faces the jury, never touches the laptop |
| **Driver** | {{DRIVER}} (suggested: Victor) | Clicks, zooms and scrolls on the narrator's cue |
| **Backup** | {{BACKUP}} (suggested: Yoann) | Second laptop open on `/live`, replay of 03 loaded; phone hotspot ready |

## Tabs open before you start (in this order)

1. `https://ajean-ledger.ary-sidoun.workers.dev/live?scenario=03`: scenario **03 · Restaurant VAT anomaly** selected, badge **TESTNET**. The console reads the mode from the server; the SIMULATED button is greyed out on a testnet deployment. Clicking the badge (ⓘ) opens the legend of the three modes.
2. `https://ajean-ledger.ary-sidoun.workers.dev/operator`
3. Basescan, service wallet: `https://sepolia.basescan.org/address/0xCB4b84079B1dd19828c3d5733f9e0D2DcB26dFeC` (token transfers tab)
4. Proof tab, kept for Q&A: the recorded scenario 03 payment, `https://sepolia.basescan.org/tx/0xc1554772f5b9cef69564f6f621d1a12ae5af113d1723cceeec685b28e5b23586` (0.15 USDC, agent `0xD25E…c1BF` → service `0xCB4b…dFeC`)
5. `https://ajean-ledger.ary-sidoun.workers.dev/` (landing; open it only if a jury member asks for the overview)

## Timed script (≈ 2:35)

| Time | Driver clicks | Narrator says (approx.) | Expected screen |
|---|---|---|---|
| **0:00–0:15** | Nothing: `/live` is already on screen | "What you see is not our product. It is a window onto traffic between two machines. On the left is the purchasing agent of a fictional SME; on the right is what Ajean Ledger sends back. No human is in the loop." | Empty split view, badge **TESTNET**, scenario "03 · Restaurant VAT anomaly" |
| **0:15–0:35** | Click **▶ Run scenario** | "A restaurant invoice has just arrived in the agent's inbox. The agent knows nothing about French VAT. It reads our free catalog, sees the price, 0.15 USDC, and checks it against the budget its operator gave it." | Timeline: `GET /api/v1/catalog` → 200, `GET /api/health` → **TESTNET**, **Spending policy check: ALLOW** ("Price 0.15 USDC ≤ max per call 0.20 USDC … ≤ daily budget 2.00 USDC → allowed") |
| **0:35–0:55** | Point at the 402 step (zoom if needed) | "It calls the entry endpoint. Our server answers **402 Payment Required**, with the price, the asset, the network and our address, all machine-readable. There is no account and no API key: payment is the authentication." | `POST /api/v1/entry` → **402**, decoded `PAYMENT-REQUIRED`: 0.15 USDC, atomic `150000`, network `eip155:84532`, payTo `0xCB4b…dFeC`, "amount ✓ / asset ✓ / network ✓ / payTo ✓" |
| **0:55–1:20** | Wait for the 200 (settlement takes a few seconds), then click the **tx hash** link | "The agent signs a USDC transfer and retries. We verify it, run the engine, and only then settle, so an agent is never charged for a failed call. Here is the transaction, on-chain on Base Sepolia." | `PAYMENT-SIGNATURE` → **200** + `PAYMENT-RESPONSE`, step **Payment settled: 0.15 USDC on Base Sepolia**; the explorer opens a 0.15 USDC transfer to `0xCB4b…dFeC` |
| **1:20–2:00** | Back to `/live`, point at the right panel: the ledger lines, then the amber chip | "In return, the agent gets an entry an accountant can read and a machine can post. It goes in the purchase journal: the meal as a reception expense, and the supplier credited for the full 175.20. It balances. And here is the point: a restaurant meal is 10% VAT, not 20%. Only the VAT legally due is deductible, so only 14.60 goes to 44566. The excess stays in the expense until the supplier sends a corrected invoice, and the case goes to a human." | Mini ledger: debit `6257` **160.60** (146.00 + 14.60 excess VAT), debit `44566` **14.60**, credit `401BOUCHON` **175.20**, balanced; chips "Invoice mentions: compliant" and amber "VAT anomaly"; `VAT_RATE_MISMATCH` ×2 (13.60 on the meal + 1.00 on the coffees); `human_review_required: true`; confidence 0.86 |
| **2:00–2:20** | Point at the last timeline lines, then switch to the `/operator` tab | "The agent posts the entry to its ERP and flags this one invoice for review. On our side, the operator view shows one more call served and 0.15 USDC earned. There is no invoice to send and nothing to collect." | **ERP: entry HA LBL-2026-1187 posted (flagged for review)**, **Human review requested: VAT_RATE_MISMATCH**; `/operator`: newest transaction at the top with a **testnet** pill and a Basescan link |
| **2:20–2:35** | Back to `/live` | "One HTTP request, 15 cents, a compliant entry, and the only invoice a human needs to look at. That is an accounting service built for agents." | The full run on one screen |

That leaves **25 s of slack** within 3 minutes. Do not say a number that is not on screen.

**Optional: scenario 90 (≈ 15 s, only with slack, or in Q&A when someone asks "can the agent overspend?").** Select **90 · Audit request 1.00 USDC > max_per_call 0.20 → REFUSED by policy**, tick **Skip animation**, click **▶ Run scenario**. Narrator: "The CFO asks the same agent for a batch audit. Our catalog says 1.00 USDC, but its operator capped it at 0.20 per call. It refuses before paying anything and asks a human." Screen: a red **REFUSED BY POLICY — no payment made** panel, the policy step "Price 1.00 USDC > max per call 0.20 USDC", only `GET /api/v1/catalog` and `GET /api/health` calls, 0.00 USDC spent. This scenario signs nothing, so it costs nothing and works in any mode.

> At the end of a run the timeline scrolls to the last step. To point at the 402 step at 0:35, the driver scrolls the left column back up, or ticks **Skip animation** before running.

## Fallback ladder (one click per level; never debug on stage)

The deployment runs **one** payment mode, set by the server and not by the browser. The ladder is therefore **TESTNET live → REPLAY**, and the console falls back **by itself**. Any live failure (network, no answer within 45 s, HTTP 5xx such as a Cloudflare CPU-limit error, rate limit, agent error) shows the recorded run with the yellow notice *"Live call failed → showing recorded run (REPLAY)"*, and the badge turns **REPLAY**.

| Level | Trigger | Driver action | Narrator line |
|---|---|---|---|
| **1. TESTNET live** (default) | — | — | — |
| **2. REPLAY of a real testnet run** (automatic or manual) | The yellow notice appears, or the 402 → 200 step takes more than **10 s** | Nothing if it is automatic. Otherwise click **Use recorded run now** (shown while waiting) or **⟲ Replay recorded run** | "The conference Wi-Fi is the one thing we don't control, so here is the same exchange recorded earlier today from the same agent, on the real testnet." The banner reads *"REPLAY · recorded from a testnet run on 16 Nov 2026, 11:55 UTC"*; its tx hash `0xc155…3586` opens on Basescan (tab 4). |
| **3. Backup laptop** | The public URL does not load at all | The backup laptop takes over: `/live` is already open with the replay of 03 loaded, and the replays are bundled in the page | Same line as level 2 |
| **4. Backup video** | No network and no working browser | Play `{{BACKUP_VIDEO_PATH}}`: a screen recording of a full TESTNET run of 03, made after the evening-before warmup | "Same run, recorded." Then move on to the slides. |

Rules: switch at the first sign of trouble; never retry the same level twice; whatever the level, finish the story (402 → payment → result → warning). If the deployment was rolled back to SIMULATED (`docs/HOSTING.md` §7), the badge reads **SIMULATED** and the tx hash is labelled fake. In that case say "simulated facilitator, same wire format" and skip the explorer click.

## Pre-flight checklist

### Day-J warmup (mandatory): `npm run warmup`

From the repo root (it needs `.env.local` with `AGENT_PRIVATE_KEY`), run it **the evening before** and again **1 hour before** the presentation:

```bash
npm run warmup -- --pay --expect-mode testnet
```

It targets the public URL by default. It checks the 17 things the demo needs: the pages, the discovery files, the 402 on the three paid endpoints, one paid `/api/v1/entry` call and its receipt, one full demo run of scenario 03, and the recorded replay of 03. It also warms the Cloudflare Worker isolates, so the jury's first click is not a cold start. It ends with a banner:

- **`✔ READY FOR DEMO`**: nothing to do.
- **`✖ NOT READY`**: the red lines say why. Fix it, or decide on the spot to start the demo on REPLAY and tell the narrator.

`--pay` spends test USDC only: **0.15** for the direct paid call plus **0.15** for the demo run paid by the Worker's agent (same agent wallet), so **0.30 test USDC** per warmup. Without `--pay`, the two paid checks are skipped (shown as `skip`), but the 402s, pages and replay are still checked.

- [ ] Evening before: `npm run warmup -- --pay --expect-mode testnet` → READY FOR DEMO (fix any failure that evening)
- [ ] T-1h: same command → READY FOR DEMO
- [ ] If the T-1h warmup says NOT READY: start the demo on REPLAY and tell the narrator

### The evening before

- [ ] The agent wallet holds at least **3 test USDC** (`npm run pay:testnet -- --check-balance`; top up at <https://faucet.circle.com>, Base Sepolia). Warmup 0.30 + rehearsals 0.15 per run.
- [ ] Two full rehearsals of 03 on the public URL, in TESTNET, back to back, timed against the card below
- [ ] **⟲ Replay recorded run** on 03 plays, and its tx hash opens on Basescan
- [ ] The policy shown on screen matches the script (`max_per_call` 0.20, `daily_budget` 2.00)
- [ ] The Worker's demo agent counts its spend in memory per isolate against 2.00 USDC a day (about 13 paid runs). After a heavy rehearsal day a run may say "refused by policy": a redeploy resets it (`docs/HOSTING.md` §7, notes)
- [ ] Backup video recorded and copied to both laptops: `{{BACKUP_VIDEO_PATH}}`
- [ ] `/operator`: {{OPERATOR_RESET_DECISION}}. The totals are cumulative and include the SIMULATED calls made before the testnet switch; each row has a **testnet** / **simulated** pill. To reset, delete the KV keys `ajean:stats` and `ajean:recent` with wrangler (team decision, needs Cloudflare access). Otherwise the narrator talks only about the newest row ("+1 call, +0.15 USDC").

### At the venue (T-15 min)

- [ ] Laptop plugged in, display mirrored, resolution checked on the projector
- [ ] Browser zoom 125–150%, notifications and sleep off, bookmarks bar hidden
- [ ] The tabs above open in order; `/live` shows **TESTNET** with scenario 03 selected
- [ ] Venue Wi-Fi tested on the public URL; phone hotspot ready as a second network
- [ ] Backup laptop open on `/live`, replay of 03 loaded
- [ ] One dry run of scenario **01** (0.15 test USDC), so 03 stays fresh for the jury; then reload `/live?scenario=03`

### Right before going on stage

- [ ] The driver and narrator agree on the code word for "switch to REPLAY": {{CODE_WORD}}
- [ ] The narrator has the timing card: **0:15** run · **0:35** 402 · **0:55** payment · **1:20** result · **2:00** operator · **2:20** close
