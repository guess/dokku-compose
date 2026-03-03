# Module Contract & Helper Functions Design

**Date:** 2026-03-03
**Goal:** Formalize the interface every lib module follows and add generic helper functions to reduce boilerplate when implementing new namespaces.

## YAML Structure (3 Tiers)

### Tier 1 — Global Settings

Server-wide configuration under `dokku:` or standalone top-level keys.

```yaml
dokku:
  version: "0.35.12"
  plugins:
    postgres:
      url: https://github.com/dokku/dokku-postgres.git
  scheduler: docker-local
  domains:
    - example.com
  env:
    GLOBAL_KEY: value

nginx:                  # global nginx defaults
  client-max-body-size: "50m"

logs:                   # global log settings
  max-size: "10m"
  vector-sink: "..."

cron:                   # global cron settings
  mailto: "alerts@example.com"
```

### Tier 2 — Shared Resources

Top-level sections that define named resources created before apps. Apps reference them by name.

**Services** (existing):
```yaml
services:
  api-postgres:
    plugin: postgres
    version: "17-3.5"
  shared-cache:
    plugin: redis
```

**Networks** (evolving from flat list to map):
```yaml
networks:
  backend-net:                # name-only, no properties
  worker-net:
    tld: internal             # with properties
    bind_all_interfaces: true
```

Only services and networks use this pattern. Storage/volumes are per-app only (no `--global` flag in Dokku).

### Tier 3 — Per-App Configuration

Everything under `apps.<app>.*`. References shared resources by name.

```yaml
apps:
  myapp:
    # References to shared resources
    links:
      - api-postgres
      - shared-cache
    networks:
      - backend-net

    # Direct configuration (key-value maps → namespace:set)
    nginx:
      client-max-body-size: "15m"
    checks:
      wait_to_retire: 60
      attempts: 5
    ps:
      restart_policy: "on-failure:10"
    logs:
      max-size: "50m"
    registry:
      push-on-release: true

    # Lists
    ports:
      - "https:443:4000"
    domains:
      - myapp.example.com
    storage:
      - "/var/lib/dokku/data/storage/myapp/uploads:/app/uploads"

    # Scalars
    scheduler: docker-local

    # Complex / custom
    scale:
      web: 2
      worker: 1
    resources:
      limits:
        memory: "512m"
    env:
      APP_ENV: production
    docker_options:
      deploy:
        - "--shm-size 256m"
    proxy:
      enabled: true
    builder:
      selected: dockerfile
    dockerfile: docker/prod/Dockerfile
    build_dir: apps/myapp
    ssl: certs/example.com
```

## Module Contract

Every `lib/*.sh` module MUST follow this contract:

### Required Functions

```bash
ensure_app_<name>(app)     # Called during `up` per app
```

### Optional Functions

```bash
destroy_app_<name>(app)    # Called during `down` per app
ensure_<name>()            # Called during `up` globally (before apps)
ensure_global_<name>()     # Called during `up` for global settings
```

### Behavior Rules

1. **Skip if absent:** If the YAML key isn't present, return 0 immediately. Never touch state the user hasn't declared.
2. **Idempotent:** Check current state before mutating. Log "already configured" and skip if state matches.
3. **Log clearly:** Use `log_action` before the action, `log_done`/`log_skip` after.
4. **Error handling:** Let `set -euo pipefail` handle failures. Dokku command failures propagate automatically.
5. **No restart:** Use `--no-restart` where available. Restarts happen after all config is applied.

### Wire-Up Checklist

When adding a new module:
1. Create `lib/<name>.sh`
2. Add doc header with Dokku docs URL
3. Add module name to `bin/dokku-compose` line 14 module list
4. Add `ensure_app_<name>` call in `configure_app()` (in dependency order)
5. Add `destroy_app_<name>` call in `cmd_down()` if applicable
6. Add global `ensure_*` call in `cmd_up()` if applicable
7. Create `tests/<name>.bats` with tests
8. Add YAML config to `tests/fixtures/full.yml`

## Helper Functions

Added to `lib/core.sh`. Three helpers cover the three common patterns.

### dokku_set_properties — Key-Value Map

For namespaces where YAML is a map and each key-value becomes a `namespace:set` call.

```bash
# Read apps.<app>.<namespace> map, call `<namespace>:set <app> <key> <value>` for each.
# Skips if the YAML key is absent.
#
# Usage: dokku_set_properties <app> <namespace>
# Example: dokku_set_properties "myapp" "nginx"
#   Reads apps.myapp.nginx: {client-max-body-size: "15m"}
#   Calls: dokku nginx:set myapp client-max-body-size 15m
dokku_set_properties() {
    local app="$1" ns="$2"
    yaml_app_has "$app" "$ns" || return 0

    local key value
    for key in $(yaml_app_map_keys "$app" "$ns"); do
        value=$(yaml_app_map_get "$app" "$ns" "$key")
        log_action "$app" "Setting $ns $key=$value..."
        dokku_cmd "$ns:set" "$app" "$key" "$value"
        log_done
    done
}
```

**Used by:** nginx, checks (settings), ps (settings), logs, registry

### dokku_set_list — List Atomic Replace

For namespaces where YAML is a list and all items replace current state in one call.

