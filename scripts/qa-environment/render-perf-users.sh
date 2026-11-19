#!/bin/bash
#
# Renders the configuration of the QA environment with N more accounts:
#   scripts/qa-environment/render-perf-users.sh N OUTPUT_DIR
# writes OUTPUT_DIR/dex.yaml (dex.yaml and N more static passwords) and
# OUTPUT_DIR/people.json (sso/people.json and the organization of each).
# start.sh runs it for QA_PERF_USERS=N; see there for the accounts.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COUNT="$1"
OUT="$2"
PASSWORD="perf-secret"

mkdir -p "$OUT"

# One bcrypt hash for every account, from the only tool docker brings
HASH="$(docker run --rm httpd:2.4-alpine htpasswd -nbBC 10 perf "$PASSWORD" | cut -d: -f2 | tr -d '\r\n' | sed 's/^\$2y\$/$2a$/')"
case "$HASH" in
  '$2a$10$'*) ;;
  *)
    echo "Could not hash the perf password: '$HASH'" >&2
    exit 1
    ;;
esac

# dex.yaml, with the accounts at the end of its staticPasswords (the first
# top level key after it, or the end of the file)
awk -v count="$COUNT" -v hash="$HASH" '
  function perf(   i) {
    for (i = 1; i <= count; i++)
      printf "  - email: perf%04d@acme.test\n    username: Perf %04d\n    userID: 9e4f0000-0000-4000-8000-%012d\n    hash: \047%s\047\n", i, i, i, hash
  }
  /^staticPasswords:/ { inside = 1 }
  inside && /^[A-Za-z]/ && !/^staticPasswords:/ { perf(); inside = 0 }
  { print }
  END { if (inside) perf() }
' "$SCRIPT_DIR/dex.yaml" >"$OUT/dex.yaml"
grep -q 'perf0001@acme.test' "$OUT/dex.yaml"

# The claims of the shim: members of acme.test, as bob
awk -v count="$COUNT" '
  { lines[NR] = $0 }
  END {
    last = NR
    while (last > 0 && lines[last] !~ /^}/) last--
    for (i = 1; i < last - 1; i++) print lines[i]
    print lines[last - 1] ","
    for (i = 1; i <= count; i++)
      printf "  \"perf%04d@acme.test\": { \"org_id\": \"acme.test\", \"org_role\": \"member\" }%s\n", i, (i < count ? "," : "")
    print "}"
  }
' "$SCRIPT_DIR/sso/people.json" >"$OUT/people.json"
