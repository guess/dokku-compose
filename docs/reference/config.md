# Environment Variables

Dokku docs: https://dokku.com/docs/configuration/environment-variables/

Module: `lib/config.sh`

## YAML Keys

### App Environment (`apps.<app>.env`)

Set environment variables for an app. Only vars matching the configured prefix (default `APP_`) are managed — non-matching vars are warned and skipped. Values containing `${VAR}` are resolved from your shell environment at runtime via `envsubst`.

```yaml
apps:
  api:
    env:                        # set env vars, unset orphaned prefixed vars
      APP_ENV: production
      APP_SECRET: "${SECRET_KEY}"

  legacy:
    env: false                  # unset all prefixed vars

  other:
    # env key absent — no change
```

| Value | Dokku Commands |
|-------|----------------|
| `{map}` | `config:set --no-restart <app> KEY=VAL...`<br>`config:unset --no-restart <app> <orphaned>...` |
| `false` | `config:unset --no-restart <app> <all-prefixed-vars>...` |
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
| `{map}` | `config:set --global --no-restart KEY=VAL...`<br>`config:unset --no-restart --global <orphaned>...` |
| `false` | `config:unset --no-restart --global <all-prefixed-vars>...` |
| absent | no action |

### Env Prefix (`dokku.env_prefix`)

Controls which env vars dokku-compose manages. Only vars matching this prefix are set, unset, or converged. Vars that don't match the prefix (like `DATABASE_URL` injected by service links) are never touched.

Defaults to `"APP_"` if not configured.

```yaml
dokku:
  env_prefix: "MYCO_"          # manage vars starting with MYCO_
```

| Config | Behavior |
|--------|----------|
| Not configured | Default prefix `APP_` |
| `"CUSTOM_"` | Manage vars starting with `CUSTOM_` |
