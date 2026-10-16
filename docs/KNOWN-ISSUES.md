# Known issues and remaining risks

## Blockers needing your action

1. **AI not enabled in production.** `AI_PROVIDER=none`. Add `ANTHROPIC_API_KEY` and set `AI_PROVIDER=anthropic` in Vercel. Until then the interview uses the built-in planner only, and memory extraction / drafting are disabled with honest messages.
2. **No private Blob store.** Recording upload reports itself unavailable in production. Create a *private* Blob store in Vercel Storage and connect it to the `lifestory` project.
3. **Transcription not enabled.** Add `OPENAI_API_KEY` (or `DEEPGRAM_API_KEY`) and the matching `TRANSCRIPTION_PROVIDER`.
4. **Shared Neon project.** The `lifestory` database lives inside another app's Neon project (see `docs/SETUP.md` §3). Move it to a dedicated database when convenient.
5. **Real-device testing** has not happened (`docs/QA-IPHONE.md`).
6. **Conversation Weave needs private Blob stores before it can be enabled anywhere on Vercel.** Create one private store for Preview and a separate one for Production, then set `STORAGE_PROVIDER=vercel-blob` and `WEAVE_ENABLED=1` per environment (`docs/SETUP.md` §7a). Until then it stays off.

## Unverified integrations

- The Anthropic adapter, OpenAI and Deepgram adapters are implemented against the documented APIs and exercised only with deterministic fixtures. First use with real keys should be watched in Vercel logs (`ai.operation_failed`, `media.transcription_failed`).
- The Vercel team is on the Hobby plan, so the job-drain cron in `vercel.json` runs once a day (`0 4 * * *`); an hourly schedule was rejected at deploy time. The `after()` drain after each request and the UI's status polling handle the normal path; the daily cron is the safety net for anything an instance dropped. Upgrading to Pro allows a more frequent schedule.

- Conversation Weave direct uploads (`upload` → `handleUpload` with a read-write token, or `uploadPresigned` → `handleUploadPresigned` under OIDC) and presigned playback (`issueSignedToken` + `presignUrl`) have not been exercised end to end from a browser against a real Blob store. Token contents are verified with the SDK's own generator in tests; the first Preview run should confirm an upload of a long M4A, playback seeking, and deletion. Recovery from the 5-minute link expiry (resume or seek after a long pause keeps the position) is verified in desktop Chromium, in e2e with a simulated clock and on Preview with a real expired link; it still needs confirming in iPhone Safari, which may require a second tap on Play after a very long pause (the position is kept either way).

## Product gaps

- Source references are per revision (which answers a chapter drew on) plus flagged passages, not character-level highlights.
- Chapter reordering is by up/down buttons, not drag and drop.
- The PDF embeds only the standard Times fonts; names in non-Latin scripts render as missing glyphs. Embedding a Unicode font is a small follow-up.
- Vercel Authentication protects preview deployments; only team members can open PR previews.
- No email verification or password reset flow (Better Auth supports both; needs an email provider).

- Conversation Weave W1 has no UI for renaming a conversation or editing its participants after creation (the API supports it), and no transcription or weaving yet.
- An abandoned direct upload (browser closed mid-upload) leaves a reserved, incomplete recording that the user can remove; it is also removed with its conversation, project or account. There is no automatic sweeper.

## Risks

- Serverless request bodies are capped at 4.5 MB on Vercel; `MAX_RECORDING_SECONDS` defaults to 600 but Safari's AAC output could exceed the cap for very long answers. Lower the limit or switch to direct-to-Blob client uploads if that is hit.
- `after()` keeps work alive on Vercel Fluid compute; if an instance is reclaimed, the hourly cron finishes the job.
