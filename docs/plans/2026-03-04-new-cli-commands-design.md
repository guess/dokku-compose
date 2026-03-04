# New CLI Commands Design

**Date:** 2026-03-04
**Goal:** Add `export`, `diff`, and `validate` commands to dokku-compose, plus keep `--dry-run` on `up`.

## Command Overview

```
dokku-compose export             # reverse-engineer server state → YAML to stdout
dokku-compose export -o file.yml # write to file
dokku-compose diff               # summary table: what's out of sync
dokku-compose diff --verbose     # git-style +/- diff of current vs desired
dokku-compose validate           # pure YAML validation, no server contact
dokku-compose up --dry-run       # show dokku commands that would run (existing)
dokku-compose up                 # execute (existing)
dokku-compose down               # teardown (existing)
```

## Design Principles

1. **`export` is foundational** — it produces a canonical YAML representation of server state. Both `diff` and `--dry-run` can build on this.
2. **`diff` operates at the YAML/declarative level** — "what's different between my file and the server?"
3. **`--dry-run` operates at the command/imperative level** — "what dokku commands will run?"
4. **`validate` is offline-only** — no server contact, fast feedback for YAML authors and agents.
5. **Export scope: only managed features** — export only what dokku-compose.yml supports today. Clean round-trip: `export → up` should be a no-op.

## Layering

```
validate    → syntax/schema check (offline)
export      → query server → generate YAML (online)
diff        → compare local YAML vs export output (online)
up --dry-run → compute dokku commands from diff (online)
up          → execute commands (online)
```

Each layer builds on the one below it. `diff` internally uses the same state-querying logic as `export`. `--dry-run` internally uses the same diffing logic as `diff` but outputs commands instead of a summary.

## Command: `export`

### Purpose
Reverse-engineer a running Dokku server into a `dokku-compose.yml`. Primary use cases:
- Bootstrap adoption: point at existing server, get initial YAML
- Power the `diff` command internally
- Verify round-trip correctness: `export → up` = no-op

### Interface
```
dokku-compose export [options]
  -o, --output FILE    Write to file instead of stdout
  --app APP            Export only a specific app (optional)
```

### Implementation: `lib/export.sh`

For each module, query the server and build a YAML structure. Uses `dokku_cmd_check` for all queries.

#### State queries per module

