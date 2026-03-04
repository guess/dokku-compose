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
| 1 | apps | apps.sh | supported | [link](https://dokku.com/docs/deployment/application-management/) |
| 2 | domains | domains.sh | partial | [link](https://dokku.com/docs/configuration/domains/) |
| 3 | config | config.sh | supported | [link](https://dokku.com/docs/configuration/environment-variables/) |
| 4 | certs | certs.sh | partial | [link](https://dokku.com/docs/configuration/ssl/) |
| 5 | network | network.sh | partial | [link](https://dokku.com/docs/networking/network/) |
| 6 | ports | ports.sh | partial | [link](https://dokku.com/docs/networking/port-management/) |
| 7 | nginx | nginx.sh | partial | [link](https://dokku.com/docs/networking/proxies/nginx/) |
| 8 | builder-* | builder.sh | partial | [link](https://dokku.com/docs/deployment/builders/builder-management/) |
| 9 | docker-options | docker_options.sh | supported | [link](https://dokku.com/docs/advanced-usage/docker-options/) |
| 10 | plugin | plugins.sh | supported | [link](https://dokku.com/docs/advanced-usage/plugin-management/) |
| 11 | version | dokku.sh | supported | [link](https://dokku.com/docs/getting-started/installation/) |
| 12 | git | git.sh | skipped | [link](https://dokku.com/docs/deployment/methods/git/) |
| 13 | proxy | proxy.sh | partial | [link](https://dokku.com/docs/networking/proxy-management/) |
| 14 | ps | — | planned | [link](https://dokku.com/docs/processes/process-management/) |
| 15 | storage | storage.sh | partial | [link](https://dokku.com/docs/advanced-usage/persistent-storage/) |
| 16 | resource | — | planned | [link](https://dokku.com/docs/advanced-usage/resource-management/) |
| 17 | registry | registry.sh | partial | [link](https://dokku.com/docs/advanced-usage/registry-management/) |
| 18 | scheduler | scheduler.sh | partial | [link](https://dokku.com/docs/deployment/schedulers/scheduler-management/) |
| 19 | checks | checks.sh | partial | [link](https://dokku.com/docs/deployment/zero-downtime-deploys/) |
| 20 | logs | logs.sh | partial | [link](https://dokku.com/docs/deployment/logs/) |
| 21 | cron | — | planned | [link](https://dokku.com/docs/processes/scheduled-cron-tasks/) |
| 22 | run | — | skipped | [link](https://dokku.com/docs/processes/one-off-tasks/) |
| 23 | repo | — | skipped | [link](https://dokku.com/docs/advanced-usage/repository-management/) |
| 24 | image | — | skipped | [link](https://dokku.com/docs/deployment/methods/image/) |
| 25 | backup | — | skipped | [link](https://dokku.com/docs/advanced-usage/backup-recovery/) |
| 26 | app-json | builder.sh | partial | [link](https://dokku.com/docs/appendices/file-formats/app-json/) |

## Statistics

- **Supported:** 5 namespaces (apps, config, docker-options, plugin, version)
- **Partial:** 13 namespaces (domains, certs, network, ports, nginx, builder-*, proxy, storage, registry, scheduler, checks, logs, app-json)
- **Planned:** 3 namespaces (ps, resource, cron)
- **Skipped:** 5 namespaces (git, run, repo, image, backup)

---

## 1. apps — Application Management

**Doc:** https://dokku.com/docs/deployment/application-management/
**Module:** `lib/apps.sh`
**Status:** supported

### Commands

| Command | Type | Supported | Notes |
|---------|------|-----------|-------|
| apps:create | declarative | yes | `ensure_app()` creates if not exists |
| apps:destroy | imperative | yes | `destroy_app()` with --force |
| apps:exists | read-only | yes | Used internally for idempotency |
| apps:list | read-only | no | Not needed for declarative config |
| apps:report | read-only | no | Could enhance `cmd_ps` |
| apps:clone | imperative | no | Runtime migration, not declarative |
| apps:rename | imperative | no | Runtime migration, not declarative |
| apps:lock | declarative | yes | `ensure_app_locked()` via `locked: true` |
| apps:unlock | declarative | yes | `ensure_app_locked()` via `locked: false` |

### YAML Keys

```yaml
apps:
  myapp:
    locked: true   # apps:lock; false = apps:unlock; absent = no action
```

### Gaps in Existing Code

None. All declarative commands are supported.

### Decision

**Supported.** Core create/destroy lifecycle is fully implemented. Lock/unlock driven by `locked:` key with tri-state behavior (true/false/absent). Vhost handling moved to `lib/domains.sh`. Imperative commands (clone, rename) are intentionally out of scope.

---

## 2. domains — Domain Configuration

**Doc:** https://dokku.com/docs/configuration/domains/
**Module:** `lib/domains.sh`
**Status:** partial

### Commands

| Command | Type | Supported | Notes |
|---------|------|-----------|-------|
| domains:add | declarative | no | Incremental; `domains:set` is used instead |
| domains:remove | declarative | no | Incremental; `domains:set` replaces all |
| domains:set | declarative | yes | `ensure_app_domains()` replaces all domains atomically |
| domains:clear | declarative | yes | `ensure_app_domains()` via `domains: false`, `destroy_app_domains()` |
| domains:enable | declarative | yes | Called when `domains:` list is present |
| domains:disable | declarative | yes | Called when `domains: false` |
| domains:report | read-only | no | Could enable idempotency checks |
| domains:add-global | declarative | no | Incremental; `domains:set-global` is used instead |
| domains:remove-global | declarative | no | Incremental; `domains:set-global` replaces all |
| domains:set-global | declarative | yes | `ensure_global_domains()` replaces all global domains |
| domains:clear-global | declarative | yes | `ensure_global_domains()` via top-level `domains: false` |

### YAML Keys

```yaml
domains:                        # top-level: list = set-global; false = clear-global; absent = no action
  - example.com

apps:
  myapp:
    domains:                    # per-app: list = enable + set; false = disable + clear; absent = no action
      - myapp.example.com
      - www.example.com
```

### Gaps in Existing Code

- No idempotency check — re-sets domains every run.

### Decision

**Partial.** Per-app domain management: `domains:set` for atomic convergence, `domains:enable`/`domains:disable` driven by value (list/false), `destroy_app_domains()` for teardown. Global domain management: `domains:set-global`/`domains:clear-global` via top-level `domains:`. Absent key = no action (consistent tri-state). Gap: no idempotency.

---

## 3. config — Environment Variables

**Doc:** https://dokku.com/docs/configuration/environment-variables/
**Module:** `lib/config.sh`
**Status:** supported

### Commands

| Command | Type | Supported | Notes |
|---------|------|-----------|-------|
| config:set | declarative | yes | `ensure_app_config()` / `ensure_global_config()` with --no-restart |
| config:unset | declarative | yes | Convergence: unsets orphaned vars matching `env_prefix` |
| config:show | read-only | no | Not needed |
| config:get | read-only | no | Not needed |
| config:keys | read-only | yes | Used internally for prefix convergence |
| config:export | read-only | no | Not needed |
| config:clear | declarative | no | Not used — `env: false` converges via `config:unset` instead |

### YAML Keys

```yaml
dokku:
  env_prefix: "MYCO_"           # default prefix is "APP_"

env:                             # top-level: global env vars
  APP_GLOBAL_KEY: value

apps:
  myapp:
    env:                         # per-app: map = set + converge; false = unset all prefixed; absent = no action
      APP_ENV: production
      APP_SECRET: "${SECRET_KEY}"
```

### Gaps in Existing Code

- No idempotency check — re-sets all vars every run (functionally harmless but noisy).

### Decision

**Supported.** App and global `config:set` with --no-restart. Only vars matching the prefix (default `APP_`) are managed — non-matching vars are warned and skipped. Orphaned prefixed vars are automatically unset. `env: false` unsets all prefixed vars. `${VAR}` references resolved via `envsubst`.

---

## 4. certs — SSL Configuration

**Doc:** https://dokku.com/docs/configuration/ssl/
**Module:** `lib/certs.sh`
**Status:** partial

### Commands

| Command | Type | Supported | Notes |
|---------|------|-----------|-------|
| certs:add | declarative | yes | Tars cert.crt + cert.key and pipes to Dokku |
| certs:update | declarative | no | Functionally similar to certs:add |
| certs:remove | declarative | no | Needed for teardown / when ssl key removed |
| certs:generate | imperative | no | Interactive self-signed cert; not declarative |
| certs:report | read-only | no | Could check if cert already installed |
| certs:show | read-only | no | Export cert; not needed |

### YAML Keys

YAML key is `certs:` (renamed from `ssl:` to match the Dokku namespace). Example: `certs: certs/example.com`.

### Gaps in Existing Code

- No idempotency: `certs:add` called every run even if cert already installed.
- No `certs:remove` / destroy counterpart. If `certs:` key removed from YAML, old cert persists.
- Dry-run logic bug: enters dry-run path when files are NOT found rather than when they are.

### Decision

**Partial.** Core `certs:add` works for the primary use case. YAML key renamed from `ssl:` to `certs:` for namespace consistency. Gaps: no idempotency, no convergence when `certs:` removed, minor dry-run bug.

---

## 5. network — Network Management

**Doc:** https://dokku.com/docs/networking/network/
**Module:** `lib/network.sh`
**Status:** partial

### Commands

| Command | Type | Supported | Notes |
|---------|------|-----------|-------|
| network:create | declarative | yes | Creates from top-level `networks:` list |
| network:destroy | imperative | no | Needed for down / --remove-orphans |
| network:exists | read-only | yes | Idempotency check before create |
| network:set | declarative | partial | Only `attach-post-deploy` implemented |
| network:rebuild | imperative | no | Runtime action |
| network:report | read-only | no | Could check network:set state |

### Missing network:set Properties

| Property | Supported | Notes |
|----------|-----------|-------|
| attach-post-deploy | yes | Set via `apps.<app>.networks` list |
| attach-post-create | no | Different attach lifecycle |
| initial-network | no | Default network at container creation |
| bind-all-interfaces | no | Disables internal proxying |
| static-web-listener | no | Exposes non-Dokku services |
| tld | no | Custom TLD suffix |

### Proposed YAML Keys

```yaml
apps:
  myapp:
    networks:                        # existing - drives attach-post-deploy
      - backend-net
    network:                         # NEW - map for other network:set properties
      attach_post_create:
        - init-net
      initial_network: custom-bridge
      bind_all_interfaces: true
      static_web_listener: "127.0.0.1:5000"
      tld: internal
```

### Gaps in Existing Code

- No `destroy_networks()` function.
- No idempotency check on `ensure_app_networks`.
- Only 1 of 6 `network:set` properties supported.

### Decision

**Partial.** Core network creation and `attach-post-deploy` work. Missing 5 of 6 `network:set` properties and teardown path.

---

## 6. ports — Port Management

**Doc:** https://dokku.com/docs/networking/port-management/
**Module:** `lib/ports.sh`
**Status:** partial

### Commands

| Command | Type | Supported | Notes |
|---------|------|-----------|-------|
| ports:set | declarative | yes | Replaces all port mappings from YAML |
| ports:report | read-only | yes | Used for idempotency check |
| ports:add | declarative | no | Incremental; ports:set is better for declarative |
| ports:remove | declarative | no | Incremental; ports:set replaces all |
| ports:clear | declarative | no | Useful for teardown |
| ports:list | read-only | no | Diagnostic only |

### Proposed YAML Keys

No new keys needed. Existing `ports: ["https:443:4000"]` works well with `ports:set` replace-all semantics.

### Gaps in Existing Code

- No `destroy_app_ports()` or `ports:clear` in down path.
- String comparison for idempotency could produce false negatives on ordering differences.

### Decision

**Partial.** Core declarative use case (set ports from YAML) is fully implemented with idempotency. Missing teardown.

---

## 7. nginx — Nginx Proxy Configuration

**Doc:** https://dokku.com/docs/networking/proxies/nginx/
**Module:** `lib/nginx.sh`
**Status:** partial

### Commands

| Command | Type | Supported | Notes |
|---------|------|-----------|-------|
| nginx:set | declarative | yes | Generic key-value passthrough from YAML map |
| nginx:report | read-only | no | Could enable idempotency checks |
| nginx:show-config | read-only | no | Diagnostic |
| nginx:validate-config | imperative | no | Could be a safety check post-config |
| nginx:access-logs | read-only | no | Log viewer |
| nginx:error-logs | read-only | no | Log viewer |
| nginx:start / stop | imperative | no | Service management |

### Proposed YAML Keys

```yaml
apps:
  myapp:
    nginx:                       # existing generic passthrough (all properties work)
      client-max-body-size: "15m"
      proxy-read-timeout: "120s"
      hsts: "true"

nginx:                           # NEW: global nginx defaults
  client-max-body-size: "50m"
```

### Gaps in Existing Code

- No idempotency check -- re-sets all nginx properties every run.
- No `--global` support for nginx defaults.
- No teardown function.
- No `proxy:build-config` trigger after changes (documented Dokku requirement).

### Decision

**Partial.** Generic passthrough design is elegant and all properties are technically accessible. Gaps: no idempotency, no global support, no teardown, missing `proxy:build-config` trigger.

---

## 8. builder-* — Builder Management

**Doc:** https://dokku.com/docs/deployment/builders/builder-management/
**Module:** `lib/builder.sh`
**Status:** partial

### Commands

| Command | Type | Supported | Notes |
|---------|------|-----------|-------|
| builder:set selected | declarative | no | Opinionated: dockerfile-only |
| builder:set build-dir | declarative | yes | Via `build.context` YAML key |
| builder-dockerfile:set dockerfile-path | declarative | yes | Via `build.dockerfile` YAML key |
| builder-herokuish:set allowed | declarative | no | Opinionated: dockerfile-only |
| builder-pack:set projecttoml-path | declarative | no | Opinionated: dockerfile-only |
| builder-nixpacks:set nixpackstoml-path | declarative | no | Opinionated: dockerfile-only |
| builder-railpack:set railpackjson-path | declarative | no | Opinionated: dockerfile-only |
| builder-lambda:set lambdayml-path | declarative | no | Opinionated: dockerfile-only |

### YAML Keys

```yaml
apps:
  myapp:
    build:                            # all build config nested here
      context: apps/myapp             # builder:set build-dir
      dockerfile: path/to/Dockerfile  # builder-dockerfile:set dockerfile-path
      app_json: docker/prod/app.json  # app-json:set appjson-path
      args:                           # docker-options:add --build-arg (convenience)
        KEY: value
```

Note: Dockerfile builder is assumed. No `selected` key — opinionated choice to keep things simple. YAML key names follow docker-compose conventions (`build.context`, `build.args`).

### Gaps in Existing Code

- `builder:set selected` not supported — opinionated dockerfile-only.
- No non-dockerfile builder support — opinionated dockerfile-only.

### Decision

**Partial.** Handles dockerfile path, app_json path, context (maps to `builder:set build-dir`), and build args. All config nested under `build:` key with docker-compose-style naming. Opinionated: assumes dockerfile builder, no `selected` key. Non-dockerfile builder settings intentionally excluded.

---

## 9. docker-options — Docker Container Options

**Doc:** https://dokku.com/docs/advanced-usage/docker-options/
**Module:** `lib/docker_options.sh`
**Status:** supported

### Commands

| Command | Type | Supported | Notes |
|---------|------|-----------|-------|
| docker-options:add | declarative | yes | Adds per-phase options after clearing |
| docker-options:remove | declarative | no | Not needed — clear+add provides convergence |
| docker-options:clear | declarative | yes | Clears phase before re-adding declared options |
| docker-options:report | read-only | no | Not needed — clear+add is idempotent |

### YAML Keys

```yaml
apps:
  myapp:
    docker_options:
      build:
        - "--no-cache"
      deploy:
        - "--shm-size 256m"
        - "-v /host/path:/container/path"
      run:
        - "--ulimit nofile=12"
```

Each declared phase is cleared then re-populated, providing idempotency and convergence. Undeclared phases are untouched.

### Gaps in Existing Code

None. Clear+add pattern provides idempotency and convergence.

### Decision

**Supported.** Declares arbitrary per-phase docker options (build, deploy, run). Each phase is atomically cleared and re-populated for idempotent convergence.

---

## 10. plugin — Plugin Management

**Doc:** https://dokku.com/docs/advanced-usage/plugin-management/
**Module:** `lib/plugins.sh`
**Status:** supported

### Commands

| Command | Type | Supported | Notes |
|---------|------|-----------|-------|
| plugin:install | declarative | yes | With `--committish` version pinning and `--name` from YAML key |
| plugin:installed | read-only | yes | Used for per-plugin presence check |
| plugin:list | read-only | yes | Used to read installed version for comparison |
| plugin:update | declarative | yes | Called when installed version differs from declared version |
| plugin:uninstall | imperative | no | Rare destructive operation |
| plugin:enable / disable | declarative | no | Niche; most users install or don't |

### Gaps in Existing Code

- No `plugin:enable`/`plugin:disable` (low priority).

### Decision

**Supported.** Full declarative lifecycle: install on first run, update when version changes, skip when current. Missing commands are either imperative or niche.

---

## 11. version — Dokku Version Management

**Doc:** https://dokku.com/docs/getting-started/installation/
**Module:** `lib/dokku.sh`
**Status:** supported

### Commands

| Command | Type | Supported | Notes |
|---------|------|-----------|-------|
| version | read-only | yes | Used by `ensure_dokku_version()` |

### Gaps in Existing Code

- `ensure_dokku_version()` only warns on mismatch, never fails. No strict enforcement option.
- `install_dokku()` is Debian/Ubuntu-only and doesn't use `dokku_cmd()` wrapper (not testable via BATS mocks).
- No automated upgrade path.

### Decision

**Supported.** Correctly implemented for its use case (pre-flight version check + fresh install).

---

## 12. git — Git Deployment

**Doc:** https://dokku.com/docs/deployment/methods/git/
**Module:** `lib/git.sh` (stub)
**Status:** skipped

### Commands

| Command | Type | Supported | Notes |
|---------|------|-----------|-------|
| git:set deploy-branch | declarative | no | Infrastructure config, but low priority |
| git:set keep-git-dir | declarative | no | Infrastructure config, but low priority |
| git:set rev-env-var | declarative | no | Infrastructure config, but low priority |
| git:sync | imperative | no | Deployment action, out of scope |
| git:from-image | imperative | no | Deployment action, out of scope |
| git:from-archive | imperative | no | Deployment action, out of scope |
| git:auth | declarative | no | Credential management, sensitive |
| git:allow-host | declarative | no | Server-level setup |

### Decision

**Skipped.** Correct architectural decision: dokku-compose handles infrastructure config, deployment is separate. The three `git:set` properties are genuinely declarative but low priority (sensible defaults, rarely changed). Could be reconsidered in a future pass.

---

## 13. proxy — Proxy Management

**Doc:** https://dokku.com/docs/networking/proxy-management/
**Module:** `lib/proxy.sh`
**Status:** partial

### Commands

| Command | Type | Supported | Notes |
|---------|------|-----------|-------|
| proxy:set | declarative | no | Set proxy implementation (nginx, caddy, etc.) |
| proxy:disable | declarative | yes | `ensure_app_proxy()` when `enabled: false` |
| proxy:enable | declarative | yes | `ensure_app_proxy()` when `enabled: true` |
| proxy:build-config | imperative | no | Required after nginx/ports changes |
| proxy:clear-config | imperative | no | Clear proxy config |
| proxy:report | read-only | no | Check proxy state |

### YAML Keys

```yaml
apps:
  myapp:
    proxy:
      enabled: true           # proxy:enable / proxy:disable

  worker-app:
    proxy:
      enabled: false          # proxy:disable -- no web traffic
```

### Gaps in Existing Code

- No `proxy:set` for selecting proxy implementation (nginx, caddy, etc.).
- No idempotency check — enables/disables every run.
- No `proxy:build-config` trigger after nginx/ports changes.

### Decision

**Partial.** Enable/disable proxy per app is implemented. Gaps: no `proxy:set` for proxy type selection, no idempotency, no `proxy:build-config` trigger.

---

## 14. ps — Process Management

**Doc:** https://dokku.com/docs/processes/process-management/
**Module:** No module exists. New: `lib/ps.sh`
**Status:** planned

### Commands

| Command | Type | Supported | Notes |
|---------|------|-----------|-------|
| ps:set restart-policy | declarative | no | Per-app restart policy |
| ps:set procfile-path | declarative | no | Custom Procfile path |
| ps:set stop-timeout-seconds | declarative | no | Stop timeout |
| ps:scale web=N worker=N | declarative | no | Process formation / scaling |
| ps:start / stop / restart / rebuild | imperative | no | Runtime actions |
| ps:report | read-only | no | Display process report |

### Proposed YAML Keys

```yaml
apps:
  myapp:
    ps:
      restart_policy: "on-failure:10"
      procfile_path: "src/Procfile"
      stop_timeout_seconds: 30
    scale:
      web: 1
      worker: 2
```

### Decision

**Planned.** `ps:scale` (process formation) and `ps:set` (restart policy, procfile path, stop timeout) are high-priority declarative settings. `scale:` kept separate from `ps:` because it uses different command syntax.

---

## 15. storage — Persistent Storage

**Doc:** https://dokku.com/docs/advanced-usage/persistent-storage/
**Module:** `lib/storage.sh`
**Status:** partial

### Commands

| Command | Type | Supported | Notes |
|---------|------|-----------|-------|
| storage:ensure-directory | declarative | no | Creates storage directory with correct ownership |
| storage:mount | declarative | yes | `ensure_app_storage()` mounts from YAML list |
| storage:unmount | declarative | yes | `destroy_app_storage()` unmounts declared volumes |
| storage:list | read-only | no | Not used (uses `storage:report` instead) |
| storage:report | read-only | yes | Used for idempotency check |

### YAML Keys

```yaml
apps:
  myapp:
    storage:
      - "/var/lib/dokku/data/storage/myapp/uploads:/app/uploads"
      - "/var/lib/dokku/data/storage/myapp/data:/app/data"
```

Note: Simplified to a flat list of mount strings (not nested `mounts:`/`ensure_directories:` as originally proposed).

### Gaps in Existing Code

- No `storage:ensure-directory` support for creating directories with correct ownership.
- No convergence for removed mounts — only declared mounts are managed.

### Decision

**Partial.** Mount and unmount implemented with idempotency (checks `storage:report` before mounting). Gaps: no `storage:ensure-directory`, no convergence for mounts removed from YAML.

---

## 16. resource — Resource Management

**Doc:** https://dokku.com/docs/advanced-usage/resource-management/
**Module:** No module exists. New: `lib/resource.sh`
**Status:** planned

### Commands

| Command | Type | Supported | Notes |
|---------|------|-----------|-------|
| resource:limit | declarative | no | CPU/memory upper bounds per process type |
| resource:limit-clear | declarative | no | Clear limits; needed for destroy |
| resource:reserve | declarative | no | CPU/memory minimum reservations |
| resource:reserve-clear | declarative | no | Clear reservations |
| resource:report | read-only | no | Current resource config |

### Proposed YAML Keys

```yaml
apps:
  myapp:
    resources:
      limits:
        cpu: 2
        memory: "512m"
      reservations:
        memory: "256m"
      web:                    # per-process-type overrides
        limits:
          cpu: 2
          memory: "1g"
```

### Decision

**Planned.** Resource limits/reservations are fully declarative and high-priority for production deployments. Nested structure mirrors Dokku's default + per-process-type granularity.

---

## 17. registry — Registry Management

**Doc:** https://dokku.com/docs/advanced-usage/registry-management/
**Module:** `lib/registry.sh`
**Status:** partial

### Commands

| Command | Type | Supported | Notes |
|---------|------|-----------|-------|
| registry:set | declarative | yes | `ensure_app_registry()` via `dokku_set_properties` helper |
| registry:login | imperative | no | Credentials; must NOT be in YAML |
| registry:logout | imperative | no | Runtime action |
| registry:report | read-only | no | Could enable idempotency |

### YAML Keys

```yaml
apps:
  myapp:
    registry:
      push-on-release: true
      image-repo: "my-prefix/myapp"
      server: "registry.example.com"
```

### Gaps in Existing Code

- No idempotency check — re-sets all properties every run.
- No global registry settings.

### Decision

**Partial.** Per-app `registry:set` properties implemented via key-value passthrough helper. Gaps: no idempotency, no global support.

---

## 18. scheduler — Scheduler Management

**Doc:** https://dokku.com/docs/deployment/schedulers/scheduler-management/
**Module:** `lib/scheduler.sh`
**Status:** partial

### Commands

| Command | Type | Supported | Notes |
|---------|------|-----------|-------|
| scheduler:set selected | declarative | yes | `ensure_app_scheduler()` via `dokku_set_property` helper |
| scheduler:report | read-only | no | Could enable idempotency |

### YAML Keys

```yaml
apps:
  myapp:
    scheduler: docker-local    # per-app override
```

### Gaps in Existing Code

- No idempotency check — re-sets every run.
- No global scheduler default (`dokku.scheduler`).

### Decision

**Partial.** Per-app scheduler selection implemented. Gaps: no idempotency, no global default.

---

## 19. checks — Zero Downtime Deploy Checks

**Doc:** https://dokku.com/docs/deployment/zero-downtime-deploys/
**Module:** `lib/checks.sh`
**Status:** partial

### Commands

| Command | Type | Supported | Notes |
|---------|------|-----------|-------|
| checks:set wait-to-retire | declarative | yes | Via `dokku_set_properties` helper |
| checks:set attempts | declarative | yes | Via `dokku_set_properties` helper |
| checks:set timeout | declarative | yes | Via `dokku_set_properties` helper |
| checks:set wait | declarative | yes | Via `dokku_set_properties` helper |
| checks:disable | declarative | no | Per-process-type disable |
| checks:enable | declarative | no | Per-process-type enable |
| checks:skip | declarative | no | Per-process-type skip |
| checks:run | imperative | no | Manual healthcheck trigger |
| checks:report | read-only | no | Could enable idempotency |

### YAML Keys

```yaml
apps:
  myapp:
    checks:
      wait-to-retire: 60
      attempts: 5
      timeout: 10
      wait: 5
```

### Gaps in Existing Code

- No idempotency check — re-sets all properties every run.
- No `checks:disable`/`checks:enable`/`checks:skip` per process type.

### Decision

**Partial.** Key-value `checks:set` properties implemented via passthrough helper. Gaps: no idempotency, no per-process-type enable/disable/skip tri-state.

---

## 20. logs — Log Management

**Doc:** https://dokku.com/docs/deployment/logs/
**Module:** `lib/logs.sh`
**Status:** partial

### Commands

| Command | Type | Supported | Notes |
|---------|------|-----------|-------|
| logs:set | declarative | yes | `ensure_app_logs()` via `dokku_set_properties` helper |
| logs:report | read-only | no | Could enable idempotency |
| logs / logs:failed | imperative | no | Log viewers |
| logs:vector-start / stop | imperative | no | Vector container management |

### YAML Keys

```yaml
apps:
  myapp:
    logs:
      max-size: "50m"
      vector-sink: "console://?encoding[codec]=json"
```

### Gaps in Existing Code

- No idempotency check — re-sets all properties every run.
- No global log settings.

### Decision

**Partial.** Per-app `logs:set` properties implemented via key-value passthrough helper. Gaps: no idempotency, no global support.

---

## 21. cron — Scheduled Cron Tasks

**Doc:** https://dokku.com/docs/processes/scheduled-cron-tasks/
**Module:** No module exists. New: `lib/cron.sh`
**Status:** planned

### Commands

| Command | Type | Supported | Notes |
|---------|------|-----------|-------|
| cron:set mailto/mailfrom | declarative | no | Global mail settings only |
| cron:report | read-only | no | Cron config |
| cron:list | read-only | no | List cron tasks (defined in app.json) |
| cron:run / suspend / resume | imperative | no | Runtime actions |

### Proposed YAML Keys

```yaml
cron:                          # global only
  mailto: "alerts@example.com"
  mailfrom: "dokku@example.com"
```

Note: Cron task definitions live in `app.json`, already supported via the existing `app_json` key. Only global mail properties are configurable via `cron:set`.

### Decision

**Planned** (minimal scope). Only global `cron:set` (mailto, mailfrom). Task definitions come from app.json.

---

## 22. run — One-off Tasks

**Doc:** https://dokku.com/docs/processes/one-off-tasks/
**Module:** Skipped
**Status:** skipped

### Commands

| Command | Type | Supported | Notes |
|---------|------|-----------|-------|
| run | imperative | no | One-off command in new container |
| run:detached | imperative | no | Detached one-off |
| run:list / logs / stop | read-only/imperative | no | Container management |

### Decision

**Skipped.** All commands are purely imperative or read-only. No persistent state to declare.

---

## 23. repo — Repository Management

**Doc:** https://dokku.com/docs/advanced-usage/repository-management/
**Module:** Skipped
**Status:** skipped

### Commands

| Command | Type | Supported | Notes |
|---------|------|-----------|-------|
| repo:gc | imperative | no | Git garbage collection |
| repo:purge-cache | imperative | no | Clear build cache |

### Decision

**Skipped.** Both are imperative maintenance operations. No declarative state to model.

---

## 24. image — Docker Image Deployment

**Doc:** https://dokku.com/docs/deployment/methods/image/
**Module:** Skipped (exclusion documented in `lib/git.sh`)
**Status:** skipped

### Commands

| Command | Type | Supported | Notes |
|---------|------|-----------|-------|
| git:from-image | imperative | no | Triggers a deploy from Docker image |

### Decision

**Skipped.** Deployment trigger, not infrastructure config. Explicitly out of scope per `lib/git.sh` design note.

---

## 25. backup — Backup and Recovery

**Doc:** https://dokku.com/docs/advanced-usage/backup-recovery/
**Module:** Skipped
**Status:** skipped

### Commands

No formal Dokku command namespace. Describes manual `tar` backup/restore procedures and `ssh-keys:*` commands.

### Decision

**Skipped.** No built-in backup commands. Manual tar procedures belong to external backup tooling, not declarative config.

---

## 26. app-json — app.json File Format

**Doc:** https://dokku.com/docs/appendices/file-formats/app-json/
**Module:** `lib/builder.sh` (embedded)
**Status:** partial

### Commands

| Command | Type | Supported | Notes |
|---------|------|-----------|-------|
| app-json:set appjson-path | declarative | yes | Via `build.app_json` YAML key |
| app-json:report | read-only | no | Could enable idempotency |

### Gaps in Existing Code

- No idempotency check: `app-json:set` called unconditionally.
- Lives inside `ensure_app_builder()` rather than its own function.
- No destroy path to clear the setting.

### Decision

**Partial.** The only CLI command that matters (`app-json:set appjson-path`) is implemented. Gap is code quality (idempotency, destroy). The app.json file contents (scripts, formation, cron) are app-level config in the repo, not dokku-compose YAML.
