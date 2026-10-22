# Plugins

Dokku docs: https://dokku.com/docs/advanced-usage/plugin-management/

Module: `src/modules/plugins.ts`

## YAML Keys

### Plugin Declaration (`plugins.<name>`)

Declare third-party Dokku plugins to install. Plugins are keyed by name: the key becomes the `--name` argument to `plugin:install`, so the installed plugin name always matches the YAML key. `plugin:list --format json` is read once per `up` and `diff`.

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

**`version`** (optional) pins the plugin. Updates are forward only: dokku-compose never downgrades, so lowering a pin does nothing to a running box. Versions are compared as `major.minor.patch` numbers after removing a leading `v`; `1.2` never equals `1.2.0`. A pin of 7 to 40 hex characters is treated as a commit and compared with the start of the installed plugin's commit (`plugin:list --format json` `committish`); equal means in sync. Any other pin that does not compare is shown as unknown in `diff` (it does not make `diff` exit non-zero) and is never updated. A plugin that is installed but reports no version counts as installed.

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
| `[list]` | Link listed services, unlink any others | `<plugin>:link <service> <app> --no-restart [--alias ...] [--env-var ...] [--querystring ...]`<br>`<plugin>:unlink <service> <app> --no-restart` |
| `[]` (empty) | Unlink all services from the app | `<plugin>:unlink <service> <app> --no-restart` |
| absent | No change to links | — |

A link or unlink needs `dokku ps:restart <app>` (the service's connection variables are read at container start); `up` lists the app at the end.

An entry can also be a map, to choose the variable the URL lands in (a second database on one app needs this):

```yaml
apps:
  api:
    links:
      - api-postgres                  # DATABASE_URL, as before
      - service: reports-postgres
        alias: REPORTS                # REPORTS_URL
        querystring: "sslmode=require"
      - service: api-redis
        env_var: CACHE_CONN           # CACHE_CONN, no _URL suffix
```

| Key | Dokku flag | Effect |
|-----|------------|--------|
| `service` | | The service to link (required) |
| `alias` | `--alias` | Variable is `<alias>_URL` |
| `env_var` | `--env-var` | Variable is exactly this name; cannot be combined with `alias` (`validate` rejects it) |
| `querystring` | `--querystring` | Appended to the URL after `?` |

Both flags exist in dokku-postgres and dokku-redis 2.3.1 and 2.4.0. Unknown keys are rejected by `validate`. dokku-postgres refuses an alias (or env var name) whose variable is already set on the app, so when the options of a linked service change, `up` unlinks and then links it (both with `--no-restart`; the app needs a restart to pick up the new variable).

`:links` and `:app-links` print names only, so `diff` finds the link's variable in the app's env by its URL host (`dokku-<plugin>-<service>`) and compares its name and querystring with the entry; a plain entry means `DATABASE_URL` or `REDIS_URL`, or the `DOKKU_<PLUGIN>_<COLOR>_URL` name the plugin falls back to when that one is taken (a second link of the same plugin), with no querystring. A variable of the same name that points elsewhere (set by `env:` or by hand) does not count. A difference shows as `~ links:<service>` (sensitive querystring values are masked) and `up` unlinks then links it; if the link fails after the unlink, `up` warns that the app is now unlinked. A declared service that is not linked shows as `+ links:<service>`. If the env cannot be read, or no variable points at the service, `diff` prints a warning and does not count it as drift. `export` writes the object form when the variable or querystring is not the default.

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
