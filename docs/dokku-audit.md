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
| 1 | apps | apps.sh | partial | [link](https://dokku.com/docs/deployment/application-management/) |
| 2 | domains | — | planned | [link](https://dokku.com/docs/configuration/domains/) |
| 3 | config | config.sh | partial | [link](https://dokku.com/docs/configuration/environment-variables/) |
| 4 | certs | certs.sh | partial | [link](https://dokku.com/docs/configuration/ssl/) |
| 5 | network | network.sh | partial | [link](https://dokku.com/docs/networking/network/) |
| 6 | ports | ports.sh | partial | [link](https://dokku.com/docs/networking/port-management/) |
| 7 | nginx | nginx.sh | partial | [link](https://dokku.com/docs/networking/proxies/nginx/) |
| 8 | builder-* | builder.sh | partial | [link](https://dokku.com/docs/deployment/builders/builder-management/) |
| 9 | docker-options | builder.sh | partial | [link](https://dokku.com/docs/advanced-usage/docker-options/) |
| 10 | plugin | plugins.sh | supported | [link](https://dokku.com/docs/advanced-usage/plugin-management/) |
| 11 | version | dokku.sh | supported | [link](https://dokku.com/docs/getting-started/installation/) |
| 12 | git | git.sh | skipped | [link](https://dokku.com/docs/deployment/methods/git/) |
| 13 | proxy | — | planned | [link](https://dokku.com/docs/networking/proxy-management/) |
| 14 | ps | — | planned | [link](https://dokku.com/docs/processes/process-management/) |
| 15 | storage | — | planned | [link](https://dokku.com/docs/advanced-usage/persistent-storage/) |
| 16 | resource | — | planned | [link](https://dokku.com/docs/advanced-usage/resource-management/) |
| 17 | registry | — | planned | [link](https://dokku.com/docs/advanced-usage/registry-management/) |
| 18 | scheduler | — | planned | [link](https://dokku.com/docs/deployment/schedulers/scheduler-management/) |
| 19 | checks | — | planned | [link](https://dokku.com/docs/deployment/zero-downtime-deploys/) |
| 20 | logs | — | planned | [link](https://dokku.com/docs/deployment/logs/) |
| 21 | cron | — | planned | [link](https://dokku.com/docs/processes/scheduled-cron-tasks/) |
| 22 | run | — | skipped | [link](https://dokku.com/docs/processes/one-off-tasks/) |
| 23 | repo | — | skipped | [link](https://dokku.com/docs/advanced-usage/repository-management/) |
| 24 | image | — | skipped | [link](https://dokku.com/docs/deployment/methods/image/) |
| 25 | backup | — | skipped | [link](https://dokku.com/docs/advanced-usage/backup-recovery/) |
| 26 | app-json | builder.sh | partial | [link](https://dokku.com/docs/appendices/file-formats/app-json/) |

## Statistics

- **Supported:** 2 namespaces (plugin, version)
- **Partial:** 9 namespaces (apps, config, certs, network, ports, nginx, builder-*, docker-options, app-json)
- **Planned:** 10 namespaces (domains, proxy, ps, storage, resource, registry, scheduler, checks, logs, cron)
- **Skipped:** 5 namespaces (git, run, repo, image, backup)

---

## 1. apps — Application Management

**Doc:** https://dokku.com/docs/deployment/application-management/
**Module:** `lib/apps.sh`
**Status:** partial

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
| apps:lock | declarative | no | Could prevent deploys; niche |
| apps:unlock | declarative | no | Counterpart to lock |

### Proposed YAML Keys

```yaml
apps:
  myapp:
    locked: true   # apps:lock; false/absent = apps:unlock
```

### Gaps in Existing Code

- `ensure_vhosts_disabled()` is called unconditionally -- no YAML key controls whether vhosts should be enabled or disabled. Should be driven by whether the app has `domains:` defined.
- No idempotency check on `ensure_vhosts_disabled()` -- runs `domains:disable` every time.
- `apps:lock`/`apps:unlock` not supported (low priority).

### Decision

**Partial.** Core create/destroy lifecycle is fully implemented. Main gap is hardcoded vhost disable (should be driven by domains config). Imperative commands (clone, rename) are intentionally out of scope.

---

## 2. domains — Domain Configuration

**Doc:** https://dokku.com/docs/configuration/domains/
**Module:** No dedicated module (only `domains:disable` in `lib/apps.sh`)
**Status:** planned

### Commands

| Command | Type | Supported | Notes |
|---------|------|-----------|-------|
| domains:add | declarative | no | Add custom domains to app |
| domains:remove | declarative | no | Remove specific domains |
| domains:set | declarative | no | Replace all domains atomically -- ideal for declarative use |
| domains:clear | declarative | no | Remove all custom domains |
| domains:enable | declarative | no | Enable VHOST/domain routing |
| domains:disable | declarative | partial | Called unconditionally in apps.sh |
| domains:report | read-only | no | Useful for idempotency |
| domains:add-global | declarative | no | Global domain config |
| domains:remove-global | declarative | no | Global domain removal |
| domains:set-global | declarative | no | Replace all global domains |
| domains:clear-global | declarative | no | Clear global domains |

### Proposed YAML Keys

```yaml
apps:
  myapp:
    domains:
      - myapp.example.com
      - www.example.com

dokku:
  domains:
    - example.com
```

Use `domains:set` (not add/remove) for atomic convergence. If `domains:` is present and non-empty, call `domains:enable` then `domains:set`. If absent, call `domains:disable`.

### Gaps in Existing Code

- No `lib/domains.sh` module exists. All domain handling is a single `domains:disable` call.
- No ability to declare custom domains per app -- users must manually run `dokku domains:add`.
- No global domain management.
- No destroy counterpart for domains.

### Decision

**Planned.** One of the most important missing namespaces. Custom domains are fundamental to Dokku app configuration. Create `lib/domains.sh` with `ensure_app_domains(app)` and `destroy_app_domains(app)`, using `domains:set` for atomic convergence. Replace `ensure_vhosts_disabled()` in apps.sh.

---

## 3. config — Environment Variables

**Doc:** https://dokku.com/docs/configuration/environment-variables/
**Module:** `lib/config.sh`
**Status:** partial

### Commands

| Command | Type | Supported | Notes |
|---------|------|-----------|-------|
| config:set | declarative | yes | `ensure_app_config()` sets all vars with --no-restart |
| config:unset | declarative | no | Needed to remove vars no longer in YAML |
| config:show | read-only | no | Could be used for idempotency |
| config:get | read-only | no | Per-key idempotency check |
| config:keys | read-only | no | Detect stale keys for unset |
| config:export | read-only | no | Not needed |
| config:clear | declarative | no | Nuclear option; unset per-key is safer |

### Proposed YAML Keys

```yaml
apps:
  myapp:
    env:                    # existing, well-designed
      APP_ENV: production
      SECRET_KEY: "${SECRET_KEY}"

dokku:
  env:                      # NEW: global env vars
    GLOBAL_KEY: value
```

### Gaps in Existing Code

- No idempotency: re-sets all vars every run (functionally harmless but noisy).
- No `config:unset` for removed keys -- stale env vars persist. Requires care to distinguish user-declared vars from Dokku-managed vars (e.g., service-injected `DATABASE_URL`).
- No global env support (`dokku.env`).
- No destroy counterpart (low priority -- env destroyed with app).

### Decision

**Partial.** Core `config:set` works. Two gaps: (1) no idempotency check, (2) no convergence for removed keys. Adding `config:unset` for orphaned keys requires distinguishing user vs Dokku-managed vars.

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

### Proposed YAML Keys

Rename `ssl:` → `certs:` to match the Dokku namespace. Example: `certs: certs/example.com`.

### Gaps in Existing Code

- No idempotency: `certs:add` called every run even if cert already installed.
- No `certs:remove` / destroy counterpart. If `certs:` key removed from YAML, old cert persists.
- Dry-run logic bug: enters dry-run path when files are NOT found rather than when they are.

### Decision

**Partial.** Core `certs:add` works for the primary use case. Gaps: no idempotency, no convergence when `certs:` removed, minor dry-run bug. Rename `ssl:` → `certs:` for namespace consistency.

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
| builder:set selected | declarative | no | Choose builder type (critical gap) |
| builder:set build-dir | declarative | partial | Implemented via workaround (--build-arg APP_PATH) |
| builder-dockerfile:set dockerfile-path | declarative | yes | Via `dockerfile` YAML key |
| builder-herokuish:set allowed | declarative | no | Force-enable herokuish |
| builder-pack:set projecttoml-path | declarative | no | CNB project.toml path |
| builder-nixpacks:set nixpackstoml-path | declarative | no | Nixpacks config path |
| builder-railpack:set railpackjson-path | declarative | no | Railpack config path |
| builder-lambda:set lambdayml-path | declarative | no | Lambda config path |

### Proposed YAML Keys

```yaml
apps:
  myapp:
    builder:                          # all build config nested here
      dockerfile: path/to/Dockerfile  # builder-dockerfile:set dockerfile-path
      build_dir: apps/myapp           # builder:set build-dir
      build_args:                     # docker-options:add --build-arg (convenience)
        KEY: value
      app_json: docker/prod/app.json  # app-json:set appjson-path
```

Note: Dockerfile builder is assumed. No `selected` key — opinionated choice to keep things simple.

### Gaps in Existing Code

- `builder:set selected` not supported -- users cannot declaratively choose builder type.
- `build_dir` implemented via `docker-options:add --build-arg APP_PATH=` workaround instead of native `builder:set build-dir`.
- No non-dockerfile builder support.
- No idempotency checks.

### Decision

**Partial.** Handles dockerfile path, app_json path, build_dir (via workaround), and build_args. Missing `builder:set selected` (most important builder command) and all non-dockerfile builder settings.

---

## 9. docker-options — Docker Container Options

**Doc:** https://dokku.com/docs/advanced-usage/docker-options/
**Module:** `lib/builder.sh` (embedded)
**Status:** partial

### Commands

| Command | Type | Supported | Notes |
|---------|------|-----------|-------|
| docker-options:add | declarative | partial | Only build phase --build-arg internally |
| docker-options:remove | declarative | no | Not implemented |
| docker-options:clear | imperative | no | Not implemented |
| docker-options:report | read-only | no | Not implemented |

### Proposed YAML Keys

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

### Gaps in Existing Code

- Only used internally for `--build-arg` in build phase. No user-facing docker options.
- No deploy or run phase support -- common production needs (volumes, ulimits, shm-size).
- No dedicated module; logic scattered in `lib/builder.sh`.

### Decision

**Partial.** `docker-options:add` is used but only as implementation detail for build args. Users cannot declare arbitrary per-phase docker options. High-value addition for production workloads.

---

## 10. plugin — Plugin Management

**Doc:** https://dokku.com/docs/advanced-usage/plugin-management/
**Module:** `lib/plugins.sh`
**Status:** supported

### Commands

| Command | Type | Supported | Notes |
|---------|------|-----------|-------|
| plugin:install | declarative | yes | With optional --committish version pinning |
| plugin:list | read-only | yes | Used for idempotency check |
| plugin:update | imperative | no | Intentionally omitted; re-run with new version |
| plugin:uninstall | imperative | no | Rare destructive operation |
| plugin:enable / disable | declarative | no | Niche; most users install or don't |

### Gaps in Existing Code

- Minor: could use `plugin:installed` instead of grepping `plugin:list` for cleaner check.
- No `plugin:enable`/`plugin:disable` (low priority).

### Decision

**Supported.** Covers the primary declarative use case with proper idempotency. Missing commands are either imperative or niche.

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
**Module:** No module exists
**Status:** planned

### Commands

| Command | Type | Supported | Notes |
|---------|------|-----------|-------|
| proxy:set | declarative | no | Set proxy implementation (nginx, caddy, etc.) |
| proxy:disable | declarative | no | Disable proxy for worker apps |
| proxy:enable | declarative | no | Re-enable proxy |
| proxy:build-config | imperative | no | Required after nginx/ports changes |
| proxy:clear-config | imperative | no | Clear proxy config |
| proxy:report | read-only | no | Check proxy state |

### Proposed YAML Keys

```yaml
apps:
  myapp:
    proxy:
      type: nginx             # proxy:set (default: nginx)
      enabled: true           # proxy:enable / proxy:disable

  worker-app:
    proxy:
      enabled: false          # proxy:disable -- no web traffic
```

### Decision

**Planned.** Two critical findings: (1) `proxy:build-config` should be called after nginx/ports changes (current bug), (2) `proxy:disable` is essential for worker-only apps. `proxy:set` matters for alternative proxy implementations.

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
**Module:** No module exists. New: `lib/storage.sh`
**Status:** planned

### Commands

| Command | Type | Supported | Notes |
|---------|------|-----------|-------|
| storage:ensure-directory | declarative | no | Creates storage directory with correct ownership |
| storage:mount | declarative | no | Creates bind mount for deploy+run |
| storage:unmount | declarative | no | Removes bind mount; needed for convergence |
| storage:list | read-only | no | Current mounts; useful for idempotency |
| storage:report | read-only | no | Mount report per phase |

### Proposed YAML Keys

```yaml
apps:
  myapp:
    storage:
      mounts:
        - "/var/lib/dokku/data/storage/myapp/uploads:/app/uploads"
        - "/var/lib/dokku/data/storage/myapp/data:/app/data"
      ensure_directories:
        - name: "myapp/uploads"
          chown: herokuish       # herokuish | heroku | paketo
```

### Decision

**Planned.** Storage mounts are fully declarative. `storage:mount`/`storage:unmount` map cleanly to ensure/destroy pattern. `storage:list` provides idempotency checks.

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
**Module:** No module exists. New: `lib/registry.sh`
**Status:** planned

### Commands

| Command | Type | Supported | Notes |
|---------|------|-----------|-------|
| registry:set | declarative | no | push-on-release, image-repo, server, push-extra-tags |
| registry:login | imperative | no | Credentials; must NOT be in YAML |
| registry:logout | imperative | no | Runtime action |
| registry:report | read-only | no | Current registry config |

### Proposed YAML Keys

```yaml
apps:
  myapp:
    registry:
      push-on-release: true
      image-repo: "my-prefix/myapp"
      server: "registry.example.com"

registry:                          # global settings
  image-repo-template: "my-prefix/{{ .AppName }}"
  server: "registry.example.com"
```

### Decision

**Planned.** `registry:set` properties are declarative. Same key-value pattern as `nginx:set`. Deliberately excludes `registry:login` (credentials).

---

## 18. scheduler — Scheduler Management

**Doc:** https://dokku.com/docs/deployment/schedulers/scheduler-management/
**Module:** No module exists. New: `lib/scheduler.sh`
**Status:** planned

### Commands

| Command | Type | Supported | Notes |
|---------|------|-----------|-------|
| scheduler:set selected | declarative | no | Pick scheduler (docker-local, k3s, null) |
| scheduler:report | read-only | no | Current scheduler config |

### Proposed YAML Keys

```yaml
dokku:
  scheduler: docker-local      # global default

apps:
  myapp:
    scheduler: docker-local    # per-app override
```

### Decision

**Planned.** Low priority -- most users use default docker-local. Main use case is k3s or null scheduler.

---

## 19. checks — Zero Downtime Deploy Checks

**Doc:** https://dokku.com/docs/deployment/zero-downtime-deploys/
**Module:** No module exists. New: `lib/checks.sh`
**Status:** planned

### Commands

| Command | Type | Supported | Notes |
|---------|------|-----------|-------|
| checks:set wait-to-retire | declarative | no | Grace period for old containers |
| checks:set attempts | declarative | no | Healthcheck retry count |
| checks:set timeout | declarative | no | Healthcheck timeout |
| checks:set wait | declarative | no | Wait between attempts |
| checks:disable | declarative | no | Disable zero-downtime (causes brief downtime) |
| checks:enable | declarative | no | Re-enable zero-downtime |
| checks:skip | declarative | no | Skip checks entirely (fastest, riskiest) |
| checks:run | imperative | no | Manual healthcheck trigger |
| checks:report | read-only | no | Current checks config |

### Proposed YAML Keys

```yaml
apps:
  myapp:
    checks:
      wait_to_retire: 60
      attempts: 5
      timeout: 10
      wait: 5
      processes:              # per-process-type: enabled/disabled/skipped
        web: enabled
        worker: skipped
```

### Decision

**Planned.** High priority for production. The disable/skip/enable tri-state per process type needs clean modeling. `checks:set` properties are straightforward key-value.

---

## 20. logs — Log Management

**Doc:** https://dokku.com/docs/deployment/logs/
**Module:** No module exists. New: `lib/logs.sh`
**Status:** planned

### Commands

| Command | Type | Supported | Notes |
|---------|------|-----------|-------|
| logs:set | declarative | no | max-size, vector-sink, vector-image |
| logs:report | read-only | no | Current log config |
| logs / logs:failed | imperative | no | Log viewers |
| logs:vector-start / stop | imperative | no | Vector container management |

### Proposed YAML Keys

```yaml
apps:
  myapp:
    logs:
      max-size: "50m"
      vector-sink: "console://?encoding[codec]=json"

logs:                          # global settings
  max-size: "10m"
  vector-sink: "datadog_logs://..."
  vector-image: "timberio/vector:0.38.0-debian"
```

### Decision

**Planned.** `logs:set` properties are declarative. Same key-value pattern as nginx/registry. Vector integration is the main use case.

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
| app-json:set appjson-path | declarative | yes | Via `app_json` YAML key |
| app-json:report | read-only | no | Could enable idempotency |

### Gaps in Existing Code

- No idempotency check: `app-json:set` called unconditionally.
- Lives inside `ensure_app_builder()` rather than its own function.
- No destroy path to clear the setting.

### Decision

**Partial.** The only CLI command that matters (`app-json:set appjson-path`) is implemented. Gap is code quality (idempotency, destroy). The app.json file contents (scripts, formation, cron) are app-level config in the repo, not dokku-compose YAML.
