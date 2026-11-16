# Prompt Log — Ajean Ledger

Every message sent to the AI engineering assistant during the build, in order.
Required by the course brief ("submit the prompts used to develop the prototype").
Times are UTC.

---

## #01 — 2026-11-16 09:49 — Master prompt: project kick-off (Phase 0)
**Prompt (verbatim):**
> The full master prompt (≈ 400 lines). It is stored **verbatim and unabridged** in
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
