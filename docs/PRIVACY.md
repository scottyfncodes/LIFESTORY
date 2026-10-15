# Privacy, consent and data handling (implementation notes)

This documents what the code does. It is not a legal compliance statement; have counsel review before making claims to users.

## Data classes

| Data | Where | Retention |
| --- | --- | --- |
| Account (name, email, password hash, sessions) | `users`, `auth_*` | Until account deletion. |
| Answers (typed / transcribed, original + corrected) | `interview_turns` | Until project deletion. |
| Recordings | Private object storage (`media_assets.storage_key`) | Per-project setting (default 90 days), or until deleted by the user; transcripts survive audio deletion. |
| Memory (people, events, facts, threads) | `people`, `life_events`, `memory_facts`, `story_threads` | Until project deletion. |
| Manuscript revisions | `manuscript_revisions` | Until project deletion. |
| Audit events | `audit_events` | Ids only; retained after project deletion (no content). |
| Usage telemetry | `usage_events` | Token counts, durations, error codes; no content. |

## Processing by third parties

- **Anthropic** (when `AI_PROVIDER=anthropic`): questions, extraction, summaries, drafts. Answers and derived notes are sent as data wrapped in delimiters; the system prompts instruct the model to treat transcript text as data and never as instructions. No training on inputs under the API terms; LifeStory itself never trains anything.
- **OpenAI or Deepgram** (when configured): audio bytes for transcription.
- **Browser speech recognition** (dictation fallback): audio may be processed by the browser vendor; the UI says so before use, and nothing is saved until the user presses Save.
- **Vercel** hosting, Blob storage; **Neon** database.

## Consent records

`consent_records` stores `privacy_acknowledgment` and `ai_processing` at project creation and `audio_recording` on the first upload per user and project, with a policy version.

## Deletion

- **Recording**: deleted from storage immediately; the transcript is kept on the turn.
- **Project**: marked deleted (all access fails closed at once) → job removes every recording from storage → project row is hard-deleted, cascading to every dependent table. The job retries until storage deletion succeeds.
- **Account**: Better Auth `deleteUser` (password re-entry) → all owned projects go through project deletion → user row deleted (cascades to sessions and accounts).
- **Backups**: Neon point-in-time history on the current project is 6 hours; Vercel Blob deletions are immediate at the API and propagate through its CDN within minutes. After those windows nothing remains. The settings page states this next to the delete control.

## Not implemented / not claimed

- No end-to-end encryption (TLS in transit, provider encryption at rest).
- No public sharing, indexing or advertising: private routes send `X-Robots-Tag: noindex`; the only indexable pages are the landing page and this policy.
- No model training opt-in exists, so none is offered.
