# Ajean Ledger — Prompts Used to Build the Prototype

> **Hand-in document** for *Digital Transformation & FinTech — The AI Agent Economy Challenge*.
> Team: Ary SIDOUN, Victor BONNAPETIT, Yoann POMMEROLLE, Leo COUTURIER.
> This is the clean, chronological export of **every prompt the team sent** to the AI engineering assistant (Claude Code) to build the prototype, as required by the brief ("submit the prompts used to develop the prototype"). The source of truth is [`PROMPT_LOG.md`](./PROMPT_LOG.md) (each prompt verbatim, plus what was done) and [`00_MASTER_PROMPT.md`](./00_MASTER_PROMPT.md).
> Prompts #02 to #04 were written in French. Each one is given in its **original text (verbatim)**, followed by a faithful, complete **English translation**. The master prompt (#01) was written in English and is reproduced in full in the appendix. Times are UTC, on 16 November 2026.

## Summary

| # | Time (UTC) | Prompt | Language | Phase |
|---|---|---|---|---|
| #01 | 09:49 | Master prompt: project brief, constraints, product specification, build phases | English | 0 → 7 (plan) |
| #02 | 10:05 | Phase 0 answers, autonomous mode, orchestrator role, reply format | French | 0 → 7 |
| #03 | 10:40 | GitHub connected and repository created (two short messages) | French | 0 → 1 |
| #04 | 10:45 | Hosting change: no Vercel; Cloudflare Workers, then Netlify; storage; pitch argument | French | 5 (hosting) |

Live result: <https://ajean-ledger.ary-sidoun.workers.dev> (TESTNET, Cloudflare Workers).

---

## #01 — 2026-11-16 09:49 — Master prompt: project kick-off (Phase 0)

**Context:** the opening message of the build session, sent to an empty repository. It sets the course brief and the grading, the traceability and safety rules, the product specification (endpoints, prices, response contract, accounting engine, 12 fixtures), the machine-first and demo-reliability requirements, and the 8 build phases.

