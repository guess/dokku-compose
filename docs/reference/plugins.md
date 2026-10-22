# Plugins

Dokku docs: https://dokku.com/docs/advanced-usage/plugin-management/

Module: `src/modules/plugins.ts`

## YAML Keys

### Plugin Declaration (`plugins.<name>`)

Declare third-party Dokku plugins to install. Plugins are keyed by name: the key becomes the `--name` argument to `plugin:install`, so the installed plugin name always matches the YAML key. `plugin:list` is read once per `up` and `diff`.

```yaml
plugins:
  postgres:                                           # plugin name
    url: https://github.com/dokku/dokku-postgres.git # required
    version: "1.41.0"                                # optional: pin (a leading "v" is ignored when comparing)

  redis:
    url: https://github.com/dokku/dokku-redis.git    # no version: installed if missing, otherwise left alone
```

| State | `up` | Dokku Command |
|-------|------|---------------|
| Not installed, no `version` | Install | `plugin:install <url> --name <name>` |
| Not installed, `version` set | Install at the pin | `plugin:install <url> --committish <version> --name <name>` |
| Installed, same version | No action | none |
| Installed, older than `version` | Update | `plugin:update <name> <version>` |
| Installed, newer than `version` | Warn, no change (never downgrades) | none |
| Installed, version cannot be compared | Warn, no change | none |
| Installed, no `version` | No action | none |

`diff` lists a missing plugin, an older one and a newer one as drift, and an uncomparable one as unknown.

**`url`** (required) is the Git URL of the plugin repository.

**`version`** (optional) pins the plugin. Updates are forward only: dokku-compose never downgrades, so lowering a pin does nothing to a running box. Versions are compared as `major.minor.patch` numbers after removing a leading `v`. Anything else (a commit SHA, a branch name) matches only when it is the identical string, otherwise it is reported as unknown and never updated.

`plugin:list` reports the version in the plugin's `plugin.toml`, not the git commit. A matching pin therefore means the same version string, not necessarily the same commit. Plugins are never uninstalled.

### Linking Services to Apps (`apps.<app>.links`)

Attach postgres or redis services to an app. Dokku injects the service connection URL as an environment variable when a service is linked. Service names reference entries from the top-level `postgres:` or `redis:` keys.

```yaml
apps:
  api:
    links:                  # link these services
      - api-postgres
      - api-redis
      - shared-cache

  worker:
    links:
      - shared-cache

  other:
    links: []               # unlink all services

  bare:
    # links key absent — no change to links
```

| Value | Behavior | Dokku Commands |
|-------|----------|----------------|
| `[list]` | Link listed services, unlink any others | `<plugin>:link <service> <app> --no-restart`<br>`<plugin>:unlink <service> <app> --no-restart` |
| `[]` (empty) | Unlink all services from the app | `<plugin>:unlink <service> <app> --no-restart` |
| absent | No change to links | — |

Because reconciliation is declarative, removing a service from `links:` and re-running `up` will unlink it automatically.

### Shared Services

Because services are named independently from apps, multiple apps can link to the same service instance:

```yaml
redis:
  shared-cache: {}

apps:
  api:
    links:
      - shared-cache
  worker:
    links:
      - shared-cache
```

Both `api` and `worker` receive the same Redis connection URL.
