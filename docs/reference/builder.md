# Build

Dokku docs: https://dokku.com/docs/deployment/builders/builder-management/

Module: `src/resources/builder.ts`

## YAML Keys

All build configuration lives under the `build` key per app. YAML key names follow docker-compose conventions. The Dockerfile settings (`dockerfile`, `context`, `app_json`) configure Dockerfile builds; `selected` picks the builder.

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

### Builder Selection and Cleanup (`build.selected`, `build.skip_cleanup`)

Pick the builder and skip the post-build cleanup. Dokku 0.38.31's `builder:set` takes `build-dir` (`build.context`), `selected` and `skip-cleanup`; `detected` is read-only.

```yaml
apps:
  api:
    build:
      selected: dockerfile            # builder:set api selected dockerfile
      skip_cleanup: true              # builder:set api skip-cleanup true
```

| Value | Dokku Command |
|-------|---------------|
| `selected: <builder>` | `builder:report <app>` (check)<br>`builder:set <app> selected <builder>` (if changed) |
| `skip_cleanup: true/false` | `builder:set <app> skip-cleanup <value>` (if changed) |
| absent | no action |

`selected` or `skip-cleanup` set on the server but absent from `build:` is a removal; `up --prune` resets it with `builder:set <app> <key>`.

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
| `{map}` | per entry that differs: `docker-options:add <app> build --build-arg KEY=VALUE` |
| absent | no action |

### How changes apply

`up` compares `build.args` with the server key by key and runs only what differs:

- an arg not on the server is added;
- an arg whose value changed first runs `docker-options:remove <app> build "<stored option>"` for every stored option with that key (by its exact stored text, because Dokku's `add` appends without deduplicating and `remove` compares word by word), then adds the new one;
- an unchanged arg runs no command.

A second `up` therefore changes nothing, and `diff` shows an added or changed arg. The dockerfile, app.json and context settings are likewise only set when they differ.

### Global Build Settings (`build`, top-level)

Sets Dokku's global builder defaults, which every app without its own value inherits. The keys mirror the per-app ones, except `args`: build args are docker options, which have no global form, so `validate` rejects `args` at the top level. `up` reads `builder:report`, `builder-dockerfile:report` and `app-json:report`, each with `--global --format json`, and runs `--global` only for the entries that differ; `diff` shows them under `global`.

```yaml
build:
  selected: dockerfile            # builder:set --global selected dockerfile
  context: apps/api               # builder:set --global build-dir apps/api
  skip_cleanup: true              # builder:set --global skip-cleanup true
  dockerfile: docker/Dockerfile   # builder-dockerfile:set --global dockerfile-path docker/Dockerfile
  app_json: docker/app.json       # app-json:set --global appjson-path docker/app.json
```

| Value | Dokku Command |
|-------|---------------|
| `selected` | `builder:set --global selected <builder>` (if changed) |
| `context` | `builder:set --global build-dir <path>` (if changed) |
| `skip_cleanup` | `builder:set --global skip-cleanup <value>` (if changed) |
| `dockerfile` | `builder-dockerfile:set --global dockerfile-path <path>` (if changed) |
| `app_json` | `app-json:set --global appjson-path <path>` (if changed) |
| absent | no action |

Like the per-app form, a changed `selected`, `context`, `dockerfile` or `app_json` lists every app the run processes for `dokku ps:rebuild <app>`, except an app whose own `build:` in the file declares that key. A changed `skip_cleanup` lists nothing. A global change also reaches apps that are not in the file or that this run filtered out; the summary never lists them, so rebuild those yourself. `export` writes the server's global values as this block. A read or `--global` command that fails aborts the whole run, as every global step does.

## Removal

Build args are read from the `build-list` of `docker-options:report <app> --format json` (Dokku 0.38+), which holds each stored option as Dokku keeps it. Dokku shell-splits what `docker-options:add` receives, starts a new option at every word beginning with `-`, and single-quotes words containing spaces or shell characters (`--build-arg 'KEY=a b'`). dokku-compose therefore adds each arg as `--build-arg <KEY=VALUE>` with the `KEY=VALUE` word quoted the same way, and reads the stored word back unquoted. A value containing ` --x`, `-t`, `?`, `$` or a quote is compared as written: it is not re-added on `up`, and `--prune` removes it by its stored text. Runs of spaces inside a value are kept because the word is quoted.

A build arg (a `--build-arg KEY=...` build docker option) whose KEY is not in `build.args` is a removal. `diff` shows it with a red `-` and counts it as drift, including when the whole block is gone from the file. `up` leaves it on the server and, for a block the file declares, includes it in a one-line count of leftovers it noticed; `dokku-compose diff` gives the full list, including removed blocks. `up --prune` removes it with `docker-options:remove <app> build "--build-arg KEY=VALUE"`, for exactly the stale keys; other build options are untouched.

### Top-level

A global key set on the server but absent from a top-level `build:` block that the file declares is a removal: `diff` shows it with a red `-` under `global`, `up` leaves it, and `up --prune` resets it with `builder:set --global <key>`, `builder-dockerfile:set --global dockerfile-path` or `app-json:set --global appjson-path` and no value, and lists the apps for rebuild as above. A file with no top-level `build:` block never touches the global values.