```bash
# Read apps.<app>.<namespace> list, call `<namespace>:set <app> <items...>` to replace all.
# Skips if the YAML key is absent.
#
# Usage: dokku_set_list <app> <namespace>
# Example: dokku_set_list "myapp" "ports"
#   Reads apps.myapp.ports: ["https:443:4000"]
#   Calls: dokku ports:set myapp https:443:4000
dokku_set_list() {
    local app="$1" ns="$2"
    yaml_app_has "$app" "$ns" || return 0

    local items
    items=$(yaml_app_list "$app" "$ns" | tr '\n' ' ')
    log_action "$app" "Setting $ns..."
    dokku_cmd "$ns:set" "$app" $items
    log_done
}
```

**Used by:** ports, domains

### dokku_set_property — Single Scalar

For namespaces where YAML is a single value mapped to one `namespace:set` call.

```bash
# Read apps.<app>.<namespace>, call `<namespace>:set <app> <property> <value>`.
# Skips if the YAML key is absent.
#
# Usage: dokku_set_property <app> <namespace> <property>
# Example: dokku_set_property "myapp" "scheduler" "selected"
#   Reads apps.myapp.scheduler: "docker-local"
#   Calls: dokku scheduler:set myapp selected docker-local
dokku_set_property() {
    local app="$1" ns="$2" prop="$3"
    yaml_app_has "$app" "$ns" || return 0

    local value
    value=$(yaml_app_get "$app" "$ns")
    log_action "$app" "Setting $ns $prop=$value..."
    dokku_cmd "$ns:set" "$app" "$prop" "$value"
    log_done
}
```

**Used by:** scheduler

### dokku_property_matches — Idempotency Check

Utility for checking if a property already has the desired value.

```bash
# Check if a dokku property already matches the desired value.
# Returns 0 if it matches (caller should skip), 1 if it differs.
#
# Usage: dokku_property_matches <app> <namespace> <flag> <desired>
# Example: dokku_property_matches "myapp" "scheduler" "--scheduler-selected" "docker-local"
dokku_property_matches() {
    local app="$1" ns="$2" flag="$3" desired="$4"
    local current
    current=$(dokku_cmd_check "$ns:report" "$app" "$flag" 2>/dev/null || echo "")
    [[ "$current" == "$desired" ]]
}
```

## What Each Module Looks Like

### Simple modules (one-liner using helpers)

```bash
# lib/logs.sh — Log management
# Dokku docs: https://dokku.com/docs/deployment/logs/
# Commands: logs:*

ensure_app_logs() { dokku_set_properties "$1" "logs"; }
```

### Medium modules (helper + custom logic)

```bash
# lib/domains.sh — Domain configuration
# Dokku docs: https://dokku.com/docs/configuration/domains/
# Commands: domains:*

ensure_app_domains() {
    local app="$1"

    if ! yaml_app_has "$app" "domains"; then
        # No domains declared → disable vhosts (current default behavior)
        log_action "$app" "Disabling vhosts..."
        dokku_cmd "domains:disable" "$app"
        log_done
        return 0
    fi

    local domains
    domains=$(yaml_app_list "$app" "domains" | tr '\n' ' ')

    log_action "$app" "Setting domains $domains..."
    dokku_cmd "domains:enable" "$app"
    dokku_cmd "domains:set" "$app" $domains
    log_done
}

destroy_app_domains() {
    local app="$1"
    log_action "$app" "Clearing domains..."
    dokku_cmd "domains:clear" "$app"
    log_done
}
```

### Complex modules (fully custom, no helpers)

```bash
# lib/resource.sh — Resource limits and reservations
# Dokku docs: https://dokku.com/docs/advanced-usage/resource-management/
# Commands: resource:*

ensure_app_resources() {
    local app="$1"
    yaml_app_has "$app" "resources" || return 0

    # Default limits (no process type)
    if yaml_app_has "$app" "resources.limits"; then
        local flags=""
        for key in $(yaml_app_map_keys "$app" "resources.limits"); do
            local value=$(yaml_app_map_get "$app" "resources.limits" "$key")
            flags="$flags --$key $value"
        done
        log_action "$app" "Setting resource limits..."
        dokku_cmd "resource:limit" "$app" $flags
        log_done
    fi

    # Per-process-type overrides would follow same pattern
    # ...
}
```

## Modules vs Helpers Summary

| Namespace | Pattern | Helper | Custom? |
|-----------|---------|--------|---------|
| nginx | map | dokku_set_properties | No |
| checks (settings) | map | dokku_set_properties | No |
| ps (settings) | map | dokku_set_properties | No |
| logs | map | dokku_set_properties | No |
| registry | map | dokku_set_properties | No |
| ports | list | dokku_set_list | No |
| domains | list | — | Yes (enable/disable logic) |
| scheduler | scalar | dokku_set_property | No |
| storage | list reconcile | — | Yes (mount/unmount) |
| resource | nested map | — | Yes (per-process-type) |
| scale | map | — | Yes (web=N syntax) |
| docker_options | phased list | — | Yes (per-phase) |
| proxy | mixed | — | Yes (enable/disable + type) |
| config (env) | map | — | Yes (envsubst, --no-restart) |
| certs (ssl) | file-based | — | Yes (tar pipe) |
| builder | mixed | — | Yes (multiple sub-namespaces) |
| services | custom | — | Yes (plugin dispatch) |
| networks (global) | map | — | Yes (map-with-optional-props) |
