#!/usr/bin/env bash
# Runs the image as in production (uid 101, read-only root filesystem, /tmp as tmpfs, no
# capability) and checks what it serves.
#
#   apps/frontend/docker/smoke-test.sh twake-pages-frontend:dev
set -euo pipefail

IMAGE="${1:?usage: $0 <image>}"
NAME="twake-pages-frontend-smoke-$$"
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT

docker run -d --name "$NAME" \
  --read-only --tmpfs /tmp --user 101 --cap-drop ALL --security-opt no-new-privileges \
  -p 127.0.0.1::8080 \
  -e SSO_BASE_URL='https://sso.example.com/' \
  -e SSO_CLIENT_ID='twakepages' \
  -e POSTHOG_HOST='https://posthog.example.com' \
  -e CSP_FRAME_ANCESTORS='https://workplace.example.com' \
  -e CSP_IMG_SRC='https://avatars.example.com' \
  -e API_UPSTREAM='http://127.0.0.1:9' \
  "$IMAGE" >/dev/null
BASE="http://$(docker port "$NAME" 8080/tcp | head -1)"

failures=0
expect() {
  # shellcheck disable=SC2053 # $3 is a glob pattern
  if [[ "$2" == $3 ]]; then
    echo "ok   $1"
  else
    echo "FAIL $1: got '$2'"
    failures=$((failures + 1))
  fi
}
body() { curl -fsS "$@" 2>&1 || true; }
header() {
  local path=$1 name=$2
  curl -fsS -o /dev/null -D - "$BASE$path" | tr -d '\r' |
    awk -v name="${name,,}" 'tolower($0) ~ "^" name ": " { sub(/^[^:]*: /, ""); print }'
}

for _ in $(seq 1 30); do
  curl -fsS -o /dev/null "$BASE/healthz" 2>/dev/null && break
  sleep 1
done

expect '/healthz answers ok' "$(body "$BASE/healthz")" 'ok'
expect 'nginx runs as uid 101' "$(docker exec "$NAME" stat -c %u /proc/1)" '101'
expect '/ serves index.html' "$(body "$BASE/")" '*<div id="root"*'
expect 'unknown routes fall back to index.html' "$(body "$BASE/wikis/42")" '*<div id="root"*'
expect '/api goes to the backend' "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/wikis")" '502'
expect 'index.html is revalidated' "$(header / Cache-Control)" 'no-cache'
expect '/.env.js comes from the environment' "$(body "$BASE/.env.js")" '*var SSO_CLIENT_ID = "twakepages"*'
expect '/.env.js tells the editor the image hosts' "$(body "$BASE/.env.js")" '*var CSP_IMG_SRC = "https://avatars.example.com"*'
expect '/.env.js is never cached' "$(header /.env.js Cache-Control)" 'no-store'
script="$(body "$BASE/" | grep -o 'src="/static/js/index[^"]*"' | head -1 | cut -d'"' -f2)"
expect 'hashed assets are cached for a year' "$(header "$script" Cache-Control)" '*immutable'
csp="$(header / Content-Security-Policy)"
expect 'CSP sent' "$csp" "default-src 'self'; script-src 'self';*"
expect 'CSP: SSO and PostHog origins in connect-src' "$csp" "*connect-src 'self' https://sso.example.com https://posthog.example.com;*"
expect 'CSP: the SSO may be framed, for the silent sign-in' "$csp" "*frame-src 'self' https://sso.example.com;*"
expect 'CSP: pictures from the hosts in CSP_IMG_SRC' "$csp" "*img-src 'self' data: blob: https://avatars.example.com;*"
expect 'CSP: pages refuse to be framed' "$csp" "*frame-ancestors 'none'"
expect 'CSP: the embedded view may be framed by Pages and the host' \
  "$(header /embed/wikis/w1 Content-Security-Policy)" "*frame-ancestors 'self' https://workplace.example.com"
expect 'CSP: so may the sign-in callback' \
  "$(header /auth/callback Content-Security-Policy)" "*frame-ancestors 'self' https://workplace.example.com"
expect 'the embedded view serves index.html' "$(body "$BASE/embed/wikis/w1")" '*<div id="root"*'
expect 'the overlay of TwakeSpace is a file, not the app' "$(body "$BASE/embed/overlay.html")" '*<body></body>*'
expect 'CSP: the overlay may be framed by the host' \
  "$(header /embed/overlay.html Content-Security-Policy)" "*frame-ancestors 'self' https://workplace.example.com"
expect 'CSP on the SPA fallback too' "$(header /wikis/42 Content-Security-Policy)" "$csp"
expect 'CSP on assets too' "$(header "$script" Content-Security-Policy)" "$csp"
expect 'X-Content-Type-Options' "$(header / X-Content-Type-Options)" 'nosniff'
expect 'Referrer-Policy' "$(header / Referrer-Policy)" 'same-origin'
expect 'no nginx version disclosed' "$(header / Server)" 'nginx'
expect 'callback query string not logged' \
  "$(curl -fsS -o /dev/null "$BASE/callback?code=secret-code" && sleep 0.2 && docker logs "$NAME" 2>&1 | grep -c secret-code || true)" '0'

if ((failures > 0)); then
  echo "$failures check(s) failed; container logs:"
  docker logs "$NAME" 2>&1 | tail -40
  exit 1
fi
echo "all checks passed"
