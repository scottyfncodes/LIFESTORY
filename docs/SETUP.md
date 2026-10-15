# LifeStory setup guide

## 1. Install dependencies

```bash
corepack enable          # pnpm 10 is pinned in package.json
pnpm install --frozen-lockfile
```

Node 22 is required (Vercel project is pinned to 22.x).

## 2. Configure environment variables

Copy `.env.example` to `.env.local` and fill in what you have. Every variable is documented in `.env.example`; the important groups:

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | production | Neon Postgres connection string. Omit locally to use PGlite. |
| `DATABASE_DRIVER` | local only | `pglite` for an embedded database (no server). |
| `PGLITE_DATA_DIR` | optional | Directory to persist the PGlite database between runs. |
| `BETTER_AUTH_SECRET` | yes | 32+ random bytes (`openssl rand -base64 32`). |
| `BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL` | production | Public origin, no trailing slash. Previews fall back to `VERCEL_URL`. |
| `AI_PROVIDER` + `ANTHROPIC_API_KEY` | for AI features | `anthropic` enables the AI interviewer, memory extraction and drafting. `none` keeps the typed interview working with the built-in planner. |
| `ANTHROPIC_MODEL` | optional | Defaults to `claude-opus-5-5`. |
| `TRANSCRIPTION_PROVIDER` + key | for server transcription | `openai` (`OPENAI_API_KEY`, optional `OPENAI_TRANSCRIPTION_MODEL`) or `deepgram` (`DEEPGRAM_API_KEY`). `none` offers browser dictation instead. |
| `STORAGE_PROVIDER` + `BLOB_READ_WRITE_TOKEN` | for recordings | `vercel-blob` with a **private** Blob store. `local` writes under `STORAGE_LOCAL_DIR` for development. |
| `CRON_SECRET` | production | Bearer token for `/api/jobs/run`. Vercel supplies it to the cron automatically when set. |
| `MAX_UPLOAD_MB`, `MAX_RECORDING_SECONDS`, `DEFAULT_AUDIO_RETENTION_DAYS` | optional | Operational limits. |
| `WEAVE_ENABLED` | optional | `1`/`true` enables Conversation Weave in that environment only. Off (unset) by default: pages and APIs return 404 and the security headers are unchanged. |
| `MAX_WEAVE_UPLOAD_MB`, `MAX_WEAVE_RECORDINGS` | optional | Conversation Weave limits: per-file size (default 500 MB, ceiling 2000) and recordings per conversation (default 20, ceiling 100). |

The app never crashes on missing provider keys: each capability reports itself as unavailable in the UI and in `/api/health`.

## 3. Provision the database

Production uses Neon. In the Vercel dashboard: **Storage → Create Database → Neon**, connect it to the `lifestory` project; Vercel injects `DATABASE_URL`.

> Current state: the production `DATABASE_URL` points at a database named `lifestory` inside the shared Neon project `curly-king-93952877` (console name *neon-blue-fence*), because the Neon organisation is Vercel-managed and new projects could not be created from this session. It is isolated at the database level but shares that project's compute quota and 512 MB logical-size limit. Moving to a dedicated Neon database is a copy-and-swap: create it, run `pnpm db:migrate` against it, `pg_dump`/`pg_restore` the `lifestory` database, update `DATABASE_URL`.

## 4. Run migrations

```bash
pnpm db:migrate          # applies ./drizzle/*.sql with the active driver
pnpm db:generate         # after editing src/db/schema/*.ts, creates a new migration
```

The Vercel build command is `pnpm db:migrate && pnpm build`, so every deployment migrates first. Migrations are journaled in `drizzle.__drizzle_migrations`.

## 5. Start locally

```bash
DATABASE_DRIVER=pglite PGLITE_DATA_DIR=.pglite pnpm db:migrate
DATABASE_DRIVER=pglite PGLITE_DATA_DIR=.pglite pnpm dev
```

