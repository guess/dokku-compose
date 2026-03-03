# Dokku Feature Audit Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Audit all 26 Dokku documentation sections, classify commands, propose YAML keys, and produce a complete coverage map in `docs/dokku-audit.md`.

**Architecture:** Parallel agent sweep — dispatch agents per batch to read Dokku docs, classify commands as declarative/imperative/read-only, check existing lib code for gaps, and propose YAML keys. Results merge into one audit file. After the audit, add doc URL headers to all lib files.

**Tech Stack:** Bash, BATS tests, yq, WebSearch for Dokku doc pages

**Reference:** Design doc at `docs/plans/2026-03-03-dokku-feature-audit-design.md`

---

### Task 1: Create audit file skeleton

**Files:**
- Create: `docs/dokku-audit.md`

**Step 1: Create the file with header and all 26 namespace placeholders**

```markdown
# Dokku Feature Audit

Systematic audit of all Dokku command namespaces for dokku-compose coverage.
See `docs/plans/2026-03-03-dokku-feature-audit-design.md` for methodology.

**Legend:**
- **supported** — Fully implemented in dokku-compose
- **partial** — Module exists but missing some declarative commands
- **planned** — Not yet implemented, has declarative commands worth supporting
- **skipped** — No declarative commands that make sense for dokku-compose

---

## Summary

| # | Namespace | Module | Status | Doc |
|---|-----------|--------|--------|-----|
| 1 | apps | apps.sh | pending | [link](https://dokku.com/docs/deployment/application-management/) |
| 2 | domains | apps.sh | pending | [link](https://dokku.com/docs/configuration/domains/) |
| 3 | config | config.sh | pending | [link](https://dokku.com/docs/configuration/environment-variables/) |
| 4 | certs | certs.sh | pending | [link](https://dokku.com/docs/configuration/ssl/) |
| 5 | network | network.sh | pending | [link](https://dokku.com/docs/networking/network/) |
| 6 | ports | ports.sh | pending | [link](https://dokku.com/docs/networking/port-management/) |
| 7 | nginx | nginx.sh | pending | [link](https://dokku.com/docs/networking/proxies/nginx/) |
| 8 | builder-* | builder.sh | pending | [link](https://dokku.com/docs/deployment/builders/herokuish-buildpacks/) |
| 9 | docker-options | builder.sh | pending | [link](https://dokku.com/docs/advanced-usage/docker-options/) |
| 10 | plugin | plugins.sh | pending | [link](https://dokku.com/docs/advanced-usage/plugin-management/) |
| 11 | version | dokku.sh | pending | [link](https://dokku.com/docs/getting-started/installation/) |
| 12 | git | git.sh | pending | [link](https://dokku.com/docs/deployment/methods/git/) |
| 13 | proxy | — | pending | [link](https://dokku.com/docs/networking/proxy-management/) |
| 14 | ps | — | pending | [link](https://dokku.com/docs/processes/process-management/) |
| 15 | storage | — | pending | [link](https://dokku.com/docs/advanced-usage/persistent-storage/) |
| 16 | resource | — | pending | [link](https://dokku.com/docs/advanced-usage/resource-management/) |
| 17 | registry | — | pending | [link](https://dokku.com/docs/advanced-usage/registry-management/) |
| 18 | scheduler | — | pending | [link](https://dokku.com/docs/deployment/schedulers/scheduler-management/) |
| 19 | checks | — | pending | [link](https://dokku.com/docs/deployment/zero-downtime-deploys/) |
| 20 | logs | — | pending | [link](https://dokku.com/docs/deployment/logs/) |
| 21 | cron | — | pending | [link](https://dokku.com/docs/processes/scheduled-cron-tasks/) |
| 22 | run | — | pending | [link](https://dokku.com/docs/processes/one-off-tasks/) |
| 23 | repo | — | pending | [link](https://dokku.com/docs/advanced-usage/repository-management/) |
| 24 | image | — | pending | [link](https://dokku.com/docs/deployment/methods/image/) |
| 25 | backup | — | pending | [link](https://dokku.com/docs/advanced-usage/backup-recovery/) |
| 26 | app-json | builder.sh | pending | [link](https://dokku.com/docs/appendices/file-formats/app-json/) |

---

<!-- Audit sections will be appended below by agents -->
```

**Step 2: Commit**

```bash
git add docs/dokku-audit.md
git commit -m "docs: add dokku-audit.md skeleton for feature audit"
```

---

### Task 2: Audit Batch A — Existing Core (apps, domains, config, certs)

**Files:**
- Read: `lib/apps.sh`, `lib/config.sh`, `lib/certs.sh`
- Modify: `docs/dokku-audit.md`

**Step 1: Dispatch agent to audit these 4 namespaces**

The agent must:

1. **For each namespace** (apps, domains, config, certs):
   - WebSearch the Dokku doc URL to find all commands listed on that page
   - Read the existing `lib/*.sh` file to see what's already implemented
   - List every `dokku <namespace>:<command>` found in the docs
   - Classify each as: declarative, imperative, or read-only
   - Check which declarative commands are already in the lib file
   - Propose YAML keys for any missing declarative commands
   - Write the audit section in this exact format:

