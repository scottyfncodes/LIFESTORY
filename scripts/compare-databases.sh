#!/usr/bin/env bash
# Compares two databases table by table (row counts and a checksum of every
# row) and prints any difference. Read-only on both sides: it runs each
# query in a read-only transaction. Used to prove a copy is identical before
# switching to it; see docs/neon-separation.md.
#
#   scripts/compare-databases.sh "<source url>" "<copy url>"
#
# Use direct connection strings (host without -pooler). Exit status 0 means
# every table in public matches; 1 means at least one differs.
set -euo pipefail

[[ $# -eq 2 ]] || { echo "usage: $0 <source url> <copy url>" >&2; exit 2; }

# One line per table: name, row count, md5 of all rows in primary-key (or
# whole-row) order. Text form of each row, so it is the same on any server.
fingerprint() {
  psql "$1" -XAtq -v ON_ERROR_STOP=1 <<'SQL'
begin transaction isolation level repeatable read read only;
select format('%s.%s %s %s', n.nspname, c.relname,
              (xpath('/row/n/text()', x))[1], coalesce((xpath('/row/h/text()', x))[1]::text, '-'))
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral query_to_xml(
    format('select count(*) as n, md5(string_agg(t::text, E''\n'' order by t::text)) as h from %I.%I t',
           n.nspname, c.relname), false, true, '') x
 where c.relkind in ('r', 'p')
   and n.nspname not in ('pg_catalog', 'information_schema', 'neon_auth')
   and left(n.nspname, 3) <> 'pg_'
 order by 1;
commit;
SQL
}

a=$(fingerprint "$1")
b=$(fingerprint "$2")
if [[ "$a" == "$b" ]]; then
  echo "Identical: $(wc -l <<<"$a") tables, $(awk '{ s += $2 } END { print s }' <<<"$a") rows"
  exit 0
fi
echo "The databases differ (table rows md5; < source, > copy):"
diff <(echo "$a") <(echo "$b") || true
exit 1
