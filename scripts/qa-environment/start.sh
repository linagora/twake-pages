#!/bin/bash
#
# Starts a long lived Twake Pages stack for manual or agent driven exploratory
# QA: the app, Dex as its SSO, a stand-in Grist and Mailpit. Each start
# recreates it from scratch.
#
#   scripts/qa-environment/build.sh    # once, and whenever the code under test changes
#   scripts/qa-environment/start.sh
#
# Accounts (dex.yaml, password "secret"): alice, bob and charlie @acme.test, of
# the organization acme.test (alice its admin); dave@globex.test, of another
# organization; erin@mail.test, a B2C user. The space "Design Sprint" of
# acme.test has a space wiki: alice its admin, bob an editor, charlie a viewer.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

QA_PROJECT="${QA_PROJECT:-twake-pages-qa}"
CERTS="$SCRIPT_DIR/.certs"

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

  App:      http://localhost:18930/
  SSO:      https://sso:18933  (Dex; alice, bob, charlie @acme.test, dave@globex.test,
            erin@mail.test; password "secret")
  Grist:    http://localhost:18932/<any path>  (stand-in)
  Emails:   http://127.0.0.1:18931  (Mailpit)

From a browser on this host, map sso to 127.0.0.1 and accept its certificate:
  chromium --user-data-dir=\$(mktemp -d) --ignore-certificate-errors \\
    --host-resolver-rules="MAP sso 127.0.0.1" http://localhost:18930/

From a container (e.g. Playwright), join the network '${QA_PROJECT}_default' and use:
  --host-resolver-rules="MAP localhost:18930 frontend:8080,MAP localhost:18932 grist:3504"
  --ignore-certificate-errors
and open Mailpit at http://mailpit:8025.

Stop it with: scripts/qa-environment/stop.sh
INFO
