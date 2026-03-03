# Environment Variables

Dokku docs: https://dokku.com/docs/configuration/environment-variables/

Module: `lib/config.sh`

## How It Works

dokku-compose only manages env vars that match a configured prefix (default `APP_`). This keeps your YAML-declared vars separate from vars injected by Dokku itself — things like `DATABASE_URL` from linked services are never touched.

When you run `up`:

1. **Set** — vars in your `env:` map are set on the app (or globally)
2. **Converge** — any existing vars matching the prefix that are *not* in your YAML are automatically unset

This means removing a var from your YAML and re-running `up` will clean it up. Vars outside the prefix are always left alone.

Values containing `${VAR}` are resolved from your shell environment at runtime via `envsubst`.

## YAML Keys

### Env Prefix (`dokku.env_prefix`)

Controls the prefix for managed env vars. Only vars starting with this prefix are set, unset, or converged.

Defaults to `"APP_"` if not configured.

```yaml
dokku:
  env_prefix: "MYCO_"          # manage vars starting with MYCO_
```

| Config | Behavior |
|--------|----------|
| Not configured | Default prefix `APP_` |
| `"CUSTOM_"` | Manage vars starting with `CUSTOM_` |

### Global Environment (`env`)

Set environment variables globally. Global vars are inherited by all apps (app-specific vars take precedence).

```yaml
env:                            # set global env vars
  APP_GLOBAL_KEY: value
  APP_ANALYTICS: enabled
```

| Value | Dokku Commands |
|-------|----------------|
| `{map}` | `config:set --global --no-restart KEY=VAL...`<br>`config:unset --no-restart --global <orphaned>...` |
| `false` | `config:unset --no-restart --global <all-prefixed-vars>...` |
| absent | no action |

### App Environment (`apps.<app>.env`)

Set environment variables for a specific app.

```yaml
apps:
  api:
    env:                        # set prefixed vars, unset orphaned prefixed vars
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