```markdown
## <namespace> — <Title>

**Doc:** <url>
**Module:** `lib/<file>.sh`
**Status:** supported | partial | planned | skipped

### Commands

| Command | Type | Supported | Notes |
|---------|------|-----------|-------|
| namespace:cmd | declarative/imperative/read-only | yes/no/partial | ... |

### Proposed YAML Keys

(yaml block showing proposed config structure)

### Gaps in Existing Code

- List specific missing features

### Decision

Why this status was chosen.
```

2. **Specific things to look for:**
   - `apps:*` — Are we handling `apps:clone`, `apps:rename`, `apps:lock`? Probably skip (imperative).
   - `domains:*` — Currently only `domains:disable`. Missing `domains:add`, `domains:set`, `domains:remove`. These are declarative and should be planned.
   - `config:*` — Currently sets vars. Missing `config:unset` for removed keys (idempotency gap). Check if `config:clear` makes sense.
   - `certs:*` — Currently only `certs:add`. Missing `certs:remove` for teardown. Check `certs:generate`.

**Step 2: Review agent output and append to `docs/dokku-audit.md`**

**Step 3: Commit**

```bash
git add docs/dokku-audit.md
git commit -m "docs: audit batch A — apps, domains, config, certs"
```

---

### Task 3: Audit Batch B — Existing Networking (network, ports, nginx, proxy)

**Files:**
- Read: `lib/network.sh`, `lib/ports.sh`, `lib/nginx.sh`
- Modify: `docs/dokku-audit.md`

**Step 1: Dispatch agent to audit these 4 namespaces**

The agent follows the same checklist as Task 2. Specific things to look for:

- `network:*` — Currently creates networks and sets `attach-post-deploy`. Missing `attach-post-create`, `initial-network`, `tld` properties. Missing `destroy_networks()` in down flow.
- `ports:*` — Currently sets ports. Check if `ports:add` vs `ports:set` semantics matter. Missing `ports:clear` for teardown.
- `nginx:*` — Currently sets arbitrary key-value pairs. Check for `nginx:show-config`, custom template support, `nginx:validate-config`. Access/error log configuration.
- `proxy:*` — No module exists. Check `proxy:enable`, `proxy:disable`, `proxy:set`. Likely needed for apps that don't want a proxy (workers, cron jobs).

**Step 2: Review agent output and append to `docs/dokku-audit.md`**

**Step 3: Commit**

```bash
git add docs/dokku-audit.md
git commit -m "docs: audit batch B — network, ports, nginx, proxy"
```

---

### Task 4: Audit Batch C — Existing Build (builder-*, docker-options, plugin, git)

**Files:**
- Read: `lib/builder.sh`, `lib/plugins.sh`, `lib/git.sh`
- Modify: `docs/dokku-audit.md`

**Step 1: Dispatch agent to audit these 4 namespaces**

Specific things to look for:

- `builder-*:*` — Currently only handles `builder-dockerfile`. Check `builder-herokuish`, `builder-pack`, `builder-railpack`. The `builder:set` command to select builder type.
- `docker-options:*` — Currently only handles `build` phase for build args. Missing `deploy` and `run` phases. Users may need docker options for deploy (e.g., `--gpus`, `--shm-size`).
- `plugin:*` — Currently installs plugins. Check `plugin:update`, `plugin:uninstall`. Version pinning via `--committish`.
- `git:*` — Currently a stub. Check `git:set` (for deploy-branch, keep-git-dir), `git:from-image`, `git:sync`. Some are declarative config, some are deployment actions.
- `app-json:*` — Currently sets `appjson-path`. Check full app.json format support (formation, scripts, cron).

**Step 2: Review agent output and append to `docs/dokku-audit.md`**

**Step 3: Commit**

```bash
git add docs/dokku-audit.md
git commit -m "docs: audit batch C — builder, docker-options, plugin, git, app-json"
```

---

### Task 5: Audit Batch D — New Process Management (ps, resource, scheduler, checks)

**Files:**
- Modify: `docs/dokku-audit.md`

**Step 1: Dispatch agent to audit these 4 namespaces**

These have no existing modules. The agent must:
1. WebSearch each doc URL
2. List all commands
3. Classify each command
4. Propose YAML keys for declarative ones
5. Recommend whether a new `lib/*.sh` module is needed

Specific things to look for:

- `ps:*` — `ps:scale` is declarative (process scaling). `ps:set` for restart policy, deploy-timeout. `ps:restart`, `ps:start`, `ps:stop` are imperative. Likely **planned** with a new `lib/ps.sh`.
- `resource:*` — `resource:limit` and `resource:reserve` are declarative (CPU/memory). Likely **planned** with support in existing app config or new module.
- `scheduler:*` — `scheduler:set` to pick scheduler (docker-local, k3s). Declarative. Could go in `dokku.sh` or new `lib/scheduler.sh`.
- `checks:*` — `checks:set` for deploy check settings (wait-to-retire, attempts). Declarative. Likely **planned**.