**Original text (English):** reproduced **verbatim and in full** in the [appendix](#appendix-prompt-01-master-prompt-verbatim) below (also in [`00_MASTER_PROMPT.md`](./00_MASTER_PROMPT.md)). Its closing instruction was: *"Start now with Phase 0: save this prompt verbatim to `docs/prompts/00_MASTER_PROMPT.md`, create the PROMPT_LOG entry #01 for this message, then ask me your blocking questions."*

**Translation:** none needed (written in English).

**Outcome:** master prompt saved; x402 v2 SDK checked on npm (`@x402/*` 2.31.0); docs skeleton and git repository created; the blocking questions asked in one batch.

---

## #02 — 2026-11-16 10:05 — Phase 0 answers + autonomous mode + orchestrator role

**Context:** the answers to the Phase 0 questions. It switches the assistant to fully autonomous mode with an orchestrator role (subagents, independent reviews after Phases 1, 5 and 7) and sets hard guard rails (testnet only, free plans only, no secrets, no real data) and the reply format.

**Original text (French, verbatim):**

> Réponses Phase 0 + mode autonome + orchestrateur
> Toutes tes recommandations par défaut sont acceptées. À partir de maintenant, tu travailles en autonomie complète, selon les règles ci-dessous. Elles remplacent les « stop à la fin de chaque phase » et « attends mon go » du master prompt.
> 1. Réponses à tes questions (décisions finales, à logger dans DECISIONS.md)
>
> 1. GitHub : crée un nouveau repo privé `ajean-ledger` sur mon compte. Trouve toi-même le compte avec les outils disponibles (`gh api user`, liste des repos, etc.). Pousse tout de suite le commit Phase 0, puis pousse après chaque étape.
> 2. Stockage : PAS de Supabase. Mon compte Supabase gratuit est déjà au maximum de projets actifs. Ne crée rien sur Supabase et n'ajoute aucune table dans mes projets Supabase existants.
>    * Utilise Neon Postgres (offre gratuite), de préférence via l'intégration Vercel Marketplace sur le projet `ajean-ledger`.
>    * Fallback : Upstash Redis gratuit. Dernier fallback : stockage en mémoire + mode replay, clairement labellisé.
>    * Le stockage doit rester optionnel : si la base est indisponible, l'API et la démo continuent de fonctionner (receipts en mémoire, `/operator` alimenté par les replays).
> 3. Vercel : équipe « arysidoun-5003's projects », offre Hobby (gratuite) uniquement, nouveau projet `ajean-ledger`. Ne touche à aucun projet existant, notamment `ajeanai`. Garde la consommation minimale : pas de cron, pas de polling, pas d'optimisation d'images inutile.
> 4. Clé Anthropic : ne bloque pas dessus. Construis tout en mode scripté sans LLM. Demande-moi la clé une seule fois, via le formulaire sécurisé, dans la section « Action requise » de ton prochain rapport, et continue sans attendre. Quand je la fournis, active le mode LLM. Le modèle par défaut est OK.
> 5. Défauts comptables (ADR-008) : tous acceptés (immobilisation à partir de 500 € HT → 2183 + 44562, 401 + code auxiliaire, journaux HA/BQ, restaurant à 20 % → revue humaine, citations légales seulement après ma validation). Les citations à valider vont dans `docs/LEGAL_REVIEW.md`, que je relirai à la fin. Elles ne bloquent pas l'avancement.
> 6. Fixture 9 : option (b), l'avocat est le client BNC dont on tient les comptes.
> 7. PME fictive : « Atelier Lumenor SAS (fictional) », OK.
> 8. Langue des livrables : anglais pour la note de concept, les slides, le script de démo et la préparation Q&R, car le cours est en anglais. Date de la session 10 : inconnue pour l'instant, donc fais les bonus (crédits prépayés, EURC) seulement une fois les phases 1 à 7 terminées et vérifiées.
>
> 2. Mode autonome : règles
>
> * Ne me demande plus aucune autorisation. Pour chaque choix, applique ta recommandation, logge-la dans `DECISIONS.md` (ADR) et continue.
> * Enchaîne toutes les phases (1 → 7) sans t'arrêter. À la fin de chaque phase : tests verts, commit, push, mise à jour de `BRIEF_COMPLIANCE.md` et `CHANGELOG.md`, rapport (format §4), puis tu passes directement à la phase suivante.
> * Si quelque chose bloque, contourne-le (mode simulé, fallback, solution alternative), logge-le et continue. Ne t'arrête que si rien ne peut avancer sans moi.
> * Seules raisons valables de me solliciter : une action que je suis physiquement le seul à pouvoir faire (clé API via le formulaire sécurisé, USDC de test sur le faucet Circle, connexion d'un compte). Regroupe-les dans « Action requise » et continue en parallèle sur le reste.
> * Check « jour J » (à ajouter en Phase 6) : un script `npm run warmup` qui appelle l'URL publique, la base et un endpoint payant en mode simulé, à lancer la veille et une heure avant la présentation pour réveiller tout le stack. Documente-le dans `DEMO_SCRIPT.md`.
>
> Garde-fous, que l'autonomie ne lève jamais :
>
> * Testnet uniquement (Base Sepolia). Jamais de mainnet, jamais de fonds réels.
> * Offres gratuites uniquement : aucun achat, abonnement ou upgrade payant sur GitHub, Vercel, Supabase ou ailleurs.
> * Ne touche à rien d'existant sur mes comptes (repos, projets Vercel, projets/tables Supabase, en particulier tout ce qui concerne Ajean). Tu crées du neuf, tu ne modifies ni ne supprimes rien.
> * Aucun secret dans le code, les logs, les rapports ou le chat. Uniquement `.env` et les variables d'environnement Vercel.
> * Aucune vraie donnée client, uniquement des données fictives labellisées.
>
> 3. Rôle d'orchestrateur
> Tu es désormais l'orchestrateur du projet. Je ne parle qu'à toi.
>
> * Découpe le travail et délègue à des sous-agents les tâches indépendantes, en parallèle quand c'est possible (ex. moteur comptable, couche de découverte et MCP, console de démo, livrables). Tu coordonnes, tu intègres, tu vérifies.
> * Chaque sous-agent reçoit un brief précis, les critères d'acceptation de sa phase et les contraintes du master prompt (§1 consignes du cours, §4 sécurité).
> * Vérification indépendante : à la fin des phases 1, 5 et 7, lance un sous-agent relecteur qui n'a pas produit le travail. Il contrôle trois choses : (a) la justesse comptable des 12 fixtures, (b) la conformité à chaque exigence de la consigne et aux critères de notation, (c) le fait que la démo se déroule sans erreur depuis l'URL publique. Corrige ce qu'il trouve avant de passer à la suite.
> * La traçabilité reste obligatoire : `PROMPT_LOG.md` reçoit chacun de mes messages mot pour mot, celui-ci compris (entrée #02). Comme mes messages sont en français, `PROMPTS_SUBMISSION.md` contiendra la version originale et une traduction anglaise pour le rendu.
>
> 4. Format de tes réponses (obligatoire, toujours)
> En français, court, uniquement en bullet points. Pas de code ni de détail technique dans le chat (ça va dans `docs/`). 15 lignes maximum, sauf si je demande plus.
>
> ```
> **Avancement** : Phase X/7 — <nom> — <% ou état>
>
> **Fait**
> - ...
>
> **En cours / ensuite**
> - ...
>
> **Action requise de ta part**
> - <seulement si indispensable, avec le lien et la marche à suivre en 1 ligne> — sinon : « Rien »
>
> **Liens**
> - Repo : ... | Démo : ... (dès qu'ils existent)
>
> ```
>
> Quand je te pose une question, réponds directement et dans ce même style : en français, en bullet points, simple.
> Démarre maintenant : logge ce message (#02), applique les décisions §1, pousse sur GitHub, puis lance la Phase 1 et enchaîne jusqu'à la Phase 7.

**English translation:**

> **Phase 0 answers + autonomous mode + orchestrator**
> All your default recommendations are accepted. From now on, you work fully autonomously, under the rules below. They replace the master prompt's "stop at the end of each phase" and "wait for my go".
>
> **1. Answers to your questions (final decisions, to be logged in DECISIONS.md)**
>
> 1. GitHub: create a new private repo `ajean-ledger` on my account. Find the account yourself with the available tools (`gh api user`, list of repos, etc.). Push the Phase 0 commit right away, then push after each step.
> 2. Storage: NO Supabase. My free Supabase account has already reached its maximum number of active projects. Do not create anything on Supabase and do not add any table to my existing Supabase projects.
>    * Use Neon Postgres (free plan), preferably through the Vercel Marketplace integration on the `ajean-ledger` project.
>    * Fallback: free Upstash Redis. Last fallback: in-memory storage + replay mode, clearly labelled.
>    * Storage must remain optional: if the database is unavailable, the API and the demo keep working (receipts in memory, `/operator` fed by the replays).
> 3. Vercel: team "arysidoun-5003's projects", Hobby (free) plan only, new project `ajean-ledger`. Do not touch any existing project, in particular `ajeanai`. Keep consumption minimal: no cron, no polling, no unnecessary image optimisation.
> 4. Anthropic key: do not block on it. Build everything in scripted mode, without an LLM. Ask me for the key only once, through the secure form, in the "Action required" section of your next report, and carry on without waiting. When I provide it, enable LLM mode. The default model is fine.
> 5. Accounting defaults (ADR-008): all accepted (fixed asset from €500 excl. VAT → 2183 + 44562, 401 + auxiliary code, HA/BQ journals, restaurant at 20% → human review, legal citations only after my validation). The citations to be validated go in `docs/LEGAL_REVIEW.md`, which I will review at the end. They do not block progress.
> 6. Fixture 9: option (b), the lawyer is the BNC client whose books we keep.
> 7. Fictional SME: "Atelier Lumenor SAS (fictional)", OK.
> 8. Language of the deliverables: English for the concept note, the slides, the demo script and the Q&A preparation, because the course is taught in English. Date of session 10: unknown for now, so do the bonuses (prepaid credits, EURC) only once Phases 1 to 7 are finished and verified.
>
> **2. Autonomous mode: rules**
>
> * Do not ask me for any authorisation any more. For each choice, apply your recommendation, log it in `DECISIONS.md` (ADR) and carry on.
> * Run all the phases (1 → 7) back to back without stopping. At the end of each phase: green tests, commit, push, update of `BRIEF_COMPLIANCE.md` and `CHANGELOG.md`, report (format §4), then move straight on to the next phase.
> * If something blocks, work around it (simulated mode, fallback, alternative solution), log it and carry on. Stop only if nothing can move forward without me.
> * The only valid reasons to come to me: an action that only I can physically do (API key through the secure form, test USDC from the Circle faucet, connecting an account). Group them under "Action required" and keep working on the rest in parallel.
> * "Day-J" check (to add in Phase 6): an `npm run warmup` script that calls the public URL, the database and a paid endpoint in simulated mode, to be run the evening before and one hour before the presentation to wake up the whole stack. Document it in `DEMO_SCRIPT.md`.
>
> Guard rails, which autonomy never lifts:
>
> * Testnet only (Base Sepolia). Never mainnet, never real funds.
> * Free plans only: no purchase, subscription or paid upgrade on GitHub, Vercel, Supabase or anywhere else.
> * Do not touch anything that already exists on my accounts (repos, Vercel projects, Supabase projects/tables, in particular anything related to Ajean). You create new things; you neither modify nor delete anything.
> * No secrets in the code, the logs, the reports or the chat. Only in `.env` and the Vercel environment variables.
> * No real client data, only labelled fictional data.
>
> **3. Orchestrator role**
> You are now the project's orchestrator. I only talk to you.
>
> * Break the work down and delegate independent tasks to subagents, in parallel when possible (e.g. accounting engine, discovery and MCP layer, demo console, deliverables). You coordinate, integrate and verify.
> * Each subagent gets a precise brief, the acceptance criteria of its phase and the constraints of the master prompt (§1 course brief, §4 security).
> * Independent verification: at the end of Phases 1, 5 and 7, launch a reviewer subagent that did not produce the work. It checks three things: (a) the accounting correctness of the 12 fixtures, (b) compliance with each requirement of the brief and with the grading criteria, (c) that the demo runs without errors from the public URL. Fix whatever it finds before moving on.
> * Traceability remains mandatory: `PROMPT_LOG.md` gets each of my messages word for word, this one included (entry #02). Since my messages are in French, `PROMPTS_SUBMISSION.md` will contain the original version and an English translation for the hand-in.
>
> **4. Format of your replies (mandatory, always)**
> In French, short, bullet points only. No code and no technical detail in the chat (that goes in `docs/`). 15 lines maximum, unless I ask for more.
>
> ```
> **Progress**: Phase X/7 — <name> — <% or status>
>
> **Done**
> - ...
>
> **In progress / next**
> - ...
>
> **Action required from you**
> - <only if essential, with the link and the steps in 1 line> — otherwise: "Nothing"
>
> **Links**
> - Repo: ... | Demo: ... (as soon as they exist)
>
> ```
>
> When I ask you a question, answer directly and in this same style: in French, in bullet points, simply.
> Start now: log this message (#02), apply the §1 decisions, push to GitHub, then launch Phase 1 and keep going through to Phase 7.

**Outcome:** decisions logged as ADR-009 to ADR-016; Phases 1 to 7 run by the orchestrator and its subagents.

---

## #03 — 2026-11-16 10:40 — GitHub repo created (mid-turn notes)

**Context:** two short messages sent while Phase 0 was running, once the user had connected GitHub and created the empty repository that the session could not create itself (ADR-009).

**Original text (French, verbatim):**

> GitHub esr connecté

> C'est créé https://github.com/ArySid/ajean-ledger.git

**English translation:**

> GitHub is connected
>
> It's created https://github.com/ArySid/ajean-ledger.git

*(The original "esr" is a typo for "est", "is".)*

**Outcome:** repository attached with push access; the full local history was pushed, then every step after it.

---

## #04 — 2026-11-16 10:45 — Hosting change: no Vercel, Cloudflare Workers (OpenNext) then Netlify

**Context:** the user's Vercel account was paused, so hosting had to move to another free plan. The message sets the test order, the storage options and the pitch argument (x402 co-created by Coinbase and Cloudflare; that wording is inaccurate and the deliverables use the corrected fact: Coinbase created x402, and Cloudflare co-founded the x402 Foundation with Coinbase, see `docs/DECISIONS.md` ADR-017).

**Original text (French, verbatim):**

> Changement d'hébergement (décision finale, à logger en ADR) :
>
> - Mon compte Vercel est en PAUSE jusqu'au 12/12/2026 (dépassement Fast Origin Transfer). N'utilise PAS Vercel : aucun déploiement, pas d'import du repo, pas d'intégration Vercel Marketplace. Ne touche à aucun projet Vercel existant.
> - Héberge ajean-ledger sur une offre GRATUITE ailleurs. Teste dans cet ordre et garde le premier qui fait tourner la démo complète sans erreur depuis une URL publique :
>   1) Cloudflare Workers via l'adaptateur OpenNext. Contraintes de l'offre gratuite : 100 000 requêtes/jour et 10 ms de CPU par requête. Si le parsing PDF ou un autre traitement dépasse, déplace-le côté client ou utilise des résultats pré-calculés pour la démo, clairement labellisés.
>   2) Netlify (offre gratuite).
> - Stockage : l'option gratuite native de l'hébergeur retenu (ex. Cloudflare D1 ou KV), sinon Neon gratuit en direct. Pas de Supabase. Le stockage reste optionnel (fallback mémoire + replay).
> - Argument à intégrer au pitch et à QA_PREP.md si Cloudflare est retenu : x402 a été co-créé par Coinbase et Cloudflare.
> - Mets à jour le script warmup (check jour J) pour l'hébergeur retenu.
> - Logge le choix final, les limites gratuites et leur impact dans DECISIONS.md, BRIEF_COMPLIANCE.md et QA_PREP.md.
> - Si une création de compte est nécessaire (Cloudflare, Netlify ou Neon), mets-la dans "Action requise" avec le lien et la marche à suivre en 1 ligne, et continue tout le reste en attendant.

**English translation:**

> Hosting change (final decision, to be logged as an ADR):
>
> - My Vercel account is PAUSED until 12/12/2026 (Fast Origin Transfer overage). Do NOT use Vercel: no deployment, no repo import, no Vercel Marketplace integration. Do not touch any existing Vercel project.
> - Host ajean-ledger on a FREE plan somewhere else. Test in this order and keep the first one that runs the full demo without errors from a public URL:
>   1) Cloudflare Workers through the OpenNext adapter. Free-plan constraints: 100,000 requests/day and 10 ms of CPU per request. If PDF parsing or any other processing exceeds that, move it to the client side or use precomputed results for the demo, clearly labelled.
>   2) Netlify (free plan).
> - Storage: the chosen host's native free option (e.g. Cloudflare D1 or KV), otherwise Neon free, directly. No Supabase. Storage stays optional (memory fallback + replay).
> - Argument to put in the pitch and in QA_PREP.md if Cloudflare is chosen: x402 was co-created by Coinbase and Cloudflare.
> - Update the warmup script (Day-J check) for the chosen host.
> - Log the final choice, the free-plan limits and their impact in DECISIONS.md, BRIEF_COMPLIANCE.md and QA_PREP.md.
> - If an account has to be created (Cloudflare, Netlify or Neon), put it in "Action required" with the link and the steps in 1 line, and carry on with everything else in the meantime.

**Outcome:** ADR-017 and ADR-020: Cloudflare Workers (free plan) retained, live at the public URL; free-plan limits documented in `docs/HOSTING.md` and `deliverables/QA_PREP.md`.

---

## #05 — 2026-11-20 — Short recap of the product (question)

**Context:** after Phase 7, the user asks for a short summary of the product they can reuse orally (principle, value, how it gets paid).

**Original text (French, verbatim):**

> Tu peux me faire un mini recap du principe du logiciel, et en 2-3 phrases son intérêt, comment marche la rémunération et quel est le principe de base
> Fais ce que je t'ai dit.

**English translation:**

> Can you give me a short recap of how the software works, and in 2–3 sentences its value, how the payment works and what the basic principle is.
> Do what I told you.

**Outcome:** answered in chat (French bullet points); no code change.

---

## #06 — 2026-11-20 — Shorter English pitch (question)

**Context:** follow-up to #05: the user wants a 2–3 sentence presentation in English.

**Original text (French, verbatim):**

> Plus cours juste 2-3 phrases de prenstation en anglais mtn

**English translation:**

> Shorter: just 2–3 sentences of presentation, in English now.

**Outcome:** answered in chat; no code change.

---

## How the prototype was built

- **One build session, one orchestrator.** The four prompts above were sent to a single Claude Code session (Anthropic; the commits are co-authored by the Claude Opus 5.5 model). After prompt #02, that session acted as the **orchestrator**. It split the work into workstreams with explicit file ownership: accounting engine; x402 paid API and payments; discovery files and MCP server; demo purchasing agent; demo console; hosting; deliverables. Independent workstreams ran in parallel as **subagents**, and the orchestrator integrated and verified the results. The briefs given to the subagents were written by the orchestrator from these prompts; they are not team prompts and are not listed here.
- **Independent reviews.** Prompt #02 requires a review by a subagent that did not produce the work, after Phases 1, 5 and 7. The Phase 1 review (accounting engine, as an expert-comptable would check it) found 2 blocking issues: the excess-VAT deduction on fixture 03, and "fictional" SIRENs that belonged to real companies. Both were fixed (ADR-018, ADR-021). The Phase 5 review (brief compliance and the public demo) found no blocking issue; its major findings were fixed (ADR-022, ADR-023). Reports: `docs/reviews/PHASE1_REVIEW.md`, `docs/reviews/PHASE5_REVIEW.md`.
- **Traceability.** Every decision is in `docs/DECISIONS.md` (ADR-001 to ADR-023), every change in `CHANGELOG.md`, every requirement mapped to evidence in `docs/BRIEF_COMPLIANCE.md`, and one git commit per step (`ArySid/ajean-ledger`).
- **What the team did by hand.** Only what the assistant could not do: answering the Phase 0 questions, creating the GitHub repository and the Cloudflare account and token, and funding the testnet agent wallet with test USDC from the Circle faucet. Reviewing the legal references (`docs/LEGAL_REVIEW.md`) is still pending.
- **Result.** A live service in TESTNET mode at <https://ajean-ledger.ary-sidoun.workers.dev>, with real x402 settlements on Base Sepolia, 226 automated tests and 13 synthetic fixtures.

---

## Appendix: prompt #01, master prompt (verbatim)

The text below is the master prompt exactly as sent, including its own header lines. It is reproduced from `docs/prompts/00_MASTER_PROMPT.md`.

````text
# MASTER PROMPT: Ajean Ledger (AI Agent Economy Challenge)

> Paste everything below into a new Claude Code session, opened on an empty folder named `ajean-ledger`.
> Replace the `[PLACEHOLDERS]` first.

---

## 0. WHO YOU ARE AND WHAT WE ARE BUILDING

You are my senior full-stack engineer and product partner. You are also a French chartered accountant (expert-comptable) with solid PCG, VAT (CGI) and e-invoicing reform knowledge. We are building **Ajean Ledger**, a **real, working proof of concept** for a graded master's course: *Digital Transformation & FinTech – "The AI Agent Economy Challenge"* (team project, 50% of the course grade).

**One-sentence product definition:**
Ajean Ledger is an API that lets any AI agent send a French invoice or bank transaction and immediately get back a validated, machine-readable accounting entry (PCG accounts, VAT treatment, e-invoicing compliance status, anomaly flags). The agent pays per call in USDC stablecoin through the x402 HTTP payment protocol.

**Context:**
- Team: Ary SIDOUN, Victor BONNAPETIT, Yoann POMMEROLLE, Leo COUTURIER . Final presentation: Session 10
- Ajean is my existing AI-agent platform for SMEs and accounting firms. It has a 3D virtual office, an accounting-firm module and expert agents (accountant, statutory auditor, tax inspector). Ajean Ledger takes its "accounting brain" and turns it into a service **consumed by AI agents, not humans**.
- Why now: French e-invoicing reform. Reception of e-invoices has been mandatory for all companies since 1 Sept 2026, and SMEs must issue them from 1 Sept 2027. Agent-native stablecoin payments (x402) are now mature.

---

## 1. THE COURSE BRIEF (NON-NEGOTIABLE CONSTRAINTS)

Every decision must serve these requirements. Re-read this section before each phase.

**The challenge:** an original business idea plus a PoC for an application **specifically designed to serve AI agents (bots)**. AI agents, not humans, are the direct users. **Payments for the service must be made in cryptocurrencies, including stablecoins.**

**Hard rule from the brief:** it must NOT be "a conventional application for humans with a chatbot attached". We must **show what an AI agent requests and what it receives.**

**PoC scope (from the brief):** "Build just enough to make the idea tangible and operational for demonstration purposes. Demonstrate a representative request from an AI agent, the service's key function, and the result provided to the agent. Simulated data and agent interactions must be shown in a demo and clearly logically defined." A real API, MCP server and payment integration are *not required*. **We will build them anyway, in a simple and reliable way**, because a real working service is our differentiator. The demo must still never depend on a fragile live component (see §6, fallback mode).

**Final deliverables:**
1. **PoC**: a shareable link to the prototype UI, plus a logical, step-by-step demo sequence. **We must also submit the prompts used to develop the prototype** (see §2, mandatory).
2. **Concept note**: max 2 pages. Economic problem, AI-agent use case, innovative features, target customers, existing alternatives, revenue model, crypto/stablecoin revenue mechanism, simple pricing illustration (no detailed financial projections).
3. **Final presentation**: 8–10 min, including a 2–3 min live demo, 6–8 slides, then Q&A.

**Grading (optimise in this order):**
| Criterion | Weight | What it means for us |
|---|---|---|
| Economic relevance & innovation | 30% | Real pain (manual correction of agent bookkeeping errors, e-invoicing reform), original approach |
| Fit for AI-agent use | 25% | Machine-first: discovery files, JSON-only, HTTP 402 payments, no sign-up, no human UI in the product path |
| Quality of the PoC | 20% | Coherent, credible, demonstrable end to end |
| Commercial potential | 15% | Clear payer, plausible per-call pricing, business rationale |
| Final presentation | 10% | Clear pitch and a demo that cannot fail |

The brief states that originality, economic relevance, fit for agents and commercial potential count more than technical complexity. **Never over-engineer.** Choose the simplest thing that is real.

---

## 2. TRACEABILITY RULES (MANDATORY, FROM THE FIRST MINUTE)

The brief requires us to submit the prompts used to build the prototype. You must maintain these files throughout the session, **without being asked again**:

1. `docs/prompts/00_MASTER_PROMPT.md`: save this entire prompt **verbatim** as your very first action.
2. `docs/prompts/PROMPT_LOG.md`: append an entry for **every message I send you**:
   ```
   ## #NN — YYYY-MM-DD HH:MM — <short title>
   **Prompt (verbatim):**
   > <my exact message>
   **What was done:** <3–6 bullet summary>
   **Files touched:** <list>
   **Phase:** <phase number>
   ```
3. `docs/DECISIONS.md`: short ADR-style log of every technical or product decision (context → decision → why → alternatives rejected).
4. `docs/BRIEF_COMPLIANCE.md`: a living checklist mapping each requirement and grading criterion in §1 to concrete evidence (file, endpoint, screen, demo step). Update it at the end of each phase.
5. `CHANGELOG.md`: one line per meaningful change.
6. Git: init the repo, make one commit per completed step, and use clear messages (`feat(engine): ...`, `docs(prompts): ...`).

At the end of the project, generate `docs/prompts/PROMPTS_SUBMISSION.md`. It is a clean, chronological, presentable export of all prompts, with one line of context each, ready to hand in.

---

## 3. HOW WE WORK

- Work **phase by phase** (§7). At the end of each phase, stop and show me what works, how to test it in one command, and the updated `BRIEF_COMPLIANCE.md`. Then wait for my "go".
- Before Phase 1, ask me **all your blocking questions in one batch** (max 8). Otherwise make sensible defaults and log them in `DECISIONS.md`.
- Before using the x402 SDK, check its **current official docs** (x402.org and the coinbase/x402 GitHub repo). Package names, versions and header names change; do not rely on memory. Log the versions you used.
- If an `accounting` / `comptable` skill is available in your environment, use it as reference knowledge for PCG and VAT rules.
- Write code, comments and docs in English. API error messages and explanations are in English; accounting labels may stay in French (e.g. "TVA déductible sur ABS").
- Prefer TypeScript end to end.

---

## 4. SECURITY & SAFETY RULES

- **Testnet only** (Base Sepolia, test USDC). Never real funds, never mainnet.
- Never commit private keys or secrets. Use `.env.local`, ship `.env.example`, and add `.env*` to `.gitignore`.
- Generate dedicated **throwaway testnet wallets** (one for the service `payTo`, one for the demo agent). Tell me exactly which manual step I must do (e.g. get test USDC from the Circle faucet), and give me the link from the official docs.
- **No real client data**, ever. All invoices are synthetic, with fictional companies and fictional SIREN numbers that are clearly labelled as such.
- Clearly label the service as a PoC: "not a substitute for a chartered accountant's review". Ambiguous cases return `human_review_required: true`.

---

## 5. PRODUCT SPECIFICATION

### 5.1 Target users (who calls / who pays)
- **Caller:** autonomous AI agents (an SME purchasing/AP agent, an expense agent, an accounting firm's pre-bookkeeping agent, a general-purpose assistant acting for a freelancer).
- **Payer:** the agent's operator (SaaS publishers that embed agents, accounting firms, SMEs). The payment comes from the agent's wallet, under a spending policy set by its operator.

### 5.2 Endpoints and pricing

| Endpoint | Function | Price (USDC) |
|---|---|---|
| `GET /api/v1/catalog` | Free. Machine-readable service and pricing manifest | free |
| `GET /openapi.json` | Free. Full OpenAPI 3.1 spec | free |
| `GET /llms.txt` and `GET /.well-known/agent.json` | Free. Agent discovery files (what the service does, how to pay, examples) | free |
| `POST /api/v1/invoice/check` | E-invoice compliance check (mandatory mentions, format, VAT consistency) | 0.05 |
| `POST /api/v1/entry` | Full journal entry proposal + VAT treatment + compliance + anomalies | 0.15 |
| `POST /api/v1/audit` | Batch audit of up to 50 entries or a mini FEC extract (duplicates, VAT inconsistencies, suspicious accounts, statutory-auditor and tax-inspector viewpoints) | 1.00 |
| `GET /api/v1/receipts/{id}` | Free. Payment receipt + result retrieval (idempotency) | free |

Optional (only if time allows, Phase 6 bonus): prepaid credit packs (e.g. 10 USDC → 12 USDC of calls) to illustrate volume pricing in the concept note.

### 5.3 Input formats
- JSON structured invoice (our documented schema)
- Factur-X / ZUGFeRD PDF (extract the embedded CII XML)
- UBL 2.1 XML
- Bank transaction JSON (date, label, amount, counterparty, optional attachment)
- Plain PDF/image: best-effort LLM extraction, and the response must flag `extraction_method: "llm"` with a confidence score

### 5.4 Response contract (`POST /api/v1/entry`): design it carefully, it is the heart of the demo
```json
{
  "request_id": "req_...",
  "receipt": { "amount": "0.15", "asset": "USDC", "network": "base-sepolia", "tx_hash": "0x..." },
  "invoice": { "number": "...", "date": "...", "supplier": {...}, "customer": {...}, "totals": {...} },
  "compliance": {
    "status": "compliant | non_compliant | warning",
    "checks": [ { "rule_id": "FR-EINV-SIREN-BUYER", "label": "...", "passed": false, "severity": "error", "fix_hint": "..." } ]
  },
  "entry": {
    "journal": "HA",
    "lines": [
      { "account": "6064", "label": "Fournitures administratives", "debit": 100.00, "credit": 0 },
      { "account": "44566", "label": "TVA déductible sur ABS", "debit": 20.00, "credit": 0 },
      { "account": "401XXXX", "label": "Fournisseur ...", "debit": 0, "credit": 120.00 }
    ],
    "balanced": true
  },
  "vat": { "regime": "standard | reverse_charge_intra_eu | exempt | ...", "rate": 0.20, "deductible": true, "legal_basis_id": "..." },
  "anomalies": [ { "code": "DUPLICATE_SUSPECTED", "detail": "...", "severity": "warning" } ],
  "confidence": 0.94,
  "human_review_required": false,
  "explanation": "One short paragraph an agent can relay to its operator.",
  "engine": { "version": "0.x", "rules_applied": ["..."], "llm_used": false }
}
```
Rules: amounts are numbers with 2 decimals, debits always equal credits, and every rule is identified by a stable `rule_id`. **Never invent legal article numbers.** If you cite a legal basis, it must come from a curated rules table in the code that I can review.

### 5.5 Accounting engine design (rules first, LLM second)
- **Deterministic core** (`/engine`): PCG account mapping table (expense categories → accounts, e.g. 6064, 6226, 6251, 6256, 6257, 613x, 2183 for fixed assets above the low-value threshold); VAT rates (20 / 10 / 5.5 / 2.1 %); VAT regimes (standard, intra-EU reverse charge, exempt, out of scope); e-invoicing mandatory mentions, including the reform's new ones (buyer SIREN, delivery address if different, nature of the operation goods/services/mixed, option for VAT on debits) plus the classic ones (number, date, parties, VAT IDs, description, qty, unit price excl. VAT, VAT rate and amount, totals, payment terms, late-payment penalties, €40 fixed recovery indemnity in B2B); duplicate detection; balance checks.
- **LLM layer** (Anthropic API, model configurable in `.env`): only for (a) extracting data from unstructured documents and (b) classifying ambiguous expense descriptions into a category. The LLM never decides amounts or VAT on its own; the rules engine validates everything.
- `/audit` adds two "expert viewpoints" generated from the results: **statutory auditor** (materiality, anomalies) and **tax inspector** (deductibility risks, VAT). Both are structured JSON, not prose only.
- **Without an LLM key, the engine must still work** on structured inputs (JSON / Factur-X / UBL).

### 5.6 Test fixtures (synthetic, in `/fixtures`, each with an expected output and a unit test)
1. Compliant standard invoice, office supplies, 20%
2. Missing buyer SIREN → non_compliant
3. Restaurant invoice billed at 20% instead of 10% → VAT anomaly
4. Intra-EU service supplier → reverse charge (VAT due + deductible lines)
5. Exempt training invoice (VAT-exempt mention present)
6. Duplicate of invoice #1 → DUPLICATE_SUSPECTED
7. Credit note (avoir) → reversed entry
8. Laptop above the fixed-asset threshold → account 2183 + VAT on fixed assets account
9. Lawyer (BNC profession) client: legal fees invoice
10. Mixed goods + services invoice → nature of operation = mixed
11. A Factur-X PDF version of fixture 1
12. A bank transaction to match against fixture 1

---

## 6. MACHINE-FIRST DESIGN + DEMO RELIABILITY

**Fit for agents (25% of the grade), so implement all of these:**
- Zero sign-up, zero API key: **payment is the authentication** (x402).
- Unpaid call → `HTTP 402` with the x402 payment requirements (price in atomic USDC units, `payTo`, asset, network, resource, description). Paid call → result + payment response header with the tx hash. Follow the current x402 spec exactly.
- Discovery: `catalog`, `openapi.json`, `llms.txt`, `.well-known/agent.json`.
- **MCP server** (`/mcp` or a small standalone package) exposing `check_invoice`, `create_entry` and `audit_entries` tools, so that Claude Desktop or any MCP agent can use Ajean Ledger. Payment goes through x402 under the hood.
- Idempotency key header + receipts endpoint, deterministic outputs, a strict JSON schema and machine-readable error codes.
- Agent spending policy example: the demo agent has `max_per_call` and `daily_budget`. It refuses to pay if the price exceeds its policy, and logs why.

**Payment modes**, set via env `PAYMENT_MODE`:
- `testnet`: real x402 payment on Base Sepolia with test USDC (the default for the live demo)
- `simulated`: same 402 → pay → 200 flow, with a mocked facilitator and fake tx hash, clearly labelled "SIMULATED" in the UI
- **Recorded replay**: the demo console can replay a previously recorded real run (stored JSON trace) if the network fails during the presentation. **The live demo must never be able to fail.**

---

## 7. BUILD PHASES (stop at the end of each one)

**Phase 0 — Setup & questions**
Save the master prompt (§2) and create the docs skeleton. Ask your blocking questions. Propose the stack (default: Next.js App Router + TypeScript on Vercel, no database or SQLite/JSON file for receipts; Supabase only if really needed), the folder structure and the x402 package versions after checking the docs.
✅ Done when: the repo is initialised, the docs files exist, and the stack is validated by me.

**Phase 1 — Accounting engine**
`/engine` with the rules tables, compliance checks, entry builder, VAT logic, anomaly detection, Factur-X/UBL parsers and the optional LLM extraction. Add all fixtures + tests (Vitest).
✅ Done when: `npm test` is green on all 12 fixtures, and I can run `npm run engine -- fixtures/03.json` to print the JSON result.

**Phase 2 — Paid API (x402)**
API routes + 402 middleware + pricing from a single config file + receipts + idempotency + the 3 payment modes.
✅ Done when: a `curl` without payment returns 402 with correct requirements, a scripted paid call on Base Sepolia returns 200 + tx hash visible on the Base Sepolia explorer, and simulated mode works offline.

**Phase 3 — Agent discovery layer**
`catalog`, `openapi.json`, `llms.txt`, `.well-known/agent.json`, plus the MCP server.
✅ Done when: Claude Desktop (or the MCP inspector) can list and call the tools, and documented config snippets are in the README.

**Phase 4 — Demo client agent**
`/agent`: an autonomous "SME purchasing agent" (TypeScript, Anthropic SDK tool use, with a scripted fallback without an LLM). Scenario: it watches an `inbox/` folder of incoming supplier invoices, discovers Ajean Ledger via the catalog, checks the price against its budget policy, pays via x402, receives the entry, posts it into a mock ERP (`erp.json`) and flags anything requiring human review.
✅ Done when: `npm run agent` processes the inbox end to end and prints a clear step-by-step log.

**Phase 5 — Demo console (the shareable PoC link)**
This UI is **not the product**. It is a **window into agent-to-agent traffic** and must make that obvious. Pages:
- `/` Landing for the jury: one-sentence pitch, "Built for agents, not humans", the 4-step flow diagram (Request → 402 Payment Required → USDC payment → Result), pricing table, and links to `llms.txt`, OpenAPI and MCP.
- `/live` **Live Agent Console**: a split view. On the left, the agent's reasoning and raw HTTP exchange (request, 402 response, payment header, 200 response) shown step by step with a timeline. On the right, the structured result (compliance checks, entry lines as a mini ledger, anomalies, explanation) plus the tx hash linked to the explorer. Buttons: "Run scenario" (pick fixtures 1, 3, 4 or 6), mode badge (TESTNET / SIMULATED / REPLAY), "Replay recorded run".
- `/operator` A minimal operator view of the agent economy: calls served, USDC earned, revenue per endpoint, and recent transactions. It shows the business model in action.
- Optional visual nod to Ajean (the virtual office): an animated view where agent "visitors" arrive, pay and leave with their result. Keep it light and do not let it slow down the demo.
Design: clean, dark, fintech-grade, readable on a projector (large fonts, high contrast).
✅ Done when: deployed on Vercel with a public URL, and the full scenario runs in under 60 seconds per invoice.

**Phase 6 — Hardening for the presentation**
Record 3 replay runs, check the fallbacks, add rate limiting (simple), write a README quickstart (3 commands) and run a final run-through on a fresh clone. Bonus if time allows: credit packs, EURC as a second accepted stablecoin.
✅ Done when: I can run the full demo twice in a row from the public URL with no errors.

**Phase 7 — Course deliverables (drafts for me to review)**
In `/deliverables`:
1. `CONCEPT_NOTE.md`: **max 2 pages** in the brief's structure (economic problem, AI-agent use case, innovative features, target customers, existing alternatives such as Pennylane / Dext / generic LLMs / accounting-firm manual work, revenue model with crypto/stablecoin flow, simple pricing illustration with one example such as "an accounting firm whose agents process 20,000 invoices/month"). No detailed financial projections.
2. `DEMO_SCRIPT.md`: a timed **2–3 min** live demo script (who clicks what, what to say, fallback if something fails).
3. `SLIDES_OUTLINE.md`: **6–8 slides** for an **8–10 min** pitch (problem → why agents → solution → live demo → business model & crypto payments → differentiation & why now → ask/next steps), with speaker notes.
4. `QA_PREP.md`: 12 likely jury questions with short answers (e.g. "Why would an agent pay instead of using an LLM?", "Why stablecoins rather than card payments?", "Liability if the entry is wrong?", "Why can't Pennylane do this?", "What happens on mainnet?", "GDPR and data retention?").
5. `docs/prompts/PROMPTS_SUBMISSION.md`: the final prompt export (§2).
6. Final update of `BRIEF_COMPLIANCE.md` with every requirement ticked and its evidence.
✅ Done when: all files exist and the concept note fits on 2 pages when exported.

---

## 8. QUALITY BAR

- Every result must be **accounting-correct** on the fixtures. If unsure about a rule, mark it `human_review_required` rather than guess, and list it in `DECISIONS.md` for my review (I work in finance/audit and will check).
- The demo must tell one story with no detours: an SME's purchasing agent receives an invoice → it doesn't know French rules → it pays Ajean Ledger 0.15 USDC in one HTTP request → it gets a correct, compliant entry plus a warning a human would have missed.
- Keep it simple, real and reliable. Real where it is cheap (testnet payments, real API, real MCP), simulated where it is risky (with clear labels).

**Start now with Phase 0: save this prompt verbatim to `docs/prompts/00_MASTER_PROMPT.md`, create the PROMPT_LOG entry #01 for this message, then ask me your blocking questions.**
````
