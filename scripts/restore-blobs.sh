#!/usr/bin/env bash
# Rebuilds the uploaded files from a Blob backup, on your own computer.
# See "Restoring uploaded files" in docs/backups.md.
#
#   scripts/restore-blobs.sh <backup folder> <age private key file> <output folder>
#
# <backup folder> is a copy of the bucket's <prefix>/blobs/ folder: the
# manifest you want under manifests/ (the newest one, unless you are going
# back to an earlier night) and the objects/ it names. The script uses the
# newest manifest it finds, decrypts each file, checks its SHA-256 against the
# manifest, and writes it to <output folder>/<pathname>. It never talks to
# Vercel; uploading the files to a new store is a separate, deliberate step.
set -euo pipefail

fail() {
  echo "error: $*" >&2
  exit 1
}

[[ $# -eq 3 ]] || fail "usage: $0 <backup folder> <age private key file> <output folder>"
src=$1
identity=$2
out=$3
[[ -d "$src/objects" ]] || fail "$src/objects not found"
[[ -f "$identity" ]] || fail "$identity not found"
mkdir -p "$out"
[[ -z "$(ls -A "$out")" ]] || fail "$out must be empty"

manifest_age=$(find "$src/manifests" -name '*.json.age' | sort | tail -1)
[[ -n "$manifest_age" ]] || fail "no manifest under $src/manifests"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
age --decrypt --identity "$identity" --output "$work/manifest.json" "$manifest_age" ||
  fail "could not decrypt $manifest_age with this key"
echo "Using $(basename "$manifest_age"): $(jq -r '.count' "$work/manifest.json") files"

restored=0
while IFS=$'\t' read -r sha pathname; do
  [[ "$pathname" != /* && "$pathname" != *..* ]] || fail "refusing an unsafe pathname: $pathname"
  obj="$src/objects/$sha.age"
  [[ -f "$obj" ]] || fail "missing $obj (needed for $pathname)"
  mkdir -p "$out/$(dirname "$pathname")"
  age --decrypt --identity "$identity" --output "$out/$pathname" "$obj"
  [[ "$(sha256sum "$out/$pathname" | cut -d' ' -f1)" == "$sha" ]] ||
    fail "$pathname does not match the hash in the manifest"
  restored=$((restored + 1))
done < <(jq -r '.blobs[] | [.sha256, .pathname] | @tsv' "$work/manifest.json")

cp "$work/manifest.json" "$out/.manifest.json"
echo "Restored $restored files to $out, each checked against its SHA-256 (manifest saved as $out/.manifest.json)"
