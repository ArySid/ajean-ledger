# Hosting — Cloudflare Workers (free plan)

**Decision (user, final):** no Vercel. Host on a **free plan**, tested in this order, keeping the first that runs
the full demo from a public URL: **(1) Cloudflare Workers** via the OpenNext adapter, **(2) Netlify** as fallback.
No paid plan, testnet only, storage optional, no Supabase.

**Status (2026-11-16):** the repo builds for Workers and the **full demo runs in the local Workers runtime**
(workerd via `wrangler dev`, no account needed): every page, discovery file, MCP, 402 + paid x402 flow
(JSON, Factur-X PDF, UBL, audit ×50), receipts, `/api/demo/run` scenarios 01/03/04/06, KV store.
Deployment is pending a Cloudflare account (steps in §3).

| Item | Value |
|---|---|
| Adapter | `@opennextjs/cloudflare` **1.20.17** (pinned), `wrangler` ^4.162 — devDependencies |
| Config | [`wrangler.jsonc`](../wrangler.jsonc), [`open-next.config.ts`](../open-next.config.ts), [`scripts/cf-build.mjs`](../scripts/cf-build.mjs) |
| Public URL (after deploy) | `https://ajean-ledger.<your-subdomain>.workers.dev` |
| Runtime config | `vars` in `wrangler.jsonc` (`PAYMENT_MODE`, `X402_NETWORK`, `X402_FACILITATOR_URL`, `STORE_KIND`) + secrets via `wrangler secret put` |
| Storage | KV binding `AJEAN_KV` (optional, free) → else Neon (`DATABASE_URL`) → else memory + replay fallback |

## 1. Scripts

| Script | What it does |
|---|---|
| `npm run cf:build` | `next build` (standalone) → drops the browser paywall import → `opennextjs-cloudflare build --skipNextBuild` → empties the bundled `.env*` values → **secret scan** (fails if any secret-looking value from `.env*`/`.dev.vars` appears in `.open-next/`). |
| `npm run cf:preview` | Runs the built Worker locally in workerd on `http://localhost:8787` (no account). Run `cf:build` first. Local secrets: copy `.dev.vars.example` to `.dev.vars`. |
| `npm run cf:deploy` | `cf:build` then `opennextjs-cloudflare deploy` (needs `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`, or `wrangler login`). |
| `npm run cf:typegen` | Generates binding types into `.wrangler/types/cloudflare-env.d.ts` (gitignored, not part of `tsc`). |
| `npm run warmup [-- --url URL] [--pay]` | Day-J check + isolate warm-up of the public URL (default `PUBLIC_URL`, else `http://localhost:8787`). Green/red table with latencies, exit ≠ 0 on failure. Simulated deployment: pays with an **ephemeral** key. Testnet deployment: stops at the 402 unless `--pay` and `AGENT_PRIVATE_KEY` are set (spends 0.15 test USDC). |

