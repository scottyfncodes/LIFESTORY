# Backups

Neon's Free plan keeps six hours of history. A mistake noticed the next
morning, or an account takeover that deletes the project, cannot be undone
from Neon alone. These backups keep an encrypted copy of production data
somewhere the Vercel, Neon and GitHub logins cannot delete.

The scripts are adapted from HangarBook's backup scripts and pass the same
checks, run here against this app's own migrations.

## What is backed up

| Data | How | Script |
|---|---|---|
| The production database (every schema except Neon Auth's `neon_auth`) | Nightly `pg_dump` | `scripts/backup-db.sh` |
| Uploaded files in the Production Vercel Blob store | Nightly, each file once (again every 90 days) plus a manifest of every pathname | `scripts/backup-blobs.sh` |

**LIFESTORY today:** the production database is the `lifestory` database inside the Neon project `curly-king-93952877`, which also holds HangarBook's Preview data. Create the backup role while connected to the `lifestory` database. See `docs/neon-separation.md` for moving it to its own project; the backup works the same before and after.

## What every run checks

A run uploads nothing, and fails loudly, unless all of this holds:

- **Read-only.** The database role cannot change any data (`scripts/backup-db.sh` checks the role's privileges before dumping).
- **A whole, faithful copy.** Every table is counted inside the same snapshot `pg_dump` reads. The dump is then restored in full into an empty Postgres on the runner, and every table's row count must match. The `users` table must not be empty.
- **Every file, whole.** Each Blob file must download at its listed size and match its SHA-256; a file that cannot be read stops the run.
- **Locked.** The bucket has Object Lock on, in COMPLIANCE mode, for at least 30 days. Nobody can shorten that, including us.
- **Encrypted before it leaves.** Files are encrypted to an [age](https://age-encryption.org) public key. The private key is kept offline and never put in GitHub, Vercel, Neon or the bucket.

`npm run test:backup` and `npm run test:backup-blobs` proves these checks against a local Postgres with the upload stubbed (no real data or secrets involved).

## Turning it on (owner only)

Nothing runs until these are done. The workflow is `.github/workflows/backup.yml`, scheduled at 7:23 UTC.

1. **Key pair**, on your own computer: `age-keygen -o lifestory-backup.key`. Keep the file offline in two places (printed, and in a password manager). Its public key (`age1…`) goes in GitHub below. One key for all apps is fine; one per app limits what a lost key exposes.
2. **Bucket.** Reuse HangarBook's Backblaze B2 bucket (Object Lock, COMPLIANCE, 30 days, files removed after a year); this app writes under `lifestory/`. Make an application key for this app alone, limited to the `lifestory/` name prefix, with only `writeFiles` and `readBucketRetentions` (no `deleteFiles`, `writeFileRetentions` or `bypassGovernance`).
3. **Read-only database role**, in Neon's SQL editor on the production branch (connected to the `lifestory` database):

   ```sql
   create role lifestory_backup with login password '<long random string>';
   grant pg_read_all_data to lifestory_backup;
   ```

   Use the **direct** connection string (host without `-pooler`) with this role.
4. **Blob token.** Copy the Production Blob store's read-write token (Vercel > Storage > the store > `.env.local` tab). Vercel has no read-only Blob token, so this secret can also change files: keep it only in the `backup` environment below.

5. **GitHub.** Create the environment `backup` (Settings > Environments) limited to the `main` branch, and add:
   - secrets: `BACKUP_DATABASE_URL`, `BACKUP_S3_KEY_ID`, `BACKUP_S3_SECRET`, `BACKUP_BLOB_READ_WRITE_TOKEN`
   - variables: `BACKUP_AGE_RECIPIENT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_ENDPOINT`, `BACKUP_S3_REGION`
6. **Switch on:** add the repository variable `BACKUP_ENABLED` = `true`, then run the workflow once by hand (Actions > Nightly backup > Run workflow) and check the bucket.

GitHub pauses scheduled workflows in a repository with no commits for 60 days (it emails first). Glance at the bucket now and then.

## Restoring the database

Never restore over production. Restore into a new place, check it, then decide.

1. Download the backup you want from `lifestory/db/<year>/<month>/` in the bucket.
2. Decrypt it: `age --decrypt --identity lifestory-backup.key --output restore.dump <file>.dump.age`
3. Restore into an empty database: a new Neon branch or project, or a local Postgres 18:
   `pg_restore --exit-on-error --no-owner --no-privileges --dbname "<empty database url>" restore.dump`
4. Compare it with what you expect (row counts, recent records), then point a Preview deployment at it before anything else.

Practise this once a month with a local Postgres; it takes a few minutes.

## Restoring uploaded files

1. Copy the bucket's `lifestory/blobs/` folder to your computer (or just the manifest you want under `manifests/` and the whole `objects/` folder).
2. `scripts/restore-blobs.sh <that folder> lifestory-backup.key <empty folder>` decrypts every file, checks its SHA-256 against the manifest and writes it under its original pathname.
3. Upload them to a **new** Blob store and point a Preview deployment at it before touching Production.
