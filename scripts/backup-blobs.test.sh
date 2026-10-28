#!/usr/bin/env bash
# Tests for scripts/backup-blobs.sh and scripts/restore-blobs.sh, with the
# Blob store faked (scripts/blob-export.mjs runs for real against it) and the
# upload stubbed into a folder. Each case says what must happen and checks it.
#
#   npm run test:backup-blobs
#
# Needs node, age, jq and sha256sum. Touches nothing outside a temp folder.
set -uo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
bucket="$work/bucket"
stubs="$work/bin"
store="$work/store"
mkdir -p "$bucket" "$stubs" "$store/photos/2026"

# ------------------------------------------------------------ the store
printf 'first photo' >"$store/photos/2026/a.jpg"
printf 'second photo, a little longer' >"$store/photos/2026/b.jpg"
cp "$store/photos/2026/a.jpg" "$store/photos/copy-of-a.jpg" # same bytes, second pathname
head -c 300000 /dev/urandom >"$store/recording.m4a"          # big enough to stream in chunks

# A fake @vercel/blob: list pages two at a time; get streams the file.
# FAKE_SHORT drops the last byte of one file; FAKE_MISSING makes one unreadable.
cat >"$stubs/fake-export.mjs" <<'EOF'
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { exportBlobs } from 'BLOB_EXPORT';
const store = process.env.FAKE_STORE;
const walk = (d) => readdirSync(d).flatMap((n) => statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]);
const files = walk(store).sort().map((f) => ({ pathname: relative(store, f), size: statSync(f).size, uploadedAt: new Date('2026-10-01'), etag: 'e' }));
const client = {
  async list({ cursor }) {
    const start = Number(cursor ?? 0);
    const blobs = files.slice(start, start + 2);
    const more = start + 2 < files.length;
    return { blobs, hasMore: more, cursor: more ? String(start + 2) : undefined };
  },
  async get(pathname, { access }) {
    if (access !== 'private') throw new Error('expected private access');
    if (process.env.FAKE_MISSING && pathname.endsWith('b.jpg')) return null;
    let bytes = readFileSync(join(store, pathname));
    if (process.env.FAKE_SHORT && pathname.endsWith('a.jpg')) bytes = bytes.subarray(0, bytes.length - 1);
    const chunks = [];
    for (let i = 0; i < bytes.length; i += 65536) chunks.push(bytes.subarray(i, i + 65536));
    return { statusCode: 200, stream: new ReadableStream({ start(c) { chunks.forEach((x) => c.enqueue(x)); c.close(); } }), blob: { contentType: 'application/octet-stream' } };
  },
};
try {
  await exportBlobs(client, process.argv[2]);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
EOF
sed -i "s#'BLOB_EXPORT'#'$root/scripts/blob-export.mjs'#" "$stubs/fake-export.mjs"

cat >"$stubs/aws" <<EOF
#!/usr/bin/env bash
if [[ "\$1" == s3api ]]; then
  [[ -n "\${LOCK_JSON:-}" ]] || { echo "ObjectLockConfigurationNotFoundError" >&2; exit 254; }
  echo "\$LOCK_JSON"; exit 0
fi
[[ -n "\${AWS_FAIL_UPLOAD:-}" ]] && { echo "upload failed" >&2; exit 1; }
dest="\${4#s3://test/}"; mkdir -p "$bucket/\$(dirname "\$dest")"; cp "\$3" "$bucket/\$dest"
EOF
chmod +x "$stubs/aws"

age-keygen -o "$work/key.txt" 2>"$work/pub.txt"
PUB=$(grep -o 'age1[a-z0-9]*' "$work/pub.txt")
lock() { echo "{\"ObjectLockConfiguration\":{\"ObjectLockEnabled\":\"Enabled\"$1}}"; }
LOCK30=$(lock ',"Rule":{"DefaultRetention":{"Mode":"COMPLIANCE","Days":30}}')
SEEN="$work/seen.txt"

passed=0
failed=0
pass() { passed=$((passed + 1)); echo "ok   - $1"; }
flunk() { failed=$((failed + 1)); echo "FAIL - $1"; }
objects() { find "$bucket" -path '*/objects/*.age' | wc -l; }
manifests() { find "$bucket" -path '*/manifests/*.age' | wc -l; }

run() {
  env PATH="$stubs:$PATH" BACKUP_PREFIX=testapp BLOB_READ_WRITE_TOKEN=vercel_blob_rw_SECRET \
    BACKUP_AGE_RECIPIENT="$PUB" BACKUP_S3_BUCKET=test BACKUP_S3_ENDPOINT=https://s3.example.com \
    AWS_ACCESS_KEY_ID=x AWS_SECRET_ACCESS_KEY=aws-SECRET-key AWS_DEFAULT_REGION=r \
    GITHUB_RUN_ID=$RANDOM$RANDOM LOCK_JSON="$LOCK30" BACKUP_SEEN_FILE="$SEEN" \
    BACKUP_BLOB_EXPORTER="node $stubs/fake-export.mjs" FAKE_STORE="$store" \
    "$@" "$root/scripts/backup-blobs.sh" 2>&1
}

# expect ok|fail "what" "text the output must contain (fail only)" [VAR=value...]
expect() {
  local want=$1 what=$2 needle=$3 out code m0 m1
  shift 3
  m0=$(manifests)
  out=$(run "$@")
  code=$?
  m1=$(manifests)
  if [[ "$out" == *SECRET* ]]; then flunk "$what (a token or key appeared in the output)"; sed 's/^/       /' <<<"$out"; return; fi
  if [[ $want == ok ]] && (( code == 0 && m1 == m0 + 1 )); then pass "$what"; LAST_OUT=$out; return; fi
  if [[ $want == fail ]] && (( code != 0 && m1 == m0 )) && [[ "$out" == *"$needle"* ]]; then pass "$what"; return; fi
  flunk "$what (exit $code, manifests $m0 -> $m1)"
  sed 's/^/       /' <<<"$out"
}

echo "# backups that must succeed"
expect ok "first run uploads every distinct file and a manifest" ""
(( $(objects) == 3 )) && pass "4 pathnames, 3 distinct files: 3 objects stored" || flunk "expected 3 objects, found $(objects)"
if grep -rqa 'first photo' "$bucket"; then flunk "an uploaded file contains plaintext"; else pass "uploaded files are unreadable without the key"; fi
expect ok "second run with nothing new" ""
[[ "$LAST_OUT" == *"0 uploaded, 3 already in the bucket"* ]] && pass "unchanged files are not uploaded again" || flunk "unchanged files were uploaded again: $LAST_OUT"
printf 'a new photo' >"$store/photos/2026/c.jpg"
expect ok "a new file" ""
[[ "$LAST_OUT" == *"1 uploaded, 3 already"* ]] && pass "only the new file is uploaded" || flunk "new file run: $LAST_OUT"
sed -i 's/ [0-9-]*$/ 2020-01-01/' "$SEEN"
expect ok "files last uploaded long ago" ""
[[ "$LAST_OUT" == *"4 uploaded, 0 already"* ]] && pass "files older than BACKUP_REUPLOAD_DAYS are uploaded again" || flunk "re-upload run: $LAST_OUT"
rm -f "$SEEN"
expect ok "the seen list was lost" ""
[[ "$LAST_OUT" == *"4 uploaded"* ]] && pass "a lost seen list only means uploading again" || flunk "lost seen list: $LAST_OUT"

echo "# restore"
restored="$work/restored"
if out=$("$root/scripts/restore-blobs.sh" "$bucket/testapp/blobs" "$work/key.txt" "$restored" 2>&1) &&
   diff -r --exclude=.manifest.json "$store" "$restored" >/dev/null; then
  pass "restore rebuilds every pathname byte for byte"
else
  flunk "restore did not rebuild the store"; sed 's/^/       /' <<<"$out"
fi
age-keygen -o "$work/other.key" 2>/dev/null
if "$root/scripts/restore-blobs.sh" "$bucket/testapp/blobs" "$work/other.key" "$work/r2" >/dev/null 2>&1; then
  flunk "restore worked with the wrong key"
else
  pass "restore needs the offline key"
fi
cp -r "$bucket/testapp/blobs" "$work/tampered"
victim=$(find "$work/tampered/objects" -name '*.age' | head -1)
age -r "$PUB" -o "$victim" <(printf 'not the original')
if out=$("$root/scripts/restore-blobs.sh" "$work/tampered" "$work/key.txt" "$work/r3" 2>&1); then
  flunk "restore accepted a swapped file"
else
  [[ "$out" == *"does not match the hash"* ]] && pass "restore refuses a file that does not match its hash" || flunk "swapped file: $out"
fi

echo "# a copy that is not complete"
expect fail "a file arrives short" "should be"  FAKE_SHORT=1
expect fail "a file cannot be read" "Could not read" FAKE_MISSING=1
expect fail "the upload fails" "upload failed" AWS_FAIL_UPLOAD=1 BACKUP_SEEN_FILE="$work/empty-seen"

echo "# a bucket that does not lock backups"
expect fail "no Object Lock" "Object Lock" LOCK_JSON=
expect fail "GOVERNANCE mode" "not COMPLIANCE" LOCK_JSON="$(lock ',"Rule":{"DefaultRetention":{"Mode":"GOVERNANCE","Days":30}}')"
expect fail "a 7-day lock" "at least 30" LOCK_JSON="$(lock ',"Rule":{"DefaultRetention":{"Mode":"COMPLIANCE","Days":7}}')"

echo "# settings that must be refused"
expect fail "no token" "BLOB_READ_WRITE_TOKEN is not set" BLOB_READ_WRITE_TOKEN=
expect fail "the private key in place of the public one" "never the private key" BACKUP_AGE_RECIPIENT=AGE-SECRET-KEY-1ABC
expect fail "a prefix with a slash" "BACKUP_PREFIX" BACKUP_PREFIX=a/b

echo
echo "$passed passed, $failed failed"
(( failed == 0 ))
