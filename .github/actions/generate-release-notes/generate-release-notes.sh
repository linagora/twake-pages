#!/usr/bin/env bash
# Release notes for one app: commits reachable from the tag but from no other stable
# tag of the same app, limited to the app's paths. Excluding every stable tag, not
# just the nearest ancestor, keeps a rebased maintenance branch from re-listing
# shipped commits. rc tags are not stable, so a final lists everything since the last final.
#
# usage: generate-release-notes.sh <tag> <tag-prefix> <app-dir> <workflow-prefix> <output-file>

set -euo pipefail

TAG=$1
PREFIX=$2
PROJECT=$3
WORKFLOW_PREFIX=$4
OUT=$5

if ! git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null; then
  echo "error: tag ${TAG} not found" >&2
  exit 1
fi

if [ -n "${GITHUB_SERVER_URL:-}" ] && [ -n "${GITHUB_REPOSITORY:-}" ]; then
  REPO_URL="${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}"
else
  REPO_URL=$(git remote get-url origin \
    | sed -E 's#^git@([^:]+):#https://\1/#; s#\.git$##')
fi

# PREFIX is a fixed literal from the workflow (e.g. "frontend-v"), never user
# input, so it goes into the regex as-is.
STABLE_RE="^${PREFIX}[0-9]+\.[0-9]+\.[0-9]+\$"
mapfile -t STABLE_TAGS < <(git tag -l "${PREFIX}*" \
  | grep -E "$STABLE_RE" | grep -vx "$TAG" || true)

# Baseline for the compare link: the most recently created stable tag
# reachable from the tagged commit's parent. A first release has none.
BASELINE=$(git tag -l "${PREFIX}*" --merged "${TAG}^" --sort=-creatordate 2>/dev/null \
  | grep -E "$STABLE_RE" | grep -vx "$TAG" | head -1 || true)

# Commits in this release that no stable release of this project shipped
# before, scoped the same way as the project's CI triggers. Version-bump
# commits are release machinery, not changes worth listing.
NOT_ARGS=("${STABLE_TAGS[@]/#/^}")
SUBJECTS=$(git log --no-merges --format='%s' "$TAG" "${NOT_ARGS[@]}" \
    -- "${PROJECT}" ".github/workflows/${WORKFLOW_PREFIX}-*.yml" \
  | grep -Ev '^chore(\([^)]*\))?: bump version' || true)

section() {
  local title=$1 pattern=$2 invert=${3:-}
  local lines
  if [ -z "$invert" ]; then
    lines=$(printf '%s\n' "$SUBJECTS" | grep -E "$pattern" || true)
  else
    lines=$(printf '%s\n' "$SUBJECTS" | grep -Ev "$pattern" || true)
  fi
  [ -z "$lines" ] && return 0
  printf '## %s\n\n' "$title"
  printf '%s\n' "$lines" | sed 's/^/- /'
  printf '\n'
}

FEAT_PATTERN='^feat(\([^)]*\))?!?:'
FIX_PATTERN='^fix(\([^)]*\))?!?:'

{
  if [ -z "$SUBJECTS" ]; then
    printf 'No changes under %s/ that were not already in a previous release.\n\n' "$PROJECT"
  else
    section 'Features' "$FEAT_PATTERN"
    section 'Fixes' "$FIX_PATTERN"
    section 'Other' "${FEAT_PATTERN}|${FIX_PATTERN}" invert
  fi
  if [ -n "$BASELINE" ]; then
    printf '**Full Changelog**: %s/compare/%s...%s\n' "$REPO_URL" "$BASELINE" "$TAG"
  else
    printf '**Full Changelog**: %s/commits/%s\n' "$REPO_URL" "$TAG"
  fi
} > "$OUT"

echo "Release notes for ${TAG} (baseline: ${BASELINE:-none}) written to ${OUT}" >&2