Open http://localhost:3000. Set `AI_PROVIDER=fixture` and `TRANSCRIPTION_PROVIDER=fixture` to exercise every flow offline with deterministic stand-ins.

## 6. Run tests

```bash
pnpm typecheck
pnpm lint
pnpm test                # vitest: unit + integration on in-memory PGlite
PW_CHROMIUM_PATH=/path/to/chromium pnpm test:e2e   # Playwright, iPhone + desktop profiles
```

`pnpm test:e2e` starts its own dev server on port 3100 with PGlite, fixture providers, local storage and a 1 MB upload cap. Omit `PW_CHROMIUM_PATH` when Playwright's browsers are installed normally.

## 7. Configure AI and transcription

1. Add `ANTHROPIC_API_KEY` (Vercel → Project → Settings → Environment Variables, *Sensitive*).
2. Set `AI_PROVIDER=anthropic`.
3. For voice transcription add `OPENAI_API_KEY` and `TRANSCRIPTION_PROVIDER=openai` (or Deepgram equivalents).
4. Create a private Blob store (Vercel → Storage → Blob → **Private**), connect it to the project; it injects `BLOB_READ_WRITE_TOKEN`. Keep `STORAGE_PROVIDER=vercel-blob`.
5. Redeploy. `/api/health` shows `ai`, `transcription` and `storage` as configured.

## 7a. Enable Conversation Weave in an environment

Conversation Weave stores original recordings, which can be hundreds of megabytes, so browsers upload them **directly to private Vercel Blob storage** with a short-lived token scoped to one file; the bytes never pass through a serverless function.

1. In Vercel → Storage, create a Blob store with **private** access for **Preview** and a **separate** private store for **Production**. Connect each to the `lifestory` project for its environment only. That sets `BLOB_READ_WRITE_TOKEN` per environment.
2. In that environment set `STORAGE_PROVIDER=vercel-blob` and `WEAVE_ENABLED=1`, then redeploy. The flag is read at build time for the Content-Security-Policy (it adds `https://vercel.com/api/blob/` to `connect-src` and `https://*.private.blob.vercel-storage.com` to `media-src`) and at request time for pages and APIs.
3. Migration `0003_weave_recordings` must be applied (`pnpm db:migrate`). It only adds tables, enum types and three defaulted columns on `media_assets`.
4. Check: create a conversation, upload an M4A from an iPhone, play it and seek, then delete the conversation and confirm the object is gone from the Blob store browser.

Without a Blob store (local development and e2e), uploads go through `PUT …/content` to local storage and playback streams with Range support.

## 8. Deploy

The GitHub repository `scottyfncodes/LIFESTORY` is linked to Vercel project `lifestory` (team `nocodo`). Pushes to `main` deploy to production; pull requests get preview deployments (protected by Vercel Authentication; team members can open them).

## 9. Verify production

- `https://lifestory-nocodo.vercel.app/api/health` → `{"status":"ok","database":"ok",...}`
- Sign up, create a memoir, answer a question, reload, confirm it persisted.
- Check Vercel → Logs for `job.succeeded` entries after an answer.

## 10. Rotate credentials and troubleshoot

- **Rotate `BETTER_AUTH_SECRET`**: all sessions are invalidated; users sign in again.
- **Rotate `DATABASE_URL`**: Neon → Roles → reset password, update the variable, redeploy.
- **Rotate provider keys**: replace the variable, redeploy; failed jobs retry automatically with backoff.
- **"Sign-in is not configured"**: `BETTER_AUTH_SECRET` is missing.
- **"Recordings can't be stored on this server yet"**: no private Blob store; typed answers and dictation still work.
- **Drafting says not configured**: `AI_PROVIDER`/`ANTHROPIC_API_KEY` missing.
- **Jobs stuck**: `GET /api/jobs/run` with `Authorization: Bearer $CRON_SECRET` drains the queue; stale locks are reclaimed after 10 minutes. The scheduled drain is daily on the Hobby plan (`vercel.json`).