`next dev` is unchanged. `CF_DEV=1 npm run dev` additionally exposes the Wrangler bindings (KV, vars) to `next dev`
through `initOpenNextCloudflareForDev()` (opt-in, so the other workstreams' dev servers are not affected).

## 2. Verified locally (workerd, `wrangler dev`)

`npm run warmup -- --url http://localhost:8787` → **15/15 green** in `PAYMENT_MODE=simulated`:
`/`, `/live`, `/operator`, `/api/health`, `/api/v1/catalog`, `/llms.txt`, `/openapi.json`, `/.well-known/agent.json`,
`/api/v1/operator/stats`, unpaid 402 on the 3 paid endpoints (with `PAYMENT-REQUIRED`), paid `POST /api/v1/entry`
→ 200 + receipt (`0x5151…`), `GET /api/v1/receipts/{id}`, `POST /api/demo/run` (03).
Also checked: paid Factur-X PDF (fixture 11, pdf-lib), UBL (13), invoice check, audit ×50; demo runs 01/04/06;
`POST /mcp tools/list`; browser 402 (`Accept: text/html`) returns x402's minimal HTML page; with
`--var PAYMENT_MODE:testnet` health reports `testnet` and the payTo from vars; with a local KV namespace the store
is `cloudflare-kv` and `/api/v1/operator/stats` reads the paid calls back from KV.

### Bundle size vs free-plan limit

| Build | Total upload (raw) | gzip |
|---|---|---|
| Plain OpenNext build | 18.1 MiB | 4.2 MiB |
| **`npm run cf:build`** (paywall dropped) | **11.1 MiB** | **2.3 MiB** |
| Free-plan limit (checked 2026-11-16, developers.cloudflare.com/workers/platform/limits) | **64 MiB uncompressed** ("there is no compressed size limit") | — |

The historical free limit was 3 MiB gzip: the optimised build fits that too. Startup (global scope) measured with
`wrangler check startup`: **~45 ms active CPU** locally, limit **1 s**.

What was big: `@x402/paywall` (7.6 MiB — browser wallet UI that `@x402/core` loads with a guarded
`import("@x402/paywall")`). `scripts/cf-build.mjs` replaces that import with a rejected promise, so x402 serves its
built-in minimal "Payment Required" HTML to browsers. **Trade-off:** a human opening a paid endpoint in a browser
gets a plain 402 page instead of a wallet-connect paywall. Agents are unaffected (they read the `PAYMENT-REQUIRED`
header + JSON body), and the console never uses the paywall. The rest is Next.js itself (~1 MiB), the app's own
chunks (viem, zod, pdf-lib, MCP SDK, engine) — no further split needed.

### Node APIs on workerd (`nodejs_compat`, compatibility date 2026-11-01)
- **fs**: no runtime route reads from disk. Fixtures, inbox items and replays used at runtime are **static JSON
  imports** (`agent/scenarios.ts`, `agent/replays.ts`, `lib/console/replays.ts`), so they are in the bundle;
  `outputFileTracingIncludes` is irrelevant on Workers. `fs` is only used by CLI/dev classes (`FileStore`,
  `FileErp`, `FileSpendLedger`, `fixtures/loader.ts`, `agent/inbox.ts#loadInbox`) that the routes never instantiate.
  `STORE_KIND=file` is refused on Workers (memory instead).
- **crypto** (`randomBytes`, `createHash`), **Buffer**, `fetch`, Web Crypto: OK (paid flow exercised end to end).
- **process.env**: populated from `vars` and secrets (OpenNext + `nodejs_compat`). Config is read at call time.
- **`.env*` files are NOT shipped**: OpenNext normally inlines `.env`/`.env.local` values into the Worker
  (`.open-next/cloudflare/next-env.mjs`); `cf:build` empties that file and scans the output (the wallet keys live in
  `.env.local`). Secrets go through `wrangler secret put` only.

## 3. Deploy (once a Cloudflare account exists)

1. **Account** (free, no card for Workers Free): <https://dash.cloudflare.com/sign-up>. Open **Workers & Pages**
   once so the account gets its `<subdomain>.workers.dev` (Workers & Pages → Settings / the onboarding screen).
2. **Account ID**: dashboard → Workers & Pages → right column "Account ID" (or `npx wrangler whoami`).
3. **API token**: <https://dash.cloudflare.com/profile/api-tokens> → *Create Token* → template **"Edit Cloudflare
   Workers"** → scope it to this account → create. It covers Workers scripts, KV and workers.dev routes.
4. **Environment** (terminal or this cloud session):
   ```bash
   export CLOUDFLARE_ACCOUNT_ID=<account id>
   export CLOUDFLARE_API_TOKEN=<token>      # never commit / print it
   npx wrangler whoami                      # sanity check
   ```
   From the Claude cloud session: the token can be stored with the session's secure credential form for host
   `api.cloudflare.com` (Authorization: Bearer); wrangler still needs `CLOUDFLARE_API_TOKEN` set — a dummy value is
   replaced by the proxy. `CLOUDFLARE_ACCOUNT_ID` is not secret.
5. **Optional storage (free KV)**:
   ```bash
   npx wrangler kv namespace create AJEAN_KV
   ```
   Paste the printed id into `wrangler.jsonc` (uncomment `"kv_namespaces": [{ "binding": "AJEAN_KV", "id": "…" }]`).
   Without it the app runs on the in-memory store (per isolate) and `/operator` falls back to recorded replays.
6. **First deploy (simulated mode, no secret needed)**:
   ```bash
   npm run cf:deploy        # → https://ajean-ledger.<subdomain>.workers.dev
   ```
7. **Secrets** (applied immediately, no redeploy). Pipe them from `.env.local` so nothing is printed:
   ```bash
   node -e 'process.loadEnvFile(".env.local");process.stdout.write(process.env.SERVICE_PAY_TO_ADDRESS)' | npx wrangler secret put SERVICE_PAY_TO_ADDRESS
   node -e 'process.loadEnvFile(".env.local");process.stdout.write(process.env.AGENT_PRIVATE_KEY)'      | npx wrangler secret put AGENT_PRIVATE_KEY
   # optional
   node -e 'process.loadEnvFile(".env.local");process.stdout.write(process.env.ANTHROPIC_API_KEY)'      | npx wrangler secret put ANTHROPIC_API_KEY
   ```
8. **Testnet mode**: set `"PAYMENT_MODE": "testnet"` in `wrangler.jsonc` `vars`, then `npm run cf:deploy`
   (switch back to `"simulated"` the same way). Testnet is the x402.org facilitator on Base Sepolia (test USDC only).
9. **Check**: `PUBLIC_URL=https://ajean-ledger.<subdomain>.workers.dev npm run warmup` (add `--pay` in testnet mode to
   spend 0.15 test USDC). Run it again ~5 minutes before presenting: it also warms the isolates.

## 4. Free-plan limits and their impact on the demo

| Limit (Workers Free) | Value | Impact |
|---|---|---|
| Requests | 100,000 / day (reset 00:00 UTC; then error 1027) | One `/api/demo/run` = 1 + ~4 self-requests (catalog, health, 402, paid call: `global_fetch_strictly_public` loops back through Cloudflare's front door). Static assets (`/_next/*`) are free and not counted. Ample. |
| CPU | **10 ms per request** (network waits excluded; "some built-in flexibility" for occasional overruns; else error 1102) | See §5. Warm requests fit; first request per isolate and audits of ~50 items can exceed. |
| Startup | 1 s | ~45 ms measured. |
| Worker size | 64 MiB uncompressed | 11.1 MiB. |
| Memory | 128 MB / isolate | OK. |
| Subrequests | 50 / invocation | Max ~5 (demo run), 2–3 (testnet facilitator verify/settle). |
| KV | 100k reads, **1,000 writes** / day, 1 GB | ~4 writes per paid call (receipt, idempotency key, recent list, counters) → ~250 paid calls/day. Eventually consistent (≤ 60 s across locations); counters are read-modify-write (a concurrent call can lose an increment — fine for a PoC dashboard). Any KV error (quota/429) → memory fallback (ResilientStore). |
| In-memory state | per isolate | Without KV, receipts/idempotency/rate-limit/simulated nonces live in one isolate and can vanish when it is recycled. Use KV for the public demo. |

## 5. CPU per request (10 ms budget)

Workers' CPU cannot be timed from inside workerd (timers only advance on I/O), so CPU was measured in Node 22 on
this container with `process.cpuUsage()` around in-process calls (all threads, so GC/JIT threads inflate it — an
upper bound). Cloudflare's CPUs differ; treat ±50 %. "Cold" = first call in a fresh process (lazy route init + JIT),
"warm" = median of 30–40 calls.

| Path | Cold | Warm median | p95 | Verdict |
|---|---|---|---|---|
| Engine `createEntry` fixtures 01–10, 12 (JSON) | 0.1–7 ms | 0.04–0.15 ms | ≤ 1.8 ms | OK |
| Engine `createEntry` 13 (UBL XML) | 3.0 ms | 1.4 ms | 13 ms | OK |
| Engine `createEntry` 11 (**Factur-X PDF**, pdf-lib) | 18.8 ms | 5.2 ms | 16 ms | borderline |
| Engine `auditEntries` ×50 | 16.4 ms | 9.4 ms | 14 ms | **over** |
| `viem.verifyTypedData` (EIP-712, simulated facilitator) | 1.8 ms | 2.0 ms | 3.4 ms | runs twice per paid call (verify + settle) |
| HTTP unpaid → 402 (any paid route) | 1–27 ms | 0.6–1.9 ms | ≤ 12 ms | OK |
| HTTP paid → 200 `/entry` JSON 01 (verify + engine + settle + receipt) | 14–42 ms | **6.4 ms** | 9 ms | OK warm |
| HTTP paid → 200 `/entry` Factur-X 11 | 11–29 ms | 7.8 ms | 13 ms | borderline |
| HTTP paid → 200 `/invoice/check` 01 | 7 ms | 6.0 ms | 8 ms | OK |
| HTTP paid → 200 `/audit` ×50 | 15–18 ms | 11.5 ms | 16 ms | **over** |
| `/api/demo/run` own CPU (nested API calls excluded) | 58 ms | **4.5 ms** | 15 ms | OK warm |
| GET health / catalog / llms / agent.json / stats (Node server incl. Next overhead) | — | 2.6–3.7 ms | — | OK |
| GET /openapi.json (idem) | — | 8.4 ms | — | borderline (Node HTTP overhead included) |

In **testnet** mode the facilitator verify/settle happen over the network (not CPU), so paid calls are cheaper
than in simulated mode (~2 ECDSA recoveries fewer).

**Mitigations in place (clearly labelled):**
1. **Warm-up before presenting** (`npm run warmup`): the cold first request per isolate (lazy route init + JIT,
   15–60 ms) is paid by the script, not by the jury's click. Cloudflare tolerates occasional overruns.
2. **Live demo uses JSON fixtures** (scenarios 01/03/04/06 → `/entry` JSON, ~6 ms warm). Factur-X PDF parsing stays
   available on the API but is labelled here **"may exceed free-plan CPU (≈ 8–13 ms)"**; audits are labelled
   **"keep ≤ ~20 items on the free plan"** (≈ 0.2 ms/item + ~6 ms x402 overhead).
3. **Any 1102/5xx in the console → automatic REPLAY fallback** (`lib/console/source.ts`), labelled "REPLAY".

**Proposed (not done — other workstreams' files):** in `lib/payments/simulated-facilitator.ts`, cache the
`verify()` result per signature for a few seconds so `settle()` does not recover the signature a second time
(−2 ms per paid call in simulated mode); cache the generated OpenAPI document in a module-level variable.

## 6. Fallback: Netlify (assessed, not built)

- **Next 16:** Netlify's Next.js runtime is the OpenNext Netlify adapter; Netlify states it supports Next.js ≥ 13.5
  and verifies every new stable release (docs.netlify.com → Frameworks → Next.js). Routes run as Node.js functions
  (no 10 ms CPU cap, no workerd caveats); `fs` in middleware is not supported (we have no middleware).
- **Free plan (credit-based since Sept 2025):** 300 credits/month, **hard cap — the site is paused** until the
  month resets once exhausted. Costs: production deploy 15 credits, 20 credits/GB bandwidth, 2 credits/10k
  requests, 10 credits/GB-hour of function compute. ≈ 20 production deploys/month max, so deploy sparingly.
- **Storage:** no native free KV with the same ergonomics → Neon free (`DATABASE_URL`) or memory + replays.
- **Verdict:** viable fallback if Workers fails (simpler runtime, Node functions); the risks are the credit cap
  (a pause right before the jury) and per-deploy credit cost. Steps if needed: `netlify.toml` with
  `[build] command = "npm run build"`, publish `.next`, env vars in the Netlify UI, `npx netlify deploy --prod`.
