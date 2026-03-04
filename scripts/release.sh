#!/usr/bin/env bash
# Bump version, tag, and push — CI runs tests before publishing
set -euo pipefail

VERSION="${1:-}"

if [[ -z "$VERSION" ]]; then
    echo "Usage: scripts/release.sh <version>" >&2
    echo "Example: scripts/release.sh 0.3.0" >&2
    exit 1
fi

TAG="v${VERSION}"

if git rev-parse "$TAG" &>/dev/null; then
    echo "Error: tag $TAG already exists" >&2
    exit 1
fi

BRANCH="$(git branch --show-current)"
if [[ "$BRANCH" != "main" ]]; then
    echo "Error: must be on main branch (currently on $BRANCH)" >&2
    exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
    echo "Error: working tree is dirty — commit or stash changes first" >&2
    exit 1
fi

echo "Bumping version to $VERSION..."
npm version "$VERSION" --no-git-tag-version
git add package.json
git commit -m "chore: release $TAG"

echo "Tagging $TAG..."
git tag "$TAG"
git push origin main "$TAG"

echo "Done. Release workflow will run tests and publish to npm."
echo "Track it: gh run list --workflow=release.yml --limit=1"
