# Environment Variables

Dokku docs: https://dokku.com/docs/configuration/environment-variables/

Module: `lib/config.sh`

## YAML Keys

### App Environment (`apps.<app>.env`)

Set environment variables for an app. Values containing `${VAR}` are resolved from your shell environment at runtime via `envsubst`.

```yaml
apps:
  api:
    env:                        # set env vars
      APP_ENV: production
      APP_SECRET: "${SECRET_KEY}"

  worker:
    env: {}                     # unset all prefixed vars, set nothing

  legacy:
    env: false                  # clear ALL env vars (config:clear)

  other:
    # env key absent — no change
```

| Value | Dokku Commands |
|-------|----------------|
| `{map}` | `config:set --no-restart <app> KEY=VAL...`<br>Converge: `config:unset --no-restart <app> <orphaned>...` |
| `{}` | `config:unset --no-restart <app> <orphaned-prefixed-vars>...` |
| `false` | `config:clear --no-restart <app>` |
| absent | no action |

### Global Environment (`dokku.env`)

Set environment variables globally. Global vars are inherited by all apps (app-specific vars take precedence).

```yaml
dokku:
  env:                          # set global env vars
    APP_GLOBAL_KEY: value
    APP_ANALYTICS: enabled
```

| Value | Dokku Commands |
|-------|----------------|
| `{map}` | `config:set --global --no-restart KEY=VAL...`<br>Converge: `config:unset --no-restart --global <orphaned>...` |
| `{}` | `config:unset --no-restart --global <orphaned-prefixed-vars>...` |
| `false` | `config:clear --global --no-restart` |
| absent | no action |

### Env Prefix (`dokku.env_prefix` / `apps.<app>.env_prefix`)

Controls which env vars are safe to unset during convergence. When a prefix is set, any existing Dokku env var that matches the prefix but is not in the YAML will be unset. Vars that don't match the prefix (like `DATABASE_URL` injected by service links) are never touched.

Defaults to `"APP_"` if not configured.

```yaml
dokku:
  env_prefix: "MYCO_"          # global default prefix

apps:
  api:
    # inherits MYCO_ from dokku.env_prefix

  worker:
    env_prefix: "WORKER_"      # per-app override

  legacy:
    env_prefix: false           # disable convergence — set only, never unset
```

| Config | Behavior |
|--------|----------|
| Not configured | Default prefix `APP_` — converge vars starting with `APP_` |
| `"CUSTOM_"` | Converge vars starting with `CUSTOM_` |
| `false` | Disable convergence — set vars only, never unset |

Priority: per-app `env_prefix` > global `dokku.env_prefix` > default `"APP_"`.
