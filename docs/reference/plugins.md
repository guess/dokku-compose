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

### Postgres Services (`postgres.<name>`)

Declare Postgres service instances to create. Each service has a unique name. Services are created before apps during `up`, so they are ready to be linked.

```yaml
postgres:
  api-postgres:
    version: "17-3.5"        # optional: POSTGRES_IMAGE_VERSION
    image: postgis/postgis   # optional: POSTGRES_IMAGE (custom image)
    backup:                  # optional: automated backup config
      schedule: "0 * * * *"
      bucket: "db-backups/api-postgres"
      auth:
        access_key_id: "${R2_ACCESS_KEY_ID}"
        secret_access_key: "${R2_SECRET_ACCESS_KEY}"
        region: "auto"
        signature_version: "s3v4"
        endpoint: "${R2_SCHEME}://${R2_HOST}"
```

| Key | Dokku Command |
|-----|---------------|
| `version` | `postgres:create <name> -I <version>` |
| `image` | `postgres:create <name> -i <image>` |
| `backup.schedule` | `postgres:backup-schedule-cat <name>` |
| `backup.bucket` | `postgres:backup-set-bucket <name> <bucket>` |
| `backup.auth.*` | `postgres:backup-auth <name> ...` |

Service creation is idempotent — if the service already exists, it is skipped.

### Redis Services (`redis.<name>`)

Declare Redis service instances to create. Each service has a unique name. Services are created before apps during `up`, so they are ready to be linked.

```yaml
redis:
  api-redis: {}              # default version

  shared-cache:
    version: "7.2-alpine"   # optional: REDIS_IMAGE_VERSION
```

| Key | Dokku Command |
|-----|---------------|
| `version` | `redis:create <name> -I <version>` |

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
