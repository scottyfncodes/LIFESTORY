#!/usr/bin/env bash
# The nightly backup of uploaded files: every file in the Production Vercel
# Blob store, encrypted, copied to the same locked bucket as the database
# backups. See docs/backups.md.
#
#   BACKUP_PREFIX            the app's name; folder names in the bucket
#   BLOB_READ_WRITE_TOKEN    the Production Blob store's token
#   BLOB_ACCESS              optional, "private" (default) or "public"
#   BACKUP_AGE_RECIPIENT     the age public key (age1...) files are encrypted to
#   BACKUP_S3_BUCKET         bucket name; it must have Object Lock on
#   BACKUP_S3_ENDPOINT       S3-compatible endpoint (Backblaze B2), or empty for AWS S3
#   AWS_ACCESS_KEY_ID        a key that can add files but not delete them
#   AWS_SECRET_ACCESS_KEY
#   AWS_DEFAULT_REGION       the bucket's region
#   BACKUP_MIN_RETENTION_DAYS optional, default 30; it cannot be set lower
#   BACKUP_SEEN_FILE         optional; a file kept between runs (the workflow
#                            caches it) listing "<sha256> <yyyy-mm-dd>" for
#                            files already uploaded, so unchanged files are not
#                            uploaded every night. Losing it only costs time.
#   BACKUP_REUPLOAD_DAYS     optional, default 90: a file is uploaded again once
#                            its last upload is this old, so the bucket's
#                            lifecycle rule (one year) never removes a file a
#                            recent manifest still needs
#
# Each file is stored once under its SHA-256 (blobs/objects/<sha256>.age);
# each run also uploads an encrypted manifest naming every pathname and the
# SHA-256 it held (blobs/manifests/...). Restore with scripts/restore-blobs.sh.
set -euo pipefail

fail() {
  echo "::error::$*" >&2
  exit 1
}

for name in BACKUP_PREFIX BLOB_READ_WRITE_TOKEN BACKUP_AGE_RECIPIENT BACKUP_S3_BUCKET AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_DEFAULT_REGION; do
  [[ -n "${!name:-}" ]] || fail "$name is not set"
done
[[ "$BACKUP_PREFIX" =~ ^[a-z0-9][a-z0-9-]*$ ]] || fail "BACKUP_PREFIX must be lowercase letters, digits and dashes"
[[ "$BACKUP_AGE_RECIPIENT" == age1* ]] ||
  fail "BACKUP_AGE_RECIPIENT must be an age public key (age1...), never the private key"
reupload_days="${BACKUP_REUPLOAD_DAYS:-90}"
[[ "$reupload_days" =~ ^[0-9]+$ ]] && (( reupload_days >= 1 && reupload_days <= 180 )) ||
  fail "BACKUP_REUPLOAD_DAYS must be between 1 and 180"

endpoint=()
if [[ -n "${BACKUP_S3_ENDPOINT:-}" ]]; then
  endpoint=(--endpoint-url "$BACKUP_S3_ENDPOINT")
  export AWS_REQUEST_CHECKSUM_CALCULATION=when_required
  export AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
fi

# The same lock check as scripts/backup-db.sh: the bucket must refuse deletes
# for at least 30 days in COMPLIANCE mode, or nothing is uploaded.
min_days="${BACKUP_MIN_RETENTION_DAYS:-30}"
[[ "$min_days" =~ ^[0-9]+$ ]] && (( min_days >= 30 )) ||
  fail "BACKUP_MIN_RETENTION_DAYS cannot be below 30"
lock=$(aws s3api get-object-lock-configuration --bucket "$BACKUP_S3_BUCKET" "${endpoint[@]}" --output json) ||
  fail "Could not read the bucket's Object Lock settings (is Object Lock on, and may this key read them?)"
