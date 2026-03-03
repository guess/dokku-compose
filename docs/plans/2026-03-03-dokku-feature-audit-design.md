# Dokku Feature Audit Design

**Date:** 2026-03-03
**Goal:** Systematically audit all Dokku documentation sections, identify which commands map to declarative config, propose YAML keys, and track coverage gaps — making dokku-compose feature-complete.

## Approach

Parallel Agent Sweep: dispatch agents in batches to audit Dokku namespaces, each following a reusable checklist. Results accumulate in `docs/dokku-audit.md`.

## Namespace Inventory (26 total)

### Existing modules (audit for gaps within)

| # | Namespace | Module | Doc URL |
|---|-----------|--------|---------|
| 1 | `apps:*` | apps.sh | https://dokku.com/docs/deployment/application-management/ |
| 2 | `domains:*` | apps.sh (partial) | https://dokku.com/docs/configuration/domains/ |
| 3 | `config:*` | config.sh | https://dokku.com/docs/configuration/environment-variables/ |
| 4 | `certs:*` | certs.sh | https://dokku.com/docs/configuration/ssl/ |
| 5 | `network:*` | network.sh | https://dokku.com/docs/networking/network/ |
| 6 | `ports:*` | ports.sh | https://dokku.com/docs/networking/port-management/ |
| 7 | `nginx:*` | nginx.sh | https://dokku.com/docs/networking/proxies/nginx/ |
| 8 | `builder-*:*` | builder.sh | https://dokku.com/docs/deployment/builders/herokuish-buildpacks/ |
| 9 | `docker-options:*` | builder.sh (partial) | https://dokku.com/docs/advanced-usage/docker-options/ |
| 10 | `plugin:*` | plugins.sh | https://dokku.com/docs/advanced-usage/plugin-management/ |
| 11 | `version` | dokku.sh | https://dokku.com/docs/getting-started/installation/ |
| 12 | `git:*` | git.sh (stub) | https://dokku.com/docs/deployment/methods/git/ |

### No module yet (need audit)

| # | Namespace | Doc URL |
|---|-----------|---------|
| 13 | `proxy:*` | https://dokku.com/docs/networking/proxy-management/ |
| 14 | `ps:*` | https://dokku.com/docs/processes/process-management/ |
| 15 | `storage:*` | https://dokku.com/docs/advanced-usage/persistent-storage/ |
| 16 | `resource:*` | https://dokku.com/docs/advanced-usage/resource-management/ |
| 17 | `registry:*` | https://dokku.com/docs/advanced-usage/registry-management/ |
| 18 | `scheduler:*` | https://dokku.com/docs/deployment/schedulers/scheduler-management/ |
| 19 | `checks:*` | https://dokku.com/docs/deployment/zero-downtime-deploys/ |
| 20 | `logs:*` | https://dokku.com/docs/deployment/logs/ |
| 21 | `cron` | https://dokku.com/docs/processes/scheduled-cron-tasks/ |
| 22 | `run:*` | https://dokku.com/docs/processes/one-off-tasks/ |
| 23 | `repo:*` | https://dokku.com/docs/advanced-usage/repository-management/ |
| 24 | `image:*` | https://dokku.com/docs/deployment/methods/image/ |
| 25 | Backup/Recovery | https://dokku.com/docs/advanced-usage/backup-recovery/ |
| 26 | `app-json:*` | https://dokku.com/docs/appendices/file-formats/app-json/ |

## Agent Checklist (per namespace)

Each agent follows these steps for every namespace it audits:

### Step 1: Fetch the doc page
Read the Dokku documentation URL for the namespace.

### Step 2: Extract all commands
List every `dokku <namespace>:<command>` on the page.

### Step 3: Classify each command
- **Declarative** — Sets persistent state that belongs in config (e.g., `config:set`, `network:set`, `storage:mount`)
- **Imperative/operational** — Runtime action, not config (e.g., `ps:restart`, `run`, `logs`)
- **Read-only** — Query/report only (e.g., `config:show`, `ports:report`)

### Step 4: Check existing module (if applicable)
Read the current `lib/*.sh` file. Compare against the full command list. Note declarative commands not yet implemented.

### Step 5: Propose YAML keys
For each declarative command, propose the YAML path. Follow conventions:
- App-level keys: `apps.<app>.<key>`
- Top-level keys: `<section>.<key>`
- Snake_case for key names
- Lists for multi-value, maps for key-value pairs
- Match existing patterns (e.g., `ports: ["https:4001:4000"]`, `nginx: {key: value}`)

### Step 6: Draft doc header
Write the comment block for the top of the lib file:
```bash
# lib/<module>.sh — <Description>
# Dokku docs: <url>
# Commands: <namespace>:*
```

### Step 7: Write to audit file
Append findings to `docs/dokku-audit.md` in the standard format (see below).

## Audit File Format

Each namespace gets a section in `docs/dokku-audit.md`:

```markdown
## <namespace> — <Title>

**Doc:** <url>
**Module:** `lib/<file>.sh` | New module needed
**Status:** supported | partial | planned | skipped

### Commands

| Command | Type | Supported | Notes |
|---------|------|-----------|-------|
| namespace:cmd | declarative/imperative/read-only | yes/no/partial | ... |

### Proposed YAML Keys

\```yaml
apps:
  myapp:
    key: value
\```

### Gaps in Existing Code

- List of missing features in current module

### Decision

Rationale for the status classification.
```

## Agent Batching

| Batch | Namespaces | Rationale |
|-------|-----------|-----------|
| A — Existing core | apps, domains, config, certs | Already have modules, audit for gaps |
| B — Existing networking | network, ports, nginx, proxy | Related networking stack |
| C — Existing build | builder-*, docker-options, plugin, git | Build/deploy pipeline |
| D — New process mgmt | ps, resource, scheduler, checks | Process lifecycle |
| E — New infra | storage, registry, logs, cron | Infrastructure concerns |
| F — Remaining | run, repo, image, backup, app-json, dokku version | Misc / likely skip candidates |

## Output Artifacts

1. **`docs/dokku-audit.md`** — Master tracking file with all 26 namespace audits
2. **`docs/plans/2026-03-03-dokku-feature-audit-design.md`** — This design document
3. **Updated `lib/*.sh` headers** — Each file gets a doc URL comment at the top
4. **Updated README** — Config reference section expanded with all supported + planned YAML keys

## Post-Audit Process

1. Review audit file for accuracy
2. Each "planned" namespace becomes an implementation task
3. Implementation follows existing patterns: `ensure_*`/`destroy_*` functions, BATS tests, README section
4. README config reference updated as features are implemented
