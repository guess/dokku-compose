# Logs

Dokku docs: https://dokku.com/docs/deployment/logs/

Module: `lib/logs.sh`

## YAML Keys

### Global Log Settings (`logs`)

Set global log defaults that apply to all apps unless overridden per-app.

```yaml
logs:                                           # set global log defaults
  max-size: "50m"
  vector-image: "timberio/vector:0.36.0-alpine"
  vector-sink: "console://?encoding[codec]=json"
  app-label-alias: "app"
```

| Value | Dokku Command |
|-------|---------------|
| `{map}` | `logs:set --global <key> <value>` per entry |
| absent | no action |

### App Log Settings (`apps.<app>.logs`)

Configure logging properties for a specific app.

```yaml
apps:
  api:
    logs:                                       # set per-app log properties
      max-size: "10m"
      vector-sink: "file://?path=/tmp/api.log"

  other:
    # logs key absent — no change
```

| Value | Dokku Command |
|-------|---------------|
| `{map}` | `logs:set <app> <key> <value>` per entry |
| absent | no action |

### Supported Properties

| Property | Scope | Description |
|----------|-------|-------------|
| `max-size` | global + per-app | Docker log retention size (default: `10m`) |
| `vector-sink` | global + per-app | Log sink destination in DSN format |
| `vector-image` | global only | Vector container image version |
| `app-label-alias` | global + per-app | Label name for the app identifier |
| `vector-cron-sink` | global + per-app | Log sink for cron task output |

## Removal

A property set on the server but absent from `apps.<app>.logs` (`app-label-alias`, `max-size`, `vector-cron-sink`, `vector-sink`) is a removal. `diff` shows it with a red `-` and counts it as drift, including when the whole block is gone from the file. `up` leaves it on the server and, for a block the file declares, includes it in a one-line count of leftovers it noticed; `dokku-compose diff` gives the full list, including removed blocks. `--prune` (coming next) will remove it. A `registry` property (`auth-servers`, `image-repo`, `image-repo-template`, `push-extra-tags`, `push-on-release`, `server`; `tag-version` is read-only) or a `scheduler` selected on the server but absent from the file is treated the same way.