mode=$(jq -r '.ObjectLockConfiguration.Rule.DefaultRetention.Mode // empty' <<<"$lock")
days=$(jq -r '.ObjectLockConfiguration.Rule.DefaultRetention | (.Days // 0) + (.Years // 0) * 365' <<<"$lock")
[[ "$(jq -r '.ObjectLockConfiguration.ObjectLockEnabled // empty' <<<"$lock")" == Enabled ]] ||
  fail "Object Lock is not enabled on the bucket"
[[ "$mode" == COMPLIANCE ]] || fail "The bucket's default retention is '${mode:-none}', not COMPLIANCE"
(( days >= min_days )) || fail "The bucket keeps backups locked for $days days; it must be at least $min_days"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
stamp=$(date -u +%Y-%m-%dT%H%M%SZ)
today=$(date -u +%Y-%m-%d)
cutoff=$(date -u -d "$reupload_days days ago" +%Y-%m-%d)

# Read the whole store first; any file that cannot be read in full stops the run.
exporter=${BACKUP_BLOB_EXPORTER:-"node $(dirname "$0")/blob-export.mjs"}
$exporter "$work/export" || fail "Could not read the Blob store; nothing was uploaded"
manifest="$work/export/manifest.json"
count=$(jq -r '.count' "$manifest")
[[ "$count" =~ ^[0-9]+$ ]] || fail "The export wrote no usable manifest"
# Every file the manifest names must be here, with the hash it claims.
while read -r sha; do
  [[ -f "$work/export/objects/$sha" ]] || fail "The export is missing the file for $sha"
  [[ "$(sha256sum "$work/export/objects/$sha" | cut -d' ' -f1)" == "$sha" ]] ||
    fail "A downloaded file does not match its hash ($sha)"
done < <(jq -r '.blobs[].sha256' "$manifest" | sort -u)

age-keygen -o "$work/run.key" 2>/dev/null
run_recipient=$(age-keygen -y "$work/run.key")
seal() { # seal <plain file> <encrypted file>: encrypt, then prove it decrypts back
  age --recipient "$BACKUP_AGE_RECIPIENT" --recipient "$run_recipient" --output "$2" "$1"
  cmp -s <(age --decrypt --identity "$work/run.key" "$2") "$1" ||
    fail "An encrypted file does not decrypt to the original; refusing to upload it"
}

seen="${BACKUP_SEEN_FILE:-$work/seen}"
touch "$seen"
uploaded=0
skipped=0
while read -r sha; do
  last=$(awk -v s="$sha" '$1 == s { print $2 }' "$seen" | sort | tail -1)
  if [[ -n "$last" && ! "$last" < "$cutoff" ]]; then
    skipped=$((skipped + 1))
    continue
  fi
  seal "$work/export/objects/$sha" "$work/obj.age"
  aws s3 cp "$work/obj.age" "s3://$BACKUP_S3_BUCKET/$BACKUP_PREFIX/blobs/objects/$sha.age" "${endpoint[@]}" --only-show-errors
  echo "$sha $today" >>"$seen"
  uploaded=$((uploaded + 1))
done < <(jq -r '.blobs[].sha256' "$manifest" | sort -u)

# The manifest goes last: one that names a file never uploaded cannot exist.
seal "$manifest" "$work/manifest.json.age"
key="$BACKUP_PREFIX/blobs/manifests/$(date -u +%Y/%m)/$BACKUP_PREFIX-$stamp-${GITHUB_RUN_ID:-local}.json.age"
aws s3 cp "$work/manifest.json.age" "s3://$BACKUP_S3_BUCKET/$key" "${endpoint[@]}" --only-show-errors
rm -f "$work/run.key"

# Keep the seen list to files the store still holds, newest date per file.
sort -k1,1 -k2,2r "$seen" | awk '!done[$1]++' >"$work/seen.new"
jq -r '.blobs[].sha256' "$manifest" | sort -u >"$work/current"
awk 'NR == FNR { keep[$1] = 1; next } keep[$1]' "$work/current" "$work/seen.new" >"$seen"

echo "Backed up $count files ($(jq -r '.bytes' "$manifest") bytes): $uploaded uploaded, $skipped already in the bucket; manifest $key"
