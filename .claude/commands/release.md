---
name: release
description: Bump the project version and cut a release. Use when the user says "release", "bump version", "cut a release", "new version", "prepare release", or "/release". Also use when the user mentions updating the changelog for a release, tagging a version, or running the release script.
arguments:
  - name: version
    description: "The new version number (e.g., 0.5.0). If omitted, you'll suggest one based on the commits."
    required: false
---

# Release Workflow

You are cutting a new release of dokku-compose. Follow these steps in order.

## Step 1: Determine the version

If a version was provided as an argument, use it. Otherwise:

1. Get the latest tag: `git describe --tags --abbrev=0`
2. Look at commits since that tag: `git log <tag>..HEAD --oneline --no-merges`
3. Suggest a version based on conventional commits:
   - Any `feat:` commits → bump minor (e.g., 0.4.0 → 0.5.0)
   - Only `fix:`/`chore:`/`docs:` commits → bump patch (e.g., 0.4.0 → 0.4.1)
4. Present your suggestion to the user with `AskUserQuestion` and let them confirm or override it. Show the commit summary so they can make an informed decision.

## Step 2: Check the changelog

Read `CHANGELOG.md` and check the `## [Unreleased]` section.

Compare the entries against the commits since the last tag. If there are commits that should be in the changelog but aren't (features, fixes, breaking changes), tell the user what's missing and ask if they want you to add them before proceeding. Documentation-only and test-only commits don't need changelog entries.

If the Unreleased section is empty, warn the user — a release with no changelog entries is unusual. Ask if they want to proceed or add entries first.

## Step 3: Bump the changelog

Once the changelog content is confirmed:

1. Replace `## [Unreleased]` with `## [Unreleased]` (empty) followed by the new version heading
2. The new heading format is: `## [<version>] - <YYYY-MM-DD>` (today's date)
3. Move all content from the old Unreleased section under the new version heading
4. Add a blank `## [Unreleased]` section at the top with no entries

Example transformation:
```
## [Unreleased]

### Added
- New feature X

## [0.4.0] - 2026-03-04
```
becomes:
```
## [Unreleased]

## [0.5.0] - 2026-03-05

### Added
- New feature X

## [0.4.0] - 2026-03-04
```

## Step 4: Land the release and tag it

Releases land through a pull request: either a release PR (`chore: release v<version>`) that changes only `CHANGELOG.md` and the `version` in `package.json`, or the bump included in the last fix PR. The tag `v<version>` points at the squash-merge commit on `main`. Pushing the tag is what triggers `.github/workflows/release.yml`.

1. On a branch, commit the changelog from Step 3 and bump `package.json`: `npm version <version> --no-git-tag-version`. Commit as `chore: release v<version>`, open the PR and merge it (squash) into `main`.
2. Switch to `main`, pull, and confirm HEAD is the merged release commit with a clean tree.
3. Tag and push the tag: `git tag v<version> && git push origin v<version>`.

`./scripts/release.sh <version>` is the direct alternative. It bumps `package.json`, commits `chore: release v<version>`, tags and pushes `main` and the tag in one go, so use it only when you may push to `main` without a PR, with the changelog already committed. It fails if the tree is dirty, the tag exists or you are not on `main`.

## Step 5: Confirm success

After the script completes, tell the user:
- The version that was released
- The git tag that was created
- Remind them they can track the CI run with: `gh run list --workflow=release.yml --limit=1` (it runs `bun test` and `bun run build`, publishes to npm and creates the GitHub release)
