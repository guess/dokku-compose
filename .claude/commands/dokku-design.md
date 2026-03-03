---
description: Design and implement a dokku-compose module from the audit
arguments:
  - name: context
    description: The namespace to work on (e.g., apps, domains, config, certs)
    required: true
---

# Dokku Module Design: $ARGUMENTS.context

Work through the `$ARGUMENTS.context` namespace from `docs/dokku-audit.md`, designing the YAML API and implementing it.

## Step 1: Research

Read these files to understand the current state:

- `docs/dokku-audit.md` — find the section for `$ARGUMENTS.context`
- `lib/<module>.sh` — the current implementation (if it exists)
- `tests/<module>.bats` — the current tests (if they exist)
- Fetch the upstream Dokku docs (the link is in the audit) to understand all available commands and their behavior

Summarize what exists today and what the audit identifies as gaps.

## Step 2: Design the YAML API

**STOP and present the design to the user before implementing.**

For each gap or new feature, propose the YAML key structure. Follow these conventions established by apps and domains:

- **Tri-state pattern for booleans:** `true` does X, `false` does Y, absent = no action
- **List/false/absent pattern:** list sets values, `false` clears/disables, absent = no action
- **Map pattern:** each key-value pair maps to a `<namespace>:set` call
- **Consistency:** use the same patterns as existing modules (check `lib/proxy.sh` for boolean, `lib/domains.sh` for list/false/absent, `lib/nginx.sh` for map passthrough)

Present a clear table showing:
- Each YAML key and its possible values
- What Dokku command each value maps to
- What happens when the key is absent

Consider:
- Does this need both app-scoped and global-scoped support?
- Does the `down` path need changes?
- Are there any yq gotchas with `false`/boolean values? (reminder: `yaml_app_get` swallows `false` due to `// ""` — use `yaml_app_key_exists` + raw `yq eval` for booleans)

**Wait for user approval before proceeding.**

## Step 3: Write tests

Write tests FIRST in `tests/<module>.bats`. Cover:

- Each YAML value variant (list, true, false, map values)
- Absent key = no action
- Any new global-scoped function

Create minimal fixture files in `tests/fixtures/` as needed.

Run the tests and confirm they fail (functions don't exist yet or behavior changed).

## Step 4: Implement

Update `lib/<module>.sh` with the new/changed functions. Follow existing patterns:

- Use `yaml_app_key_exists` for presence checks on keys that can be `false`
- Use raw `yq eval` to read boolean values (not `yaml_app_get`)
- Use `yaml_app_has` / `yaml_app_get` for non-boolean values
- Log with `log_action` / `log_done`
- Mutations go through `dokku_cmd`, checks through `dokku_cmd_check`

If a new global function was added (like `ensure_global_domains`), wire it into `bin/dokku-compose` in the correct phase.

If new per-app functions were added, wire them into `configure_app()` in `bin/dokku-compose`.

Run the tests and confirm they all pass. Then run the full suite: `./tests/bats/bin/bats tests/`

## Step 5: Update docs

Three docs to update:

### 5a. `docs/dokku-audit.md`

Update the section for `$ARGUMENTS.context`:
- Commands table: mark newly supported commands as `yes`
- YAML Keys: update from "Proposed" to actual (remove "NOT YET IMPLEMENTED" notes)
- Gaps: remove resolved gaps, note any remaining
- Decision: update status and description
- Summary table: update status if changed (partial → supported, etc.)
- Statistics: update counts if status changed

### 5b. `docs/reference/<module>.md`

Create or update the reference doc following the template in `docs/reference/CLAUDE.md`:
- Title, Dokku docs link, Module
- One subsection per YAML key with description, example, and value→command table
- Only document what is implemented — no planned features

### 5c. `README.md`

- Update the feature section (keep it brief, link to full reference)
- Update the "What `up` Does" ordered list if execution phases changed

## Step 6: Verify

Run the full test suite one final time: `./tests/bats/bin/bats tests/`

Present a summary of changes to the user.
