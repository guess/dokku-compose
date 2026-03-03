#!/usr/bin/env bash
# Tag and release a new version after verifying CI passed
set -euo pipefail

VERSION="${1:-}"

if [[ -z "$VERSION" ]]; then
    echo "Usage: scripts/release.sh <version>" >&2
    echo "Example: scripts/release.sh 0.2.0" >&2
    exit 1
fi

TAG="v${VERSION}"

if git rev-parse "$TAG" &>/dev/null; then
    echo "Error: tag $TAG already exists" >&2
    exit 1
fi

# Ensure we're on main and up to date
BRANCH="$(git branch --show-current)"
if [[ "$BRANCH" != "main" ]]; then
    echo "Error: must be on main branch (currently on $BRANCH)" >&2
    exit 1
fi

SHA="$(git rev-parse HEAD)"

echo "Checking CI status for $(git log --oneline -1 HEAD)..."

STATUS="$(gh run list --branch main --commit "$SHA" --workflow tests.yml --json conclusion --jq '.[0].conclusion')"

if [[ -z "$STATUS" ]]; then
    echo "Error: no CI run found for commit $SHA" >&2
    echo "Push to main first and wait for CI to complete." >&2
    exit 1
fi

if [[ "$STATUS" != "success" ]]; then
    echo "Error: CI status is '$STATUS' — cannot release" >&2
    exit 1
fi

echo "CI passed. Tagging $TAG..."
git tag "$TAG"
git push origin "$TAG"

echo "Done. Release workflow will create the GitHub release."
echo "Track it: gh run list --workflow=release.yml --limit=1"
