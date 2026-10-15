# LifeStory

*A life worth remembering.* LifeStory by HaveAnApp interviews people about their lives, keeps their memories in structured form, and turns them into an editable memoir in their own voice.

- Production: https://lifestory-nocodo.vercel.app
- Health: https://lifestory-nocodo.vercel.app/api/health

## Documentation

| Document | Contents |
| --- | --- |
| [docs/SETUP.md](docs/SETUP.md) | Install, environment variables, database, migrations, local run, tests, providers, deploy, verify, rotate. |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Stack, layers, request flow, deviations from the brief. |
| [docs/PRIVACY.md](docs/PRIVACY.md) | What is stored, who processes it, consent, deletion and backup retention. |
| [docs/FEATURES.md](docs/FEATURES.md) | Working / partial / unavailable matrix. |
| [docs/TEST-REPORT.md](docs/TEST-REPORT.md) | What was run and the results. |
| [docs/QA-IPHONE.md](docs/QA-IPHONE.md) | Real-device checklist (not yet performed). |
| [docs/KNOWN-ISSUES.md](docs/KNOWN-ISSUES.md) | Blockers, unverified integrations, gaps, risks. |
| [docs/PLAN.md](docs/PLAN.md) | Milestone plan and status. |

## Quick start

```bash
pnpm install
cp .env.example .env.local        # set BETTER_AUTH_SECRET at minimum
DATABASE_DRIVER=pglite PGLITE_DATA_DIR=.pglite pnpm db:migrate
DATABASE_DRIVER=pglite PGLITE_DATA_DIR=.pglite AI_PROVIDER=fixture TRANSCRIPTION_PROVIDER=fixture pnpm dev
```

## Scripts

`pnpm dev` · `pnpm build` · `pnpm start` · `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm test:e2e` · `pnpm db:generate` · `pnpm db:migrate`