| Module | Query Commands | YAML Output |
|--------|---------------|-------------|
| dokku | `version` | `.dokku.version` |
| plugins | `plugin:list` | `.plugins.<name>.url`, `.version` |
| networks | `network:list` | `.networks[]` |
| services | `<plugin>:list` for each installed service plugin | `.services.<name>.plugin`, `.version` |
| apps | `apps:list` | `.apps.<name>` |
| domains | `domains:report <app>` | `.apps.<name>.domains[]` |
| domains (global) | `domains:report --global` | `.domains[]` |
| config | `config:export <app>` or `config:keys` + `config:get` | `.apps.<name>.env.<KEY>` |
| config (global) | `config:export --global` or `config:keys --global` + `config:get --global` | `.env.<KEY>` |
| ports | `ports:report <app> --ports-map` | `.apps.<name>.ports[]` |
| proxy | `proxy:report <app> --proxy-enabled` | `.apps.<name>.proxy.enabled` |
| certs | `certs:report <app> --ssl-enabled` | `.apps.<name>.ssl` (bool only — can't export cert files) |
| storage | `storage:report <app> --storage-mounts` | `.apps.<name>.storage[]` |
| nginx | `nginx:report <app>` | `.apps.<name>.nginx.<key>` |
| nginx (global) | `nginx:report --global` | `.nginx.<key>` |
| checks | `checks:report <app>` | `.apps.<name>.checks.<key>` |
| logs | `logs:report <app>` | `.apps.<name>.logs.<key>` |
| logs (global) | `logs:report --global` | `.logs.<key>` |
| registry | `registry:report <app>` | `.apps.<name>.registry.<key>` |
| scheduler | `scheduler:report <app> --scheduler-selected` | `.apps.<name>.scheduler` |
| builder | `builder:report <app>`, `builder-dockerfile:report <app>`, `app-json:report <app>` | `.apps.<name>.build.*` |
| docker_options | `docker-options:report <app>` | `.apps.<name>.docker_options.<phase>[]` |
| network (app) | `network:report <app>` | `.apps.<name>.networks[]`, `.apps.<name>.network.*` |
| links | For each service, `<plugin>:linked <service> <app>` | `.apps.<name>.links[]` |

#### Filtering defaults from export
Many `dokku *:report` commands return default values. Export should **omit defaults** to keep YAML clean. For example, if `proxy-enabled` is `true` (the default), don't emit `.proxy.enabled: true`.

#### Service discovery challenge
Export needs to know which service plugins are installed to query them. Approach:
1. Parse `plugin:list` output
2. For known service plugins (postgres, redis, mongo, mysql, mariadb, etc.), try `<plugin>:list`
3. Service names don't encode which app they belong to — we can infer links via `<plugin>:links <service>` but can't auto-assign to `.apps.<name>.links[]` without checking each app

### Output format
Standard `dokku-compose.yml` YAML, written via `yq` to ensure consistent formatting.

---

## Command: `diff`

### Purpose
Compare local `dokku-compose.yml` against actual server state. Two output modes:

### Default: Summary table
```
dokku-compose diff

  app: api
    ~ config:  3 vars differ
    + domains: api.example.com (not set)
    ~ ports:   http:80:5000 → http:80:3000
  app: worker
    (in sync)
  services:
    + api-postgres: not provisioned

  3 resources out of sync.
```

Symbols: `+` = needs to be created/added, `~` = needs update, `-` = would be removed (convergence)

### `--verbose`: Git-style diff
```
dokku-compose diff --verbose

--- server (current)
+++ dokku-compose.yml (desired)
@@ app: api / config @@
- DATABASE_URL=postgres://old-host/db
+ DATABASE_URL=postgres://new-host/db
+ REDIS_URL=redis://localhost:6379
@@ app: api / domains @@
+ api.example.com
@@ services @@
+ api-postgres (postgres)
```

### Exit codes
- `0` = everything in sync
- `1` = differences found
- `2` = error (can't reach server, invalid YAML, etc.)

This makes `diff` usable in scripts/CI: `dokku-compose diff || dokku-compose up`

### Implementation approach
1. Run the same state queries as `export` to build "current state" model
2. Parse local YAML to build "desired state" model
3. Compare the two models per-app, per-feature
4. Format output based on `--verbose` flag

The comparison logic lives in `lib/diff.sh` and is the core engine. Both `diff` (summary/verbose) and `up --dry-run` (command list) use this same comparison to determine what's out of sync.

---

## Command: `validate`

### Purpose
Offline YAML validation. No server contact. Catches:
- YAML syntax errors
- Unknown top-level keys
- Invalid port format (should be `scheme:host:container`)
- Missing service references (app links to service not defined in `services:`)
- Missing plugin declarations (service uses plugin not in `plugins:`)
- Invalid domain formats
- Type errors (string where list expected, etc.)

### Interface
```
dokku-compose validate [file]
  file    Path to YAML file (default: dokku-compose.yml)
```

### Exit codes
- `0` = valid
- `1` = validation errors found

### Implementation: `lib/validate.sh`

Validation rules (ordered by priority):

1. **YAML parseable** — `yq` can read it without error
2. **Known top-level keys** — only `dokku`, `plugins`, `networks`, `services`, `apps`, `domains`, `env`, `nginx`, `logs` allowed
3. **Service references resolve** — every item in `.apps.<name>.links[]` exists in `.services`
4. **Plugin references resolve** — every `.services.<name>.plugin` has a matching key in `.plugins` (warning, not error — plugins may be pre-installed)
5. **Port format** — each port matches `scheme:host:container` pattern
6. **Type checks** — domains is list or `false`, env is map or `false`, ports is list, etc.
7. **No duplicate app names** — YAML keys are unique (yq handles this, but warn)

### Output format
```
dokku-compose validate

  ERROR: apps.api.links[0]: service "api-postgres" not defined in services
  ERROR: apps.api.ports[0]: invalid port format "80:5000" (expected scheme:host:container)
  WARN:  services.api-redis.plugin: plugin "redis" not declared in plugins (may be pre-installed)

  2 errors, 1 warning
```

---

## Command: `up --dry-run` (existing, keep as-is)

The existing `--dry-run` flag on `up` continues to work as it does today — showing the dokku commands that would execute. No changes needed to this behavior.

The internal refactoring opportunity is that `--dry-run` could eventually use the same comparison engine as `diff`, but this is not required for the initial implementation. The existing approach (each `ensure_*` function respects `DOKKU_COMPOSE_DRY_RUN`) works and is well-tested.

---

## Implementation Order

### Phase 1: `validate`
- Simplest to build (offline only, no server queries)
- High value for agents generating YAML
- Establishes the schema validation that `export` output should also pass
- **Estimated scope:** `lib/validate.sh` + `tests/validate.bats` + CLI wiring

### Phase 2: `export`
- Foundation for `diff`
- Standalone adoption value
- Most complex — needs to query every module's state
- **Estimated scope:** `lib/export.sh` + `tests/export.bats` + CLI wiring
- Can be built module-by-module (apps first, then domains, then config, etc.)

### Phase 3: `diff`
- Builds on `export`'s state-querying logic
- Comparison engine + two output formatters (summary, verbose)
- **Estimated scope:** `lib/diff.sh` + `tests/diff.bats` + CLI wiring

### Phase 4: Integration
- `diff` exit codes for CI usage
- `--app` filtering on export and diff
- Documentation updates

---

## Decisions (resolved)

1. **Export: SSL certs** → Emit `ssl: true` as a boolean marker. Can't export cert files, but preserves the signal that SSL was configured. User must re-add cert paths manually.

2. **Export: config var filtering** → Export ALL env vars. The user can filter after. Matches what the server actually has.

3. **Export: service-to-app link discovery** → Just do it (O(services × apps) queries). Typical setups have <20 apps and <10 services. Warn if it looks like it'll be slow.

4. **Diff: undeclared server state** → Only diff what's declared in YAML. If the YAML doesn't mention nginx, diff ignores server's nginx state. Prevents noise, respects "I don't care about this."

5. **Validate: unknown keys** → Warnings, not errors. Forward-compatible — new modules can add keys without breaking validation. Still flags typos visually.

6. **Config env var convergence** → Track managed keys via `DOKKU_COMPOSE_MANAGED_KEYS` stored as an app env var. No prefix required. On each run: read previous managed set, compute keys to unset (prev - desired), unset them, set desired vars, update managed set. Dokku-injected vars (`DATABASE_URL` etc.) are never in the managed set so are never touched.
