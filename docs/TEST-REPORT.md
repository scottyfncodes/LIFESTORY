# Test report

All runs below were executed in the build environment on 2026-10-15 against commit range `main..milestone-6-release`. Automated providers were the deterministic fixtures; no paid API was called.

## Quality gates

| Gate | Command | Result |
| --- | --- | --- |
| Type check | `pnpm typecheck` | pass |
| Lint | `pnpm lint` | pass (0 errors, 0 warnings) |
| Unit + integration | `pnpm test` | **59 passed / 59** across 11 files |
| Production build | `pnpm build` | pass (Next.js 16.4.1) |
| Migrations | `pnpm db:migrate` on PGlite and on the Neon production database (via the Vercel build) | applied: `0000_init`, `0001_memory_user_verified`, `0002_chapter_planned_sources` |
| End-to-end | `pnpm test:e2e` (iPhone 14 emulation + desktop Chrome) | see below |
| Secrets in repo | `.env*` ignored; `git grep` for key prefixes | none committed |

## Unit tests (`tests/unit`)

- `authz.test.ts`: role permission matrix, narrowing-only grants, UUID validation.
- `validation.test.ts`: onboarding schema, topic splitting, privacy acknowledgment.
- `reconcile.test.ts`: name matching (exact / possible / none, accents), date precision (never upgraded), event similarity and conflicts, fact verification policy, contradiction vs refinement.
- `export.test.ts`: book model assembly, filename safety, 60-paragraph multi-page PDF, DOCX zip with Heading1 styles, TOC field and CJK text.
- `security.test.ts`: same-origin enforcement, error payloads never leak internals, error-code reduction for logs, upload magic-byte sniffing.
- `prompt-safety.test.ts`: model-output schema rejection (extra enum values, overlong text, impossible dates), question normalisation for repeat detection.

## Integration tests (`tests/integration`, in-memory PGlite, real Better Auth)

- `projects.test.ts`: create/reopen, hosted projects don't bind the narrator, cross-user denial on read/update/list, manipulated ids, revoked memberships, settings persistence, rate-limit window.
- `interviews.test.ts`: opening question and resume, ordered turns, idempotent retries, answer kept when the AI provider throws (planner fallback), no repeated template questions, avoided topics, corrections keep originals and re-queue extraction, pause/finish/new session, cross-user denial.
- `memory.test.ts`: extraction through the job queue, exact-name reuse, possible-duplicate flagging, safe re-processing after a correction, honest "no AI" result.
- `manuscript.test.ts`: chapter proposal with sources, drafting as an immutable revision, user-edit preservation with conflict detection, revise + restore, manuscript assembly, cross-user denial.
- `deletion.test.ts`: two-phase deletion fails closed and purges storage + rows, purge retries after storage failure, audio retention keeps transcripts, JSON export completeness.

## End-to-end (`tests/e2e`, Playwright, Chromium)

Profiles: `iphone` (iPhone 14 viewport, touch, fake microphone) and `desktop`.

| Spec | Scenario | iPhone | Desktop |
| --- | --- | --- | --- |
| foundation | landing, redirect when signed out, sign up → create → reopen → sign out/in, project hidden from another account | pass | pass |
| interview | typed answer → follow-up → reload → skip → pause → resume; record → transcript review → correct → keep → play back → edit saved answer; draft survives reload | pass | pass |
| memory | answer → people → edit person → timeline edit → review confirm | pass | pass |
| book | propose chapters → draft → edit → restore → preview → PDF + DOCX download | pass | pass |
| security (API level) | second user gets 404 everywhere; anonymous 401; cross-site 403; bad/oversize uploads 422; manipulated ids; deletion removes access and purges | pass | pass |
| visual | every key screen renders without horizontal overflow; screenshots captured | pass | pass |

Final consolidated run: see the bottom of this file.

## Not verified

- Real Anthropic, OpenAI and Deepgram calls (no credentials available in the session).
- Vercel Blob private storage in production (store could not be created with the available token).
- Real iPhone / Safari behaviour (see `docs/QA-IPHONE.md`).
