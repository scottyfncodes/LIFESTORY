# LifeStory implementation plan

Status key: `[x]` done, `[~]` partial, `[ ]` not started. Updated as milestones land.

## Repository state at start

The repository `scottyfncodes/LIFE-STORY` was empty (no commits). There was no
existing code to preserve. The stack below was chosen from the specification.

## Infrastructure found

| Dependency | Finding | Decision |
| --- | --- | --- |
| Neon Postgres | Four Neon projects exist in a Vercel-managed Neon org; every one already belongs to another HaveAnApp product. New projects cannot be created through the Neon API because the org is managed by Vercel. | Created two *databases* (`lifestory`, `lifestory_test`) on the lightly used `neon-blue-fence` project (`curly-king-93952877`). This is isolated at the database level but shares that project's compute and storage quota. **Recommended follow-up:** provision a dedicated Neon database from the Vercel Storage tab and rotate `DATABASE_URL`. |
| Vercel | Team `nocodo` exists with the GitHub integration installed for `scottyfncodes`. The empty repo is not yet visible to the integration. | Link the project after the first push. |
| Private object storage | None provisioned. | Use Vercel Blob with `access: "private"`; create a store attached to the Vercel project. A local filesystem adapter backs development and tests. |
| AI provider | No API key available in this session. | Anthropic adapter (`@anthropic-ai/sdk`, structured outputs) behind a provider interface, plus a deterministic fixture provider for tests. Without a key the interviewer runs the rule-based planner and drafting is disabled with an honest message. |
| Transcription | No key available. | OpenAI and Deepgram adapters behind a provider interface. Without a key, voice recording is still offered via the browser's on-device speech recognition with a clear disclosure, and typed answers always work. |
| Sandbox network | Only HTTPS through a policy proxy; the Neon hosts are blocked. | PGlite for local dev/tests; migrations applied to Neon through the Neon MCP tool during this session and via `pnpm db:migrate` in the Vercel build step afterwards. |

## Architecture

- Next.js 16 App Router, React 19, TypeScript strict, Tailwind v4.
- Drizzle ORM. Production driver: Neon serverless (WebSocket, transactional). Dev/test driver: PGlite.
- Better Auth (email + password) with the Drizzle adapter.
- Server actions and route handlers validated with Zod at every trust boundary.
- Authorization is centralised in `src/server/authz.ts`; every project-scoped
  service call resolves access through it.
- Durable job table (`processing_jobs`) drained by `after()` work in the same
  request plus a cron route, so nothing depends on in-memory background work.
- Provider abstraction in `src/server/ai` (interview planner, extraction,
  reconciliation, drafting, review) and `src/server/transcription`.
- Exports: PDF via `@react-pdf/renderer`, DOCX via `docx`.

## Milestones

### Milestone 1: Foundation `[x]`
- Schema + migrations, auth, project ownership + authorization, landing,
  onboarding, app shell, test infrastructure.
- Acceptance: sign in, create a private project, reopen it, cannot access
  another user's project (tested).

### Milestone 2: Interview experience `[x]`
- Sessions, ordered idempotent turns, autosave, voice recording + upload +
  transcription + correction, text/voice switching, pause/resume/skip/finish,
  truthful fallbacks.
- Acceptance: complete and resume a session without losing saved answers (tested).

### Milestone 3: Biographical memory `[ ]`
- Facts, people, relationships, events, story threads; structured extraction +
  reconciliation; coverage-aware planner; timeline and people views;
  confirmation workflows.
- Acceptance: a relevant follow-up is asked using earlier answers, without
  repetition or invented facts (tested with fixture provider).

### Milestone 4: Manuscript `[ ]`
- Chapters, immutable revisions, source-grounded drafts, user edits preserved,
  flags, PDF + DOCX export, preview, restore.
- Acceptance: saved answers become a coherent editable manuscript with
  traceable sources (tested).

### Milestone 5: Security and reliability `[ ]`
- Authorization coverage, upload hardening, rate limits, bounded retries,
  deletion/export, diagnostics without content logging.

### Milestone 6: Release and polish `[ ]`
- Responsive refinement, states, full test run, deployment, QA report, docs.
