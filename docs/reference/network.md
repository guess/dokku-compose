# Network

Dokku docs: https://dokku.com/docs/networking/network/

Module: `src/resources/network.ts` (`networks` and `network` per app), `src/modules/network.ts` (top-level `networks`)

## `networks` (top-level)

Create shared Docker networks. Networks are created once globally and can be attached to multiple apps.

```yaml
networks:
  - backend-net    # create this shared network
  - worker-net
```

| Value | Dokku command |
|-------|---------------|
| list of names | `network:exists <name>` (check)<br>`network:create <name>` (if missing) |
| absent | no action |

`diff` checks each one with `network:exists` and shows a missing network as `+ <name>: not created` under `networks:`.

## `apps.<app>.networks`

> A change to `networks`, `attach_post_create` or `initial_network` needs a deploy or rebuild to apply (Dokku network docs); `up` lists the app as needing `dokku ps:rebuild <app>`. `tld` and `bind_all_interfaces` list `dokku ps:restart <app>`.

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
| list of names | `network:report <app> --network-attach-post-deploy` (check)<br>`network:set <app> attach-post-deploy <space-separated list>` (if different) |
| `[]` | `network:set <app> attach-post-deploy` (clear, if any are attached) |
| absent | no action |

## `apps.<app>.network`

Map for additional `network:set` properties beyond `attach-post-deploy`. Each sub-key corresponds to one Dokku network property. Only declared keys are compared with `network:report <app>`, and `network:set` runs only for those that differ.

`false` is accepted for `attach_post_create`, `initial_network`, `static_web_listener` and `tld` but runs no command; to reset a property, remove the key and run `up --prune` (see Removal).

```yaml
apps:
  myapp:
    network:
      attach_post_create:        # list = set; absent = no action
        - init-net
      initial_network: custom-bridge  # string = set; absent = no action
      bind_all_interfaces: true  # true = bind 0.0.0.0; false = bind internal; absent = no action
      static_web_listener: 127.0.0.1:5000  # string = set; absent = no action
      tld: internal              # string = set; absent = no action
```

### `attach_post_create`

Attach to networks after the container is created but before it starts. Useful for init containers or setup hooks that need network access before the app's first request.

| Value | Dokku command |
|-------|---------------|
| list of names | `network:set <app> attach-post-create <space-separated list>` |
| absent | no action |

### `initial_network`

Attach to a network at container creation time. This is the very first network attachment, before `attach-post-create`.

| Value | Dokku command |
|-------|---------------|
| network name | `network:set <app> initial-network <name>` |
| absent | no action |

### `bind_all_interfaces`

Controls whether the app container binds to all network interfaces (`0.0.0.0`) or only the internal Docker interface. Set to `true` when you need the container directly reachable on the host's public IP without going through the proxy.

| Value | Dokku command |
|-------|---------------|
| `true` | `network:set <app> bind-all-interfaces true` |
| `false` | `network:set <app> bind-all-interfaces false` (whenever the server does not report `true`) |
| absent | no action |

### `static_web_listener`

| Value | Dokku command |
|-------|---------------|
| `host:port` string | `network:set <app> static-web-listener <value>` |
| absent | no action |

### `tld`

Appended to internal network aliases (e.g., `svc.cluster.local`). Useful when multiple apps on the same network need to resolve each other by a consistent hostname suffix.

| Value | Dokku command |
|-------|---------------|
| suffix string | `network:set <app> tld <suffix>` |
| absent | no action |

## Down behaviour

`down` does not clear any per-app network setting; destroying the app removes them. After all apps are gone, each network in the top-level `networks:` list is checked with `network:exists` and, if present, removed with `network:destroy <name> --force`. This step is skipped when app teardown failed.

## Removal

A `network` property (`attach_post_create`, `initial_network`, `bind_all_interfaces`, `static_web_listener`, `tld`) set on the server but absent from `apps.<app>.network` is a removal. `diff` shows it with a red `-` and counts it as drift, including when the whole block is gone from the file. `up` leaves it on the server and, for a block the file declares, includes it in a one-line count of leftovers it noticed; `dokku-compose diff` gives the full list, including removed blocks. `up --prune` resets it with `network:set <app> <property>` and no value (`attach-post-create`, `initial-network`, `bind-all-interfaces`, `static-web-listener`, `tld`), also for a removed block. `attach-post-deploy` belongs to `networks:`: `--prune` does not touch it and a missing `networks:` key does not clear it (that could detach a running app from its network on the next deploy); `networks: []` does.

`attach-post-deploy` belongs to `apps.<app>.networks`, so its removals are shown under `networks`, not under network properties. `web-listeners` is a read-only report line and is never shown.

Networks in `apps.<app>.networks` are replaced as a whole by `up`, so an attached network the file lacks is shown with `-` and removed by `up` when the key is present.
