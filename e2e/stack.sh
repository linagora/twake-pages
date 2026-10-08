#!/usr/bin/env bash
# Starts or stops the stack the suite runs against.
#
#   e2e/stack.sh up
#   e2e/stack.sh down
set -euo pipefail

cd "$(dirname "$0")/.."
compose=(docker compose -p twake-pages-e2e -f docker-compose.yml -f e2e/docker-compose.e2e.yml --profile app)

case "${1:-}" in
  up)
    if ! openssl x509 -checkend 3600 -noout -in e2e/.certs/oidc.crt 2>/dev/null; then
      mkdir -p e2e/.certs
      openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj /CN=oidc \
        -addext 'subjectAltName=DNS:oidc,DNS:localhost' \
        -addext 'basicConstraints=critical,CA:TRUE' \
        -keyout e2e/.certs/oidc.key -out e2e/.certs/oidc.crt 2>/dev/null
      chmod 644 e2e/.certs/oidc.key
    fi
    "${compose[@]}" up -d --build --wait
    ;;
  down)
    "${compose[@]}" down -v
    ;;
  *)
    echo "usage: $0 up|down" >&2
    exit 1
    ;;
esac
