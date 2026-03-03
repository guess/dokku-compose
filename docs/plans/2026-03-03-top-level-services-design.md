# Top-level Services Design (v0.2)

## Problem

Services (postgres, redis, etc.) are declared inline under each app. This means:
- Each app always gets its own service instance — no sharing between apps
- Service lifecycle is coupled to the app
- No clear way to reconcile removed services on subsequent `up` runs

## Design

### YAML Format Change (Breaking)

**Before (v0.1) — inline services:**
```yaml
apps:
  api:
    postgres:
      version: "17-3.5"
      image: postgis/postgis
    redis: true
```

**After (v0.2) — top-level services with links:**
```yaml
services:
  api-postgres:
    plugin: postgres
    version: "17-3.5"
    image: postgis/postgis
  api-redis:
    plugin: redis
  shared-cache:
    plugin: redis

apps:
  api:
    links:
      - api-postgres
      - api-redis
  worker:
    links:
      - shared-cache
```

### Concepts

- **Plugins** (`dokku.plugins`) — install the Dokku plugin binaries
- **Services** (`services`) — create named instances using a plugin
- **Links** (`apps.*.links`) — connect an app to a service via `{plugin}:link`

### `links:` Semantic

| YAML state | Behavior |
|------------|----------|
| `links:` present with values | Link listed services, unlink any others linked to this app |
| `links:` present but empty | Unlink all services from this app |
| `links:` key absent | Skip — don't touch service links |

### Execution Order for `up`

1. Version check
2. Plugins (install/update)
3. Networks (create)
4. **Services (create instances)** — moved before apps
5. Per-app: create app → **links** → ports → certs → nginx → env → builder

Services are created before apps because apps link to them.

### Flags

- `--remove-orphans` — destroy service instances that exist in Dokku but aren't declared in `services:`. Without this flag, orphaned services are warned about but not destroyed.

### `down --force`

Unchanged behavior: destroy apps, unlink and destroy all declared services.

## What Changes

- `lib/services.sh` — rewrite to read from top-level `services:` and handle link reconciliation
- `lib/yaml.sh` — add helpers for reading top-level `services:` section
- `bin/dokku-compose` — update execution order (services before apps)
- `tests/services.bats` — rewrite tests for new format
- `tests/fixtures/*.yml` — update fixtures
- `dokku-compose.yml.example` — update to new format
- `README.md` — update documentation

## What Stays the Same

All other features keep current additive behavior: env, ports, nginx, certs, builder, networks.

## Future Considerations

Reconciliation for other features (env, nginx, builder, etc.) was considered but deferred. The additive-only behavior for these features is safer given the complexity of env var sources (service-injected vars, manual configuration, deploy hooks). Can be revisited per-feature if users request it.
