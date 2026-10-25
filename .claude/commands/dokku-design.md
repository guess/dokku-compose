---
description: Design and implement a dokku-compose module from the audit
arguments:
  - name: context
    description: The audit item or namespace to work on (e.g., F10, A3, storage, certs)
    required: true
---

# Dokku Module Design: $ARGUMENTS.context

Work through `$ARGUMENTS.context` from `docs/dokku-audit.md`: design the YAML API, then ship it in one PR whose first commit is the design (the reference docs) and whose later commits make it true. The workflow is the doc's "Tracking work" section; read it first.

## Step 1: Research

Read these to understand the current state:

- `docs/dokku-audit.md`: the item's row in **Priorities**, and its rows in **Commands** and **Properties**
- The current implementation in `src/modules/*.ts` and `src/resources/*.ts`, and the tests beside it
- `docs/reference/<module>.md`, if the feature already has one
- Upstream Dokku at the audited tag (the doc's "Re-auditing" section has the clone commands): the plugin's help text and source, for every command, flag and property and how each behaves

Summarize what exists today and what the audit identifies as gaps.

## Step 2: Design the YAML API

**STOP and present the design to the user before writing anything.**

For each gap or new feature, propose the YAML key structure. Follow the patterns the existing resources use:

- **Tri-state boolean:** `true` does X, `false` does Y, absent = no action (`src/resources/toggle.ts`)
- **List/false/absent:** a list sets values, `false` clears or disables, absent = no action (`src/resources/lists.ts`)
- **Map of properties:** each key maps to a `<namespace>:set` call (`src/resources/properties.ts`)

Present a table showing each YAML key and its possible values, the Dokku command each value runs, and what happens when the key is absent.

Consider:

- App scope, global scope (`--global`), or both
- How `diff` and `export` read it, and whether `diff` in sync still means `up` runs nothing (`src/tests/in-sync.test.ts`)
- `--prune`, `down`, and `--dry-run` (a read after a command the dry run skipped)
- Whether a change needs a restart or rebuild to reach the app (`ctx.needsRestart`, `ctx.needsRebuild`)
- Secrets: values that must be masked in logs, `diff` and `export`
- What `validate` rejects (`src/core/schema.ts`), and the Dokku version that added each command

**Wait for user approval before proceeding.**

## Step 3: Commit the design

The PR's first commit changes docs only, and is the contract for the rest:

- `docs/reference/<module>.md`: edit it in place to describe what the PR ships, following `docs/reference/CLAUDE.md`. Write it as the current reference: no "Proposed", "Planned" or "Design" section.
- `docs/dokku-audit.md`: rewrite the item's Notes to say what will change. The Status stays ❌.

Reasons and rejected options go in the PR description, not the docs. Implementation plans are working notes: keep them out of the repo.

## Step 4: Write tests

Write the tests first, beside the code (`src/resources/<name>.test.ts`, `src/modules/<name>.test.ts`). Cover:

- Each YAML value variant (list, `true`, `false`, map values), and the key absent
- Already in sync: no command runs
- `diff` and `export` for the new keys
- The in-sync harness: add the keys to `src/tests/fixtures/in-sync.yml` and the matching server state to `src/tests/fake-server.ts`

Run them and confirm they fail.

## Step 5: Implement

Follow the existing patterns:

- A per-app setting is a `Resource` (`src/core/reconcile.ts`): `read` the server state, `onChange` to apply a difference, `prune` for `--prune`. Register it in `src/resources/index.ts` and wire it into `src/commands/up.ts` in the order the CLAUDE.md execution flow gives.
- Schema and validation go in `src/core/schema.ts`.
- `ctx.query` and `ctx.queryStrict` read, `ctx.check` tests a boolean, `ctx.run` mutates.

Commit in reviewable steps (schema, resource, `diff`, `export`, …). Run `bun test` after each.

## Step 6: Close the item

The PR's last commit:

- `docs/dokku-audit.md`: change the commands' rows in `scripts/dokku-audit/commands.tsv` (or `datastores.tsv`) and rerun the generator ("Re-auditing", step 1); update **Properties**; set the item's Status to ✅ (or 🟡, naming what is left), add the PR link and rewrite its Notes to say what shipped
- `README.md`: keep the feature section brief and link to the reference doc
- `CHANGELOG.md`: an entry under `## [Unreleased]`

## Step 7: Verify

Run `bun test` (`src/tests/audit.test.ts` fails if the audit trails the code) and `bun run build`, then present a summary of the changes to the user.
