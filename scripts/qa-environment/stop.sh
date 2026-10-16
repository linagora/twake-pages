#!/bin/bash
#
# Stops the QA environment started by start.sh and drops its data.
#
#   scripts/qa-environment/stop.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

QA_PROJECT="${QA_PROJECT:-twake-pages-qa}"

docker compose -p "$QA_PROJECT" -f "$REPO_DIR/docker-compose.yml" \
  -f "$SCRIPT_DIR/docker-compose.qa.yaml" --profile app \
  down --volumes --remove-orphans
echo "==> QA environment '$QA_PROJECT' stopped"
