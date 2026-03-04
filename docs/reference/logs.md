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
