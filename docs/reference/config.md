# Environment Variables

Dokku docs: https://dokku.com/docs/configuration/environment-variables/

Code: `src/resources/config.ts` (apps), `src/modules/config.ts` (global)

## How It Works

dokku-compose records the keys it sets in a marker app variable, `DOKKU_COMPOSE_MANAGED_KEYS` (a comma-separated list). Only keys named in the marker are ever changed or unset. Variables Dokku injects itself, such as `DATABASE_URL` from a linked service, or any variable you set by hand, are never in the marker and are left alone.

On each `up`, for an app:

1. **Read** the marker, then read the app with `config:export --format json` and keep the current values of the marked keys. JSON is used because the shell format is a single space-separated line that cannot be parsed reliably; any value (quotes, `$`, backslashes, spaces, `=`, newlines) round-trips, so an unchanged env produces no change.
2. **Unset** marked keys that are no longer in `env:`.
3. **Set** the keys in `env:` and rewrite the marker to exactly those keys.

All commands use `--no-restart`. Values containing `${VAR}` are interpolated from your shell environment when the file is loaded; there is no key prefix.

## App Environment (`apps.<app>.env`)

```yaml
apps:
  api:
    env:
      APP_ENV: production
      APP_SECRET: "${SECRET_KEY}"
```

| `env:` | Dokku commands |
|--------|----------------|
| a map | `config:unset --no-restart <app> <removed>...` (if any), then `config:set --no-restart <app> KEY=VAL... DOKKU_COMPOSE_MANAGED_KEYS=<keys>` |
| block removed, `false` or `{}` | `config:unset --no-restart <app> <every marked key>...`, then `config:unset --no-restart <app> DOKKU_COMPOSE_MANAGED_KEYS`; the marker is removed, never written empty |
| removed, and the app has no marker | no action |

Removing a key from `env:` and re-running `up` unsets it and drops it from the marker.

## Failures

- **A failed `config:unset`** is reported with the app and the masked command. The marker is not rewritten, so it still names the key and the next `up` retries.
- A failed unset also blocks new keys in that run: the `config:set` is not attempted until the unset succeeds on a later run.
- **A failed `config:export` (or output that is not a JSON object)** is an error. It is never read as "no variables", which would mark every key as new and rewrite the marker without unsetting anything.
- A failure in any other resource does not stop env from reconciling; `up` keeps going through the app's resources and exits non-zero with a summary at the end.

## Global Environment (`env`)

```yaml
env:
  APP_GLOBAL_KEY: value
```

`config:set --global KEY=VAL...`. Global variables are only set, never unset by removal, and are inherited by every app (app values take precedence). `env: false` is a no-op.
