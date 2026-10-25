# Ports

Dokku docs: https://dokku.com/docs/networking/port-management/

Module: `src/resources/lists.ts`

## YAML Keys

A port change is live: `ports:set` rebuilds the nginx config, so `up` does not list the app as needing a restart.

### Port Mappings (`apps.<app>.ports`)

Set the port mappings for an app. Each mapping follows the format `SCHEME:HOST_PORT:CONTAINER_PORT`. When a list is provided and differs from the server, all mappings are set at once (replacing any existing ones). When absent, no changes are made.

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
| `[list]` | `ports:report <app> --ports-map` (check)<br>`ports:set <app> <mappings...>` (if different) |
| absent | no action |

`validate` accepts the schemes `http`, `https`, `tcp` and `udp`; `grpc` and `grpcs` are rejected.

`down` does not clear port mappings; destroying the app removes them.

## Removal

`up` already removes a port mapping on the server that is missing from a declared `ports` list, and `diff` shows it with a red `-`. A `ports` key gone from the file is left alone.
