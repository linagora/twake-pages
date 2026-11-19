#!/bin/bash
#
# Starts a long lived Twake Pages stack for manual or agent driven exploratory
# QA: the app, Dex as its SSO, a stand-in Grist and Mailpit. Each start
# recreates it from scratch.
#
#   scripts/qa-environment/build.sh    # once, and whenever the code under test changes
#   scripts/qa-environment/start.sh
#   QA_PERF_USERS=300 scripts/qa-environment/start.sh   # and 300 more accounts, for load tests
#
# Accounts (dex.yaml, password "secret"): alice, bob and charlie @acme.test, of
# the organization acme.test (alice its admin); dave@globex.test, of another
# organization; erin@mail.test, a B2C user. The space "Design Sprint" of
# acme.test has a space wiki: alice its admin, bob an editor, charlie a viewer.
#
# QA_PERF_USERS=N (default 0: none) adds N accounts perf0001@acme.test ..
# perfNNNN@acme.test (zero padded to 4 digits at least), password "perf-secret",
# members of acme.test like bob. They are not in dex.yaml, which stays as it is:
# start.sh renders a copy of it and of sso/people.json, extended with them, into
# the git-ignored .generated/ (removed by stop.sh), and the compose mounts those.
# The password is hashed once, in a throw-away httpd:2.4-alpine container (docker
# is the only tool needed). A person's uuid is 9e4f0000-0000-4000-8000-<number>.
# The backend keeps no user table: a first sign-in of a perf account creates
# nothing at once; the person is their claims, and their first list of wikis
# makes their personal wiki.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

QA_PROJECT="${QA_PROJECT:-twake-pages-qa}"
QA_PERF_USERS="${QA_PERF_USERS:-0}"
CERTS="$SCRIPT_DIR/.certs"
GENERATED="$SCRIPT_DIR/.generated"

compose() {
  docker compose -p "$QA_PROJECT" -f "$REPO_DIR/docker-compose.yml" \
    -f "$SCRIPT_DIR/docker-compose.qa.yaml" --profile app "$@"
}

if ! openssl x509 -checkend 86400 -noout -in "$CERTS/sso.crt" 2>/dev/null; then
  echo "==> Making the certificate of the SSO"
  mkdir -p "$CERTS"
  openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj /CN=sso \
    -addext 'subjectAltName=DNS:sso,DNS:localhost' \
    -addext 'basicConstraints=critical,CA:TRUE' \
    -keyout "$CERTS/sso.key" -out "$CERTS/sso.crt" 2>/dev/null
  chmod 644 "$CERTS/sso.key"
fi

case "$QA_PERF_USERS" in
  '' | *[!0-9]*)
    echo "QA_PERF_USERS must be a whole number, not '$QA_PERF_USERS'" >&2
    exit 1
    ;;
esac
rm -rf "$GENERATED"
if [ "$((10#$QA_PERF_USERS))" -gt 0 ]; then
  echo "==> Rendering Dex and the claims of the SSO with $((10#$QA_PERF_USERS)) perf accounts"
  "$SCRIPT_DIR/render-perf-users.sh" "$((10#$QA_PERF_USERS))" "$GENERATED"
  export QA_DEX_CONFIG="$GENERATED/dex.yaml" QA_PEOPLE="$GENERATED/people.json"
fi

echo "==> Starting the stack as compose project '$QA_PROJECT'"
# New containers and anonymous volumes: an empty database, a Dex with no session
compose up -d --force-recreate --renew-anon-volumes --wait --wait-timeout 300

# Published the way ldap-rest does, on its space exchange, as the e2e suite does
publish='
const { RabbitMQClient } = await import("@linagora/rabbitmq-client")
const [exchange, routingKey, messageId, body] = process.argv.slice(1)
const client = new RabbitMQClient({ url: process.env.RABBITMQ_URL })
await client.init()
await client.publish(exchange, routingKey, JSON.parse(body), { messageId })
await client.close()
'
echo "==> Creating the space Design Sprint"
compose exec -T backend node --input-type=module -e "$publish" \
  space twake.space.created "$(cat /proc/sys/kernel/random/uuid)" "{
    \"organizationId\": \"acme.test\",
    \"id\": \"5ace0000-0000-4000-8000-000000000001\",
    \"name\": \"Design Sprint\",
    \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
    \"members\": [
      {\"uuid\": \"0a11ce00-0000-4000-8000-000000000001\", \"email\": \"alice@acme.test\", \"role\": \"admin\"},
      {\"uuid\": \"0b0b0000-0000-4000-8000-000000000002\", \"email\": \"bob@acme.test\", \"role\": \"editor\"},
      {\"uuid\": \"0c0c0000-0000-4000-8000-000000000003\", \"email\": \"charlie@acme.test\", \"role\": \"viewer\"}
    ]
  }" >/dev/null

cat <<INFO

==> The QA environment is up

  App:      http://localhost:${QA_APP_PORT:-18940}/
  SSO:      https://sso:18943  (Dex; alice, bob, charlie @acme.test, dave@globex.test,
            erin@mail.test; password "secret")
  Grist:    http://localhost:${QA_GRIST_PORT:-18942}/<any path>  (stand-in)
  Emails:   http://127.0.0.1:${QA_MAILPIT_PORT:-18941}  (Mailpit)

From a browser on this host, map sso to 127.0.0.1 and accept its certificate:
  chromium --user-data-dir=\$(mktemp -d) --ignore-certificate-errors \\
    --host-resolver-rules="MAP sso 127.0.0.1" http://localhost:18940/

From a container (e.g. Playwright), join the network '${QA_PROJECT}_default' and use:
  --host-resolver-rules="MAP localhost:18940 frontend:8080,MAP localhost:18942 grist:3504"
  --ignore-certificate-errors
and open Mailpit at http://mailpit:8025.

Stop it with: scripts/qa-environment/stop.sh
INFO
if [ "$((10#$QA_PERF_USERS))" -gt 0 ]; then
  printf '\nPerf accounts: perf0001@acme.test .. perf%04d@acme.test, members of acme.test, password "perf-secret"\n' "$((10#$QA_PERF_USERS))"
fi
