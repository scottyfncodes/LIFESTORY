# Moving LIFESTORY's database to its own Neon project

**Status: proposal. Nothing here has been done.** Every step that touches
Neon, Vercel or the production database needs the owner to carry it out or
explicitly approve it.

## Why

Checked on 2026-10-28 with read-only Neon and Vercel API calls:

- LIFESTORY's production data is the `lifestory` database on the `main`
  branch of Neon project `curly-king-93952877` ("neon-blue-fence"). The same
  project's `neondb` database holds HangarBook's **Preview** data, and an
  empty `lifestory_test` sits beside them (`docs/SETUP.md`, `docs/PLAN.md`,
  and HangarBook's `docs/disaster-recovery.md` all agree).
- Both databases are owned by `neondb_owner`. That is very likely the role
  HangarBook's Preview deployments connect with, which would let any
  HangarBook preview build open LIFESTORY's production data. (Inferred from
  ownership; no credentials were decrypted to confirm it.)
- The two apps share one compute and one 512 MB size limit. Resetting,
  restoring or deleting "HangarBook's preview project" would take LIFESTORY
  production with it.
- LIFESTORY's Preview deployments already use their own Neon project
  (`ancient-tree-72533945`), so only Production needs to move.
- History is six hours (`history_retention_seconds: 21600`), so turn on the
  nightly backup (`docs/backups.md`) before or right after the move.

## The move: copy, check, switch, keep the old one

LIFESTORY is not public yet, so a short write freeze is cheap. Plan about 30
minutes.

1. **Make the new database.** In Vercel > Storage, create a Neon database for
   the `lifestory` project, connected to **Production only**, with an
   environment-variable prefix such as `NEWDB_`. The prefix means the
   integration adds `NEWDB_DATABASE_URL` and friends instead of replacing the
   live `DATABASE_URL`. Nothing changes for users yet.
2. **Rehearse.** Restore last night's backup (or a fresh dump) into a Neon
   branch of the new project and run `scripts/compare-databases.sh` against
   the source. It must print `Identical`.
3. **Freeze writes** on the old database. This is reversible and leaves the
   data untouched:
   ```sql
   alter database lifestory set default_transaction_read_only = on;
   ```
   New connections can read but not write. Visitors see errors on save for
   the next few minutes, which is acceptable before launch.
4. **Copy.** With the old database's direct (non `-pooler`) URL:
   ```sh
   pg_dump "<old url>" --format=custom --no-owner --no-privileges \
     --exclude-schema=neon_auth --file=lifestory.dump
   pg_restore --exit-on-error --no-owner --no-privileges \
     --dbname "<new url>" lifestory.dump
   ```
   Use Postgres 18 tools (both projects run Postgres 18).
5. **Prove the copy.** This runs read-only on both sides and compares every
   table's row count and a checksum of every row, the Drizzle migration
   journal included:
   ```sh
   scripts/compare-databases.sh "<old url>" "<new url>"
   ```
   It must print `Identical`. If it doesn't, stop here: unfreeze the old
   database (step 8 below) and nothing has changed.
6. **Switch.** In Vercel, set Production's `DATABASE_URL` (and any unpooled
   or `POSTGRES_*` variants the app reads) to the new database's values, then
   redeploy Production. Check sign-in, opening a project and adding a
   memory.
7. **Point the backup at the new database:** a new read-only role there
   (`docs/backups.md`, step 3) and an updated `BACKUP_DATABASE_URL` secret.
   Run the backup once by hand.
8. **Keep the old database frozen for 14 days** as a fallback. To roll back
   inside that window: set `DATABASE_URL` back, redeploy, and unfreeze with
   `alter database lifestory reset default_transaction_read_only;`. Anything
   written to the new database after the switch would need copying back.
9. **Later, separately approved:** drop the old `lifestory` and
   `lifestory_test` databases from `curly-king-93952877`, and rotate
   `neondb_owner`'s password there so old credentials can't reach anything.
   HangarBook's Preview deployments keep working because their own database
   stays.

## Rehearsed locally

On 2026-10-28, against a local Postgres built from this repo's migrations
(30 tables plus a Drizzle journal, 200+ rows):

- The dump and restore (steps 4 and 5) produced a copy owned by a different
  role, and `compare-databases.sh` reported `Identical: 31 tables`.
- A row edited on the source after the copy was reported as a difference
  (exit 1), and so was a missing migration-journal row.
- `default_transaction_read_only` blocked writes and was fully reversible.
- The comparison made no writes, even when run as the owner role.

Not rehearsed: the Vercel integration with a prefix, and the real Neon
projects. Those happen only with the owner.

## Until the move

If the move waits, the cheapest reduction in risk is to make sure nobody
resets, restores or deletes `curly-king-93952877` while cleaning up HangarBook
previews. Its `main` branch is already protected from deletion by Vercel
("vercel production branch"), but a restore or reset would still overwrite
LIFESTORY.
