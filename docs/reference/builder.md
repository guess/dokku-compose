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

## Removal

Build args are read from the `build-list` of `docker-options:report <app> --format json` (Dokku 0.38+), which holds each stored option as Dokku keeps it. Dokku shell-splits what `docker-options:add` receives, starts a new option at every word beginning with `-`, and single-quotes words containing spaces or shell characters (`--build-arg 'KEY=a b'`). dokku-compose therefore adds each arg as `--build-arg <KEY=VALUE>` with the `KEY=VALUE` word quoted the same way, and reads the stored word back unquoted. A value containing ` --x`, `-t`, `?`, `$` or a quote is compared as written: it is not re-added on `up`, and `--prune` removes it by its stored text. Runs of spaces inside a value are kept because the word is quoted.

A build arg (a `--build-arg KEY=...` build docker option) whose KEY is not in `build.args` is a removal. `diff` shows it with a red `-` and counts it as drift, including when the whole block is gone from the file. `up` leaves it on the server and, for a block the file declares, includes it in a one-line count of leftovers it noticed; `dokku-compose diff` gives the full list, including removed blocks. `up --prune` removes it with `docker-options:remove <app> build "--build-arg KEY=VALUE"`, for exactly the stale keys; other build options are untouched.
