# Plugins and Services

Dokku docs: https://dokku.com/docs/advanced-usage/plugin-management/

Modules: `lib/plugins.sh`, `lib/services.sh`

## YAML Keys

### Plugin Declaration (`plugins.<name>`)

Declare third-party Dokku plugins to install. Plugins are keyed by name — the key becomes the `--name` argument to `plugin:install`, so the installed plugin name always matches the YAML key. On each `up` run, dokku-compose checks whether the plugin is installed and at the correct version, installing or updating as needed.

```yaml
plugins:
  postgres:                                           # plugin name
    url: https://github.com/dokku/dokku-postgres.git # required
    version: "1.41.0"                                # optional: pin to tag/branch/commit

  redis:
    url: https://github.com/dokku/dokku-redis.git    # no version: always skip if installed
```

| State | Action | Dokku Command |
|-------|--------|---------------|
| Not installed, no `version` | Install | `plugin:install <url> --name <name>` |
| Not installed, `version` set | Install pinned | `plugin:install <url> --committish <version> --name <name>` |
| Installed, `version` matches | Skip | — |
| Installed, `version` differs | Update | `plugin:update <name> <version>` |
| Installed, no `version` | Skip | — |

**`url`** (required) — Git URL of the plugin repository. Supports `https://`, `git://`, `ssh://`, and `.tar.gz` archives.

**`version`** (optional) — Pin the plugin to a specific git tag, branch, or commit. When the installed version differs from the declared version, `plugin:update` is called automatically. When absent, the installed plugin is left as-is.

### Service Declaration (`services.<name>`)

Declare service instances to create. Each service has a unique name and references an installed plugin. Services are created before apps during `up`, so they are ready to be linked.

```yaml
services:
  api-postgres:
    plugin: postgres         # required: which plugin to use
    version: "17-3.5"        # optional: POSTGRES_IMAGE_VERSION
    image: postgis/postgis   # optional: POSTGRES_IMAGE (custom image)

  api-redis:
    plugin: redis

  shared-cache:
    plugin: redis            # same plugin, different instance name
```

| Key | Dokku Command |
|-----|---------------|
| `plugin` (required) | `<plugin>:create <name>` |
| `version` | `<plugin>:create <name> -I <version>` |
| `image` | `<plugin>:create <name> -i <image>` |

Service creation is idempotent — if the service already exists, it is skipped.

### Linking Services to Apps (`apps.<app>.links`)

Attach services to an app. Dokku injects the service connection URL as an environment variable when a service is linked.

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
services:
  shared-cache:
    plugin: redis

apps:
  api:
    links:
      - shared-cache
  worker:
    links:
      - shared-cache
```

Both `api` and `worker` receive the same Redis connection URL.

### Handler Services (`services.<name>.handler`)

For plugins that don't follow the standard `{plugin}:create` / `{plugin}:link` API, add a `handler:` key pointing to a shell script. Handler services are skipped by the standard create/link/destroy flow — the script manages everything instead.

```yaml
plugins:
  letsencrypt:
    url: https://github.com/dokku/dokku-letsencrypt.git

services:
  letsencrypt:
    plugin: letsencrypt
    handler: scripts/letsencrypt.sh   # path relative to dokku-compose.yml

apps:
  web:
    letsencrypt:                      # app config passed as SERVICE_CONFIG JSON
      email: admin@example.com
```

The handler script is sourced with three variables set:

| Variable | Value |
|----------|-------|
| `SERVICE_ACTION` | `up` or `down` |
| `SERVICE_APP` | the app name |
| `SERVICE_CONFIG` | JSON of the app's config block for this service |

Example handler (`scripts/letsencrypt.sh`):

```bash
#!/usr/bin/env bash
local email
email=$(echo "$SERVICE_CONFIG" | yq -r '.email')

if [[ "$SERVICE_ACTION" == "up" ]]; then
    dokku_cmd letsencrypt:set "$SERVICE_APP" email "$email"
    dokku_cmd letsencrypt:enable "$SERVICE_APP"
elif [[ "$SERVICE_ACTION" == "down" ]]; then
    dokku_cmd letsencrypt:disable "$SERVICE_APP"
fi
```

Use `dokku_cmd` (not `dokku`) inside handler scripts so that dry-run mode and test mocking work correctly.
