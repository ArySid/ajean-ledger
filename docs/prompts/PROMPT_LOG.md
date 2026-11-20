# Prompt Log — Ajean Ledger

Every message sent to the AI engineering assistant during the build, in order.
Required by the course brief ("submit the prompts used to develop the prototype").
Times are UTC.

---

## #01 — 2026-11-16 09:49 — Master prompt: project kick-off (Phase 0)
**Prompt (verbatim):**
> The full master prompt (242 lines). It is stored **verbatim and unabridged** in
> [`00_MASTER_PROMPT.md`](./00_MASTER_PROMPT.md) and is not duplicated here to keep this log readable
> (see `docs/DECISIONS.md` ADR-001). Its closing instruction was:
> "Start now with Phase 0: save this prompt verbatim to `docs/prompts/00_MASTER_PROMPT.md`, create the PROMPT_LOG entry #01 for this message, then ask me your blocking questions."

**What was done:**
- Saved the master prompt verbatim to `docs/prompts/00_MASTER_PROMPT.md`.
- Checked the current x402 SDK on the npm registry (v2, `@x402/*` 2.31.0, published 2026-11-12) and read the shipped READMEs and code: v2 headers `PAYMENT-REQUIRED` / `PAYMENT-SIGNATURE` / `PAYMENT-RESPONSE`, CAIP-2 network id `eip155:84532` for Base Sepolia, public testnet facilitator `https://x402.org/facilitator`.
- Created the docs skeleton: `PROMPT_LOG.md`, `DECISIONS.md` (ADR-001…ADR-008, stack marked *proposed*), `BRIEF_COMPLIANCE.md`, `CHANGELOG.md`, `README.md`, `.gitignore`, `.env.example`.
- Initialised the git repository with a first commit.
- Asked the batch of blocking questions (see chat), proposed stack, folder structure and package versions.

**Files touched:** `docs/prompts/00_MASTER_PROMPT.md`, `docs/prompts/PROMPT_LOG.md`, `docs/DECISIONS.md`, `docs/BRIEF_COMPLIANCE.md`, `CHANGELOG.md`, `README.md`, `.gitignore`, `.env.example`
**Phase:** 0

---

## #02 — 2026-11-16 10:05 — Phase 0 answers + autonomous mode + orchestrator role
**Prompt (verbatim, original in French):**
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

**What was done:**
- Logged the Phase 0 answers as final decisions (ADR-003/004 accepted, ADR-009 → ADR-016).
- Switched to autonomous orchestrator mode (subagents per workstream, independent reviewers after Phases 1, 5, 7).
- Tried to create the private GitHub repo: the session's GitHub token cannot create repositories (API path blocked), so the user must create the empty repo once; work continues locally and is pushed as soon as access is granted (ADR-009).
- Ran Phases 1 → 7 (details in the per-phase entries of `CHANGELOG.md` and `BRIEF_COMPLIANCE.md`).

**Files touched:** `docs/prompts/PROMPT_LOG.md`, `docs/DECISIONS.md`, then the whole code base across Phases 1–7.
**Phase:** 0 → 7

---

## #03 — 2026-11-16 10:40 — GitHub repo created (mid-turn notes)
**Prompt (verbatim, two short mid-turn messages):**
> GitHub esr connecté

> C'est créé https://github.com/ArySid/ajean-ledger.git

**What was done:**
- Attached `ArySid/ajean-ledger` to the session with push access, added it as `origin` and pushed the full local history; pushes after every step since.
**Files touched:** none (git remote only)
**Phase:** 0 → 1

---

## #04 — 2026-11-16 10:45 — Hosting change: no Vercel, Cloudflare Workers (OpenNext) then Netlify
**Prompt (verbatim, original in French):**
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

**What was done:**
- ADR-017: Vercel abandoned (account paused until 2026-12-12); hosting = Cloudflare Workers via OpenNext first, Netlify second; storage = Cloudflare KV/D1 (or Neon direct), optional.
- Feasibility build with `@opennextjs/cloudflare` run locally (no account needed) to measure bundle size and CPU per request against the free-plan limits.
- Account creation + API token requested in "Action requise".
**Files touched:** `docs/prompts/PROMPT_LOG.md`, `docs/DECISIONS.md`, hosting config files (see CHANGELOG)
**Phase:** 5 (hosting)

---

## #05 — 2026-11-20 — Short recap of the product (question)
**Prompt (verbatim, original in French):**
> Tu peux me faire un mini recap du principe du logiciel, et en 2-3 phrases son intérêt, comment marche la rémunération et quel est le principe de base
> Fais ce que je t'ai dit.

**What was done:**
- Answered in chat (French, bullet points): base principle, value in 2–3 sentences, how the service gets paid (x402 per call in USDC/EURC, credit packs).
- No code change.
**Files touched:** `docs/prompts/PROMPT_LOG.md`, `docs/prompts/PROMPTS_SUBMISSION.md`
**Phase:** post-7 (Q&A)
