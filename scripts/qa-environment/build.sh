#!/bin/bash
#
# Builds the backend and frontend images start.sh runs, from the working tree,
# and pulls the others. Node is not needed on the host.
#
#   scripts/qa-environment/build.sh    # once, and whenever the code under test changes
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

QA_PROJECT="${QA_PROJECT:-twake-pages-qa}"

compose() {
  docker compose -p "$QA_PROJECT" -f "$REPO_DIR/docker-compose.yml" \
    -f "$SCRIPT_DIR/docker-compose.qa.yaml" --profile app "$@"
}

compose build backend frontend
compose pull --ignore-buildable --quiet
