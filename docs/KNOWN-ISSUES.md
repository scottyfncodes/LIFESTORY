# Known issues and remaining risks

## Blockers needing your action

1. **AI not enabled in production.** `AI_PROVIDER=none`. Add `ANTHROPIC_API_KEY` and set `AI_PROVIDER=anthropic` in Vercel. Until then the interview uses the built-in planner only, and memory extraction / drafting are disabled with honest messages.
2. **No private Blob store.** Recording upload reports itself unavailable in production. Create a *private* Blob store in Vercel Storage and connect it to the `lifestory` project.
3. **Transcription not enabled.** Add `OPENAI_API_KEY` (or `DEEPGRAM_API_KEY`) and the matching `TRANSCRIPTION_PROVIDER`.
4. **Shared Neon project.** The `lifestory` database lives inside another app's Neon project (see `docs/SETUP.md` §3). Move it to a dedicated database when convenient.
5. **Real-device testing** has not happened (`docs/QA-IPHONE.md`).

## Unverified integrations

- The Anthropic adapter, OpenAI and Deepgram adapters are implemented against the documented APIs and exercised only with deterministic fixtures. First use with real keys should be watched in Vercel logs (`ai.operation_failed`, `media.transcription_failed`).
- The Vercel team is on the Hobby plan, so the job-drain cron in `vercel.json` runs once a day (`0 4 * * *`); an hourly schedule was rejected at deploy time. The `after()` drain after each request and the UI's status polling handle the normal path; the daily cron is the safety net for anything an instance dropped. Upgrading to Pro allows a more frequent schedule.

## Product gaps

- Source references are per revision (which answers a chapter drew on) plus flagged passages, not character-level highlights.
- Chapter reordering is by up/down buttons, not drag and drop.
- The PDF embeds only the standard Times fonts; names in non-Latin scripts render as missing glyphs. Embedding a Unicode font is a small follow-up.
- Vercel Authentication protects preview deployments; only team members can open PR previews.
- No email verification or password reset flow (Better Auth supports both; needs an email provider).

## Risks

- Serverless request bodies are capped at 4.5 MB on Vercel; `MAX_RECORDING_SECONDS` defaults to 600 but Safari's AAC output could exceed the cap for very long answers. Lower the limit or switch to direct-to-Blob client uploads if that is hit.
- `after()` keeps work alive on Vercel Fluid compute; if an instance is reclaimed, the hourly cron finishes the job.
