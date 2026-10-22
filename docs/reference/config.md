# Environment Variables

Dokku docs: https://dokku.com/docs/configuration/environment-variables/

Code: `src/resources/config.ts` (apps), `src/modules/config.ts` (global)

## How It Works

dokku-compose records the keys it sets in a marker app variable, `DOKKU_COMPOSE_MANAGED_KEYS` (a comma-separated list). Only keys named in the marker are ever changed or unset. Variables Dokku injects itself, such as `DATABASE_URL` from a linked service, or any variable you set by hand, are never in the marker and are left alone.

On each `up`, for an app:

1. **Read** the marker, then read the app with `config:export --format json` and keep the current values of the marked keys. JSON is used because the shell format is a single space-separated line that cannot be parsed reliably; any value (quotes, `$`, backslashes, spaces, `=`, newlines) round-trips, so an unchanged env produces no change.
2. **Unset** marked keys that are no longer in `env:`.
3. **Set** the keys in `env:` and rewrite the marker to exactly those keys.

All commands use `--no-restart`, so the app needs `dokku ps:restart <app>`; `up` lists it at the end (the top-level `env:` lists every app). Values containing `${VAR}` are interpolated from your shell environment when the file is loaded; there is no key prefix.

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

**Limit:** only keys named in the marker are unset. dokku-compose 0.12 and earlier rewrote the marker on every run to just the keys still in the YAML, so a key removed from the YAML under those versions dropped out of the marker without being unset. Nothing can tell such an orphan from a key set by hand, so unset those once yourself (`dokku config:unset --no-restart <app> KEY`). Keys removed from the YAML under 0.13 or later are cleaned up normally.

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

Global variables are inherited by every app (app values take precedence). `up` reads them with `config:export --global --format json` and converges them like app env, with its own marker, `DOKKU_COMPOSE_GLOBAL_MANAGED_KEYS` (separate from the app marker because Dokku merges global env into every app's containers):

- A key whose value differs, or that is missing, is set with `config:set --global`; an unchanged key is not set again.
- A key the marker lists that the file no longer declares is unset with `config:unset --global`, on every `up`.
- A box with no marker yet unsets nothing on its first run; that run only writes the marker.
- An empty `env: {}`, or no `env:` block at all, unsets every marked key and drops the marker; with no marker on the box it does nothing. `env: false` leaves global env alone.
- Only marker-listed keys are ever unset: keys set by hand, `DOKKU_COMPOSE_BACKUP_HASH_*` and the markers themselves are never touched.

`config:set --global` and `config:unset --global` never restart an app (Dokku's config plugin skips the restart for `--global`), so no `--no-restart` is passed. A container reads global env only when it starts, so when `up` sets or unsets a global key it lists every app the run processes in its restart summary; an unchanged run lists none.

`diff` shows global env drift under `global / env` by key name only: values are always masked as `****`, a removed key is shown as `- KEY (not in the file)`, and the marker is never listed as a user key.

## Removal

A managed key removed from `env:` is unset by `up` (also when `env:` is gone), and `diff` shows it with a red `-` and counts it as drift. Keys outside `DOKKU_COMPOSE_MANAGED_KEYS` are never shown or touched.
