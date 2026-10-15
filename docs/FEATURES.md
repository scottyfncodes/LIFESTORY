# Feature completion matrix

Legend: **Working** = implemented and covered by automated tests; **Partial** = implemented with a documented gap; **Unavailable** = not built or blocked.

| Area | Status | Notes |
| --- | --- | --- |
| Landing page, privacy page | Working | No invented testimonials or counts. |
| Sign up / sign in / sign out | Working | Server actions; progressive enhancement. |
| Onboarding (title, narrator, mode, scope, style, topics to avoid, acknowledgment) | Working | |
| Home with "Continue your story", recent session, project list | Working | No fabricated completion percentages. |
| Multiple projects per user | Working | |
| Authorization (owner / member roles, fail-closed 404) | Working | Unit, integration and e2e (API + pages). |
| Interview sessions, ordered turns, idempotent retries | Working | |
| Typed answers, autosaved drafts, retry after failure/refresh | Working | |
| Skip, pause, resume, finish, new conversation, history | Working | |
| Correcting a saved answer (original kept) | Working | Triggers re-extraction. |
| AI interviewer (context-aware follow-ups) | Working with `AI_PROVIDER=anthropic` | Validated against repetition/avoided topics; template planner fallback always available. Not configured on the current production deployment. |
| Rule-based planner without AI | Working | Coverage model, no repeats, avoided-topic filtering. |
| Recording (MediaRecorder), upload, private storage | Working locally; **Unavailable in production** | Needs a private Vercel Blob store (token here cannot create one). |
| Server transcription (OpenAI / Deepgram) | Working (adapters, fixture-tested) | Not configured in production; real-provider call not verified from this session. |
| Transcript review and correction before saving | Working | |
| Browser dictation fallback with disclosure | Working | Depends on browser support. |
| Audio playback and deletion (transcript kept) | Working | |
| Memory extraction (people, events, facts, relationships, threads) | Working with AI | Fixture-tested pipeline; Anthropic prompts untested against a live key. |
| Verification policy, conflicts, possible duplicates, review queue | Working | |
| Timeline (periods, approximate dates, edit, merge, reorder, notes) | Working | |
| People (list, detail, edit, aliases, merge, confirm/reject) | Working | |
| Story threads (set aside / exclude) | Working | |
| Biography summary refresh | Working with AI | |
| Chapter proposal from answers | Working with AI | |
| Source-grounded drafting, flags, follow-up suggestions | Working with AI | |
| User edits as revisions, conflict detection, restore | Working | |
| Passage-level rework, whole-chapter revise with instructions | Working with AI | |
| Chapters flagged when sources change | Working | |
| Full-book preview | Working | |
| PDF export (title page, contents, headings, page numbers) | Working | Standard Times fonts; CJK/emoji glyphs are not embedded. |
| DOCX export (heading styles, TOC field, page numbers) | Working | Word updates the TOC on open. |
| Project JSON export | Working | |
| Project deletion (two-phase, media purge) | Working | |
| Account deletion | Working | Password re-entry; owned projects purged. |
| Audio retention expiry | Working | Runs from the cron route. |
| Rate limits, request validation, upload sniffing, CSRF, security headers | Working | |
| Durable jobs (after + cron), backoff, stale-lock recovery | Working | Cron is hourly; `after()` handles the common path. |
| Health endpoint | Working | |
| Remote interviews (separate narrator accounts, invitations) | Unavailable | Schema and authorization ready; no UI by design. |
| Real-iPhone verification | Unavailable from this environment | See `docs/QA-IPHONE.md`. |
