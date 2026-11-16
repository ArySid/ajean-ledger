# Deliverables — Ajean Ledger

Course: *Digital Transformation & FinTech — The AI Agent Economy Challenge*. Team: Ary SIDOUN, Victor BONNAPETIT, Yoann POMMEROLLE, Leo COUTURIER.
**PoC (shareable link):** <https://ajean-ledger.ary-sidoun.workers.dev>. It runs in TESTNET mode on Cloudflare Workers (free plan), with real x402 settlements in test USDC on Base Sepolia, e.g. [scenario 03](https://sepolia.basescan.org/tx/0xc1554772f5b9cef69564f6f621d1a12ae5af113d1723cceeec685b28e5b23586).

| Deliverable (brief) | Source (Markdown) | PDF (A4) | Pages |
|---|---|---|---|
| Concept note (max 2 pages) | [`CONCEPT_NOTE.md`](./CONCEPT_NOTE.md) | [`pdf/CONCEPT_NOTE.pdf`](./pdf/CONCEPT_NOTE.pdf) | **2** (≈ 1,020 words) |
| Live demo script (2–3 min) | [`DEMO_SCRIPT.md`](./DEMO_SCRIPT.md) | [`pdf/DEMO_SCRIPT.pdf`](./pdf/DEMO_SCRIPT.pdf) | 4 |
| Slides outline (6–8 slides, 8–10 min) | [`SLIDES_OUTLINE.md`](./SLIDES_OUTLINE.md) | [`pdf/SLIDES_OUTLINE.pdf`](./pdf/SLIDES_OUTLINE.pdf) | 4 |
| Q&A preparation | [`QA_PREP.md`](./QA_PREP.md) | [`pdf/QA_PREP.pdf`](./pdf/QA_PREP.pdf) | 4 |
| Prompts used to build the prototype | [`../docs/prompts/PROMPTS_SUBMISSION.md`](../docs/prompts/PROMPTS_SUBMISSION.md) | [`pdf/PROMPTS_SUBMISSION.pdf`](./pdf/PROMPTS_SUBMISSION.pdf) | 12 (incl. the master prompt verbatim) |
| Requirement → evidence map | [`../docs/BRIEF_COMPLIANCE.md`](../docs/BRIEF_COMPLIANCE.md) | — | — |

Each PDF has a styled HTML twin in [`pdf/`](./pdf/). To regenerate them after editing a Markdown file:

```bash
npm run export:deliverables                 # all five
npm run export:deliverables -- --only CONCEPT_NOTE
```

The command is [`scripts/export-deliverables.ts`](../scripts/export-deliverables.ts). It uses a minimal Markdown → HTML converter, then Playwright Chromium `page.pdf` (A4, ~2 cm margins, 10–10.25 pt body), and counts pages with pdf-lib. It **fails if the concept note goes over 2 pages**. Playwright is not a project dependency: the script resolves it from the project or from the global npm root (`npm i -g playwright && npx playwright install chromium` on a new machine).

**Left for the team** (listed at the top of `DEMO_SCRIPT.md` and `SLIDES_OUTLINE.md`):
- the roles `{{NARRATOR}}`, `{{DRIVER}}` and `{{BACKUP}}`;
- the backup video `{{BACKUP_VIDEO_PATH}}`;
- the `/operator` reset decision `{{OPERATOR_RESET_DECISION}}`;
- the code word `{{CODE_WORD}}`;
- the closing ask `{{ASK}}`;
- the speakers per slide and the slide deck itself;
- two rehearsals;
- Ary's sign-off of the legal references (`docs/LEGAL_REVIEW.md`).