**Step 2: Review agent output and append to `docs/dokku-audit.md`**

**Step 3: Commit**

```bash
git add docs/dokku-audit.md
git commit -m "docs: audit batch D — ps, resource, scheduler, checks"
```

---

### Task 6: Audit Batch E — New Infrastructure (storage, registry, logs, cron)

**Files:**
- Modify: `docs/dokku-audit.md`

**Step 1: Dispatch agent to audit these 4 namespaces**

Specific things to look for:

- `storage:*` — `storage:mount` and `storage:unmount` are declarative. Persistent volume mounts are a key missing feature. Likely **planned** with new `lib/storage.sh`.
- `registry:*` — `registry:set` (server, image-repo, push-on-release). Could be global or per-app config. Evaluate if this fits declarative model.
- `logs:*` — `logs:set` for vector configuration (log shipping). Declarative. The `logs` command itself is imperative. Evaluate vector-sink, max-size options.
- `cron` — Cron is configured via `app.json` `cron` key, not a standalone `dokku cron:*` namespace. Check how it interacts with current app.json support.

**Step 2: Review agent output and append to `docs/dokku-audit.md`**

**Step 3: Commit**

```bash
git add docs/dokku-audit.md
git commit -m "docs: audit batch E — storage, registry, logs, cron"
```

---

### Task 7: Audit Batch F — Remaining (run, repo, image, backup, dokku version)

**Files:**
- Modify: `docs/dokku-audit.md`

**Step 1: Dispatch agent to audit these 5 namespaces**

Most of these are likely **skipped** but need explicit decisions:

- `run:*` — One-off tasks. Entirely imperative. Likely **skipped**.
- `repo:*` — Repository management (`repo:gc`, `repo:purge-cache`). Imperative maintenance. Likely **skipped**.
- `image:*` — Docker image deployment. `image:pull` is a deployment action. Likely **skipped** (deployment is out of scope per git.sh).
- Backup/Recovery — `backup:export`, `backup:import`. Imperative operations. Likely **skipped**.
- `version` / `dokku.sh` — Already implemented. Verify completeness (just version check + install).

**Step 2: Review agent output and append to `docs/dokku-audit.md`**

**Step 3: Commit**

```bash
git add docs/dokku-audit.md
git commit -m "docs: audit batch F — run, repo, image, backup, version"
```

---

### Task 8: Update summary table in audit file

**Files:**
- Modify: `docs/dokku-audit.md`

**Step 1: Update the summary table at the top of the audit file**

Replace all `pending` statuses in the summary table with the actual status determined by each batch (supported/partial/planned/skipped).

**Step 2: Add a statistics section after the summary table**

```markdown
## Statistics

- **Supported:** X namespaces
- **Partial:** X namespaces (gaps identified)
- **Planned:** X namespaces (new features to implement)
- **Skipped:** X namespaces (imperative only, not suitable)
```

**Step 3: Commit**

```bash
git add docs/dokku-audit.md
git commit -m "docs: update audit summary with final statuses"
```

---

### Task 9: Add doc URL headers to all existing lib files

**Files:**
- Modify: `lib/apps.sh`, `lib/builder.sh`, `lib/certs.sh`, `lib/config.sh`, `lib/core.sh`, `lib/dokku.sh`, `lib/git.sh`, `lib/network.sh`, `lib/nginx.sh`, `lib/plugins.sh`, `lib/ports.sh`, `lib/services.sh`, `lib/yaml.sh`

**Step 1: Add a comment block at the top of each lib file (after the shebang/set lines)**

Each file gets a header like:

```bash
# lib/apps.sh — Application and domain management
# Dokku docs: https://dokku.com/docs/deployment/application-management/
#              https://dokku.com/docs/configuration/domains/
# Commands: apps:*, domains:*
```

Use the doc URLs and command namespaces from the audit file. For `core.sh` and `yaml.sh` which are internal utilities (no Dokku namespace), use:

```bash
# lib/core.sh — Logging, colors, and dokku_cmd wrapper
# Internal utility module — no direct Dokku command namespace
```

**Step 2: Run tests to make sure nothing broke**

```bash
./tests/bats/bin/bats tests/
```

Expected: All tests pass (comments don't affect behavior).

**Step 3: Commit**

```bash
git add lib/*.sh
git commit -m "docs: add Dokku doc URL headers to all lib modules"
```

---

### Task 10: Review and final commit

**Step 1: Read `docs/dokku-audit.md` end-to-end**

Verify:
- All 26 namespaces have sections
- Summary table matches section statuses
- No duplicate or missing namespaces
- YAML key proposals follow existing conventions
- Decisions have clear rationale

**Step 2: Run full test suite**

```bash
./tests/bats/bin/bats tests/
```

Expected: All tests pass.

**Step 3: Final commit if any cleanup was needed**

```bash
git add -A
git commit -m "docs: finalize dokku feature audit"
```
