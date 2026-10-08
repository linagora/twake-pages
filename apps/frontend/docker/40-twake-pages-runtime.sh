#!/bin/sh
# Writes /.env.js and the security headers from the environment. The root filesystem
# is read-only: everything goes under /tmp/nginx.
set -eu

ME=$(basename "$0")
OUT=/tmp/nginx
RUNTIME_KEYS="SSO_BASE_URL SSO_CLIENT_ID SSO_SCOPE SSO_REDIRECT_URI SSO_POST_LOGOUT_REDIRECT POSTHOG_KEY POSTHOG_HOST TWAKE_SPACE_ORIGIN"

fail() {
  echo "$ME: error: $*" >&2
  exit 1
}

one_line() {
  case "$2" in
    *"
"*) fail "$1 must hold on one line" ;;
  esac
}

# A CSP source list ends up between double quotes in nginx and must not add directives.
check_sources() {
  one_line "$1" "$2"
  case "$2" in
    *[\"\\\$\;,]*) fail "$1 must not contain double quotes, backslashes, dollar signs, semicolons nor commas" ;;
  esac
}

origin() {
  printf '%s' "$1" | sed -E 's#^(https?://[^/?#]+).*$#\1#'
}

mkdir -p "$OUT"

: >"$OUT/env.js"
for key in $RUNTIME_KEYS; do
  value=$(printenv "$key" || true)
  [ -n "$value" ] || continue
  one_line "$key" "$value"
  escaped=$(printf '%s' "$value" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')
  printf 'var %s = "%s"\n' "$key" "$escaped" >>"$OUT/env.js"
done

connect_src="'self'"
for url in "${SSO_BASE_URL:-}" "${POSTHOG_HOST:-}"; do
  [ -n "$url" ] && connect_src="$connect_src $(origin "$url")"
done
[ -n "${CSP_CONNECT_SRC:-}" ] && connect_src="$connect_src $CSP_CONNECT_SRC"
# The embedded view signs in silently in a hidden frame on the SSO, which comes
# back to the sign-in callback inside that frame.
frame_src="'self'"
[ -n "${SSO_BASE_URL:-}" ] && frame_src="$frame_src $(origin "$SSO_BASE_URL")"
[ -n "${CSP_FRAME_SRC:-}" ] && frame_src="$frame_src $CSP_FRAME_SRC"
frame_ancestors="'self'${CSP_FRAME_ANCESTORS:+ $CSP_FRAME_ANCESTORS}"
# People's pictures come from Twake Workplace, on its own hosts.
img_src="'self' data: blob:${CSP_IMG_SRC:+ $CSP_IMG_SRC}"
permissions_policy=${PERMISSIONS_POLICY:-"accelerometer=(), geolocation=(), gyroscope=(), magnetometer=(), payment=(), usb=()"}
check_sources CSP_CONNECT_SRC "$connect_src"
check_sources CSP_FRAME_SRC "$frame_src"
check_sources CSP_FRAME_ANCESTORS "$frame_ancestors"
check_sources CSP_IMG_SRC "$img_src"
one_line PERMISSIONS_POLICY "$permissions_policy"
case "$permissions_policy" in
  *[\"\\\$\;]*) fail "PERMISSIONS_POLICY must not contain double quotes, backslashes, dollar signs nor semicolons" ;;
esac

# style-src 'unsafe-inline': MUI (emotion) injects its styles at runtime.
csp="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'"
csp="$csp; img-src $img_src; font-src 'self' data:"
csp="$csp; connect-src $connect_src; frame-src $frame_src"
csp="$csp; object-src 'none'; base-uri 'self'; form-action 'self'"

# Only the embedded view, and the sign-in callback it comes back to, may be
# framed by the hosts in CSP_FRAME_ANCESTORS.
headers() {
  cat <<EOF
add_header Content-Security-Policy "$csp; frame-ancestors $1" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "same-origin" always;
add_header Permissions-Policy "$permissions_policy" always;
EOF
}
headers "'none'" >"$OUT/security-headers.conf"
headers "$frame_ancestors" >"$OUT/embed-headers.conf"

# Without an upstream, /api answers 404 rather than the SPA fallback. The upstream is a
# variable so nginx resolves it per request: the backend may start after the frontend.
# nginx ignores the search domains of resolv.conf: in Kubernetes, give the service's full name.
api_upstream=${API_UPSTREAM:-}
if [ -z "$api_upstream" ]; then
  echo 'location /api/ { return 404; }' >"$OUT/api.conf"
else
  case "$api_upstream" in
    http://* | https://*) ;;
    *) fail "API_UPSTREAM must start with http:// or https://" ;;
  esac
  check_sources API_UPSTREAM "$api_upstream"
  case "$api_upstream" in
    *[[:space:]]* | *"'"* | *"{"* | *"}"*) fail "API_UPSTREAM must be a bare origin" ;;
  esac
  [ "${api_upstream%/}" = "$(origin "$api_upstream")" ] || fail "API_UPSTREAM must be a bare origin"
  resolver=$(awk '$1 == "nameserver" { print $2; exit }' /etc/resolv.conf)
  case "$resolver" in *:*) resolver="[$resolver]" ;; esac
  cat >"$OUT/api.conf" <<EOF
location /api/ {
    resolver ${resolver:-127.0.0.11} valid=30s;
    set \$api_upstream "$(origin "$api_upstream")";
    proxy_pass \$api_upstream;
    proxy_ssl_server_name on;
    proxy_set_header Host \$proxy_host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
}
EOF
fi
