# Ports

Dokku docs: https://dokku.com/docs/networking/port-management/

Module: `lib/ports.sh`

## YAML Keys

### Port Mappings (`apps.<app>.ports`)

Set the port mappings for an app. Each mapping follows the format `SCHEME:HOST_PORT:CONTAINER_PORT`. When a list is provided, all mappings are set atomically (replacing any existing ones). When absent, no changes are made.

Comparison against current state is order-insensitive — if the same mappings are already set in any order, the command is skipped.

```yaml
apps:
  api:
    ports:                      # set all port mappings
      - "https:443:4000"
      - "http:80:5000"

  worker:
    # ports key absent — no change to port mappings
```

| Value | Dokku Command |
|-------|---------------|
| `[list]` | `ports:set <app> <mappings...>` |
| absent | no action |

Supported schemes: `http`, `https`, `grpc`, `grpcs`.

On `down --force`, port mappings are cleared before the app is destroyed:

| Phase | Dokku Command |
|-------|---------------|
| down | `ports:clear <app>` |
