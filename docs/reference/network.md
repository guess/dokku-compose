# Network

Dokku docs: https://dokku.com/docs/networking/network/
Module: `lib/network.sh`

## `networks` (top-level)

Create shared Docker networks. Networks are created once globally and can be attached to multiple apps.

```yaml
networks:
  - backend-net    # create this shared network
  - worker-net
```

| Value | Dokku command |
|-------|---------------|
| list of names | `network:create <name>` for each |
| absent | no action |

Networks are created idempotently — skipped if they already exist.

## `apps.<app>.networks`

Attach an app to one or more shared networks after a successful deploy (`attach-post-deploy`). This is the standard way to connect apps to each other over a shared network.

```yaml
apps:
  api:
    networks:          # list = attach; absent = no action
      - backend-net
      - worker-net
```

| Value | Dokku command |
|-------|---------------|
| list of names | `network:set <app> attach-post-deploy <space-separated list>` |
| absent | no action |

## `apps.<app>.network`

Map for additional `network:set` properties beyond `attach-post-deploy`. Each sub-key corresponds to one Dokku network property.

```yaml
apps:
  myapp:
    network:
      attach_post_create:        # list = set; false = clear; absent = no action
        - init-net
      initial_network: custom-bridge  # string = set; false = clear; absent = no action
      bind_all_interfaces: true  # true = bind 0.0.0.0; false = bind internal; absent = no action
      tld: internal              # string = set; false = clear; absent = no action
```

### `attach_post_create`

Attach to networks after the container is created but before it starts. Useful for init containers or setup hooks that need network access before the app's first request.

| Value | Dokku command |
|-------|---------------|
| list of names | `network:set <app> attach-post-create <space-separated list>` |
| `false` | `network:set <app> attach-post-create` (clear) |
| absent | no action |

### `initial_network`

Attach to a network at container creation time. This is the very first network attachment, before `attach-post-create`.

| Value | Dokku command |
|-------|---------------|
| network name | `network:set <app> initial-network <name>` |
| `false` | `network:set <app> initial-network` (clear) |
| absent | no action |

### `bind_all_interfaces`

Controls whether the app container binds to all network interfaces (`0.0.0.0`) or only the internal Docker interface. Set to `true` when you need the container directly reachable on the host's public IP without going through the proxy.

| Value | Dokku command |
|-------|---------------|
| `true` | `network:set <app> bind-all-interfaces true` |
| `false` | `network:set <app> bind-all-interfaces false` |
| absent | no action |

### `tld`

Appended to internal network aliases (e.g., `svc.cluster.local`). Useful when multiple apps on the same network need to resolve each other by a consistent hostname suffix.

| Value | Dokku command |
|-------|---------------|
| suffix string | `network:set <app> tld <suffix>` |
| `false` | `network:set <app> tld` (clear) |
| absent | no action |

## Down behaviour

`down --force` clears all declared network settings per app, then destroys the shared networks.

- Per-app: clears `attach-post-deploy` (if `networks:` was declared) and all `network:` map properties that were set.
- Global: runs `network:destroy` for each network in the top-level `networks:` list.
