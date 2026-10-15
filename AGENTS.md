# Notes for coding agents

- Read `docs/ARCHITECTURE.md` first. Authorization lives in `src/server/authz.ts`; every project-scoped server function must go through `requireProjectAccess` and treat "no access" as not-found.
- Never log memoir content, transcripts, credentials or provider payloads. Use `src/server/logger.ts` with ids, codes and counts.
- Model output is untrusted: it must pass the Zod schemas in `src/server/ai/types.ts`. Prompt text is versioned in `src/server/ai/prompts/`.
- Answers are append-only facts; corrections go in `corrected_text`. Chapter text is never overwritten: add a `manuscript_revisions` row.
- Schema changes: edit `src/db/schema/*.ts`, run `pnpm db:generate`, commit the migration. Never edit applied migrations.
- Tests run on in-memory PGlite (`tests/helpers/db.ts`). Use the fixture AI/transcription providers; no test may call a paid API.
- Run `pnpm typecheck && pnpm lint && pnpm test` before pushing; `pnpm test:e2e` for UI changes.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
