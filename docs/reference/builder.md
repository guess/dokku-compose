# Build

Dokku docs: https://dokku.com/docs/deployment/builders/builder-management/

Module: `lib/builder.sh`

## YAML Keys

All build configuration lives under the `build` key per app. YAML key names follow docker-compose conventions. Only Dockerfile builds are supported.

### Build Context (`build.context`)

Set the build directory within the repository (useful for monorepos). Maps to Dokku's `build-dir` property.

```yaml
apps:
  api:
    build:
      context: apps/api               # build from a subdirectory
```

| Value | Dokku Command |
|-------|---------------|
| `<path>` | `builder:set <app> build-dir <path>` |
| absent | no action |

### Dockerfile Path (`build.dockerfile`)

Set a custom Dockerfile path relative to the build context.

```yaml
apps:
  api:
    build:
      dockerfile: docker/prod/Dockerfile
```

| Value | Dokku Command |
|-------|---------------|
| `<path>` | `builder-dockerfile:set <app> dockerfile-path <path>` |
| absent | no action (defaults to `Dockerfile`) |

### app.json Path (`build.app_json`)

Set a custom path to the app.json file for deploy scripts, formation, and cron configuration.

```yaml
apps:
  api:
    build:
      app_json: docker/prod/app.json
```

| Value | Dokku Command |
|-------|---------------|
| `<path>` | `app-json:set <app> appjson-path <path>` |
| absent | no action |

### Build Args (`build.args`)

Pass build-time arguments to Docker. Values support `${ENV_VAR}` interpolation from the host environment.

```yaml
apps:
  api:
    build:
      args:
        SENTRY_AUTH_TOKEN: "${SENTRY_AUTH_TOKEN}"
        NODE_ENV: production
```

| Value | Dokku Command |
|-------|---------------|
| `{map}` | `docker-options:add <app> build --build-arg KEY=VALUE` (per entry) |
| absent | no action |
