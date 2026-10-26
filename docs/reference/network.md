# Network

Dokku docs: https://dokku.com/docs/networking/network/

Module: `src/resources/network.ts` (`networks` and `network` per app, top-level `network`), `src/modules/network.ts` (top-level `networks`)

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

## `network` (top-level)

The two top-level keys are easy to mix up: `networks:` is the list of shared networks to create, `network:` holds the global network properties. `validate` points to the right one when a list is written under `network:` or properties under `networks:`.

| Setting | Per app | Top level |
|---------|---------|-----------|
| Shared networks to create | none | `networks:` (list) |
| `attach-post-deploy` | `apps.<app>.networks` (list) | `network.attach_post_deploy` |
| `attach-post-create` | `apps.<app>.network.attach_post_create` | `network.attach_post_create` |
| `initial-network` | `apps.<app>.network.initial_network` | `network.initial_network` |
| `bind-all-interfaces` | `apps.<app>.network.bind_all_interfaces` | `network.bind_all_interfaces` |
| `tld` | `apps.<app>.network.tld` | `network.tld` |
| `static-web-listener` | `apps.<app>.network.static_web_listener` | none (Dokku has no global form) |

Sets Dokku's global network defaults, which every app without its own value inherits. It is `network` (singular), the global counterpart of `apps.<app>.network`; the plural `networks:` above is the list of shared networks to create. Dokku accepts five keys with `--global`: `attach_post_create`, `initial_network`, `bind_all_interfaces`, `tld` and `attach_post_deploy`. `static_web_listener` is per-app only and rejected at the top level by `validate`. `attach_post_deploy` is a key of the top-level `network:` only: per app it is `apps.<app>.networks`, which the plural top-level `networks:` cannot stand in for.

`up` reads `network:report --global --format json` and runs `network:set --global` only for the entries that differ; `diff` shows them under `global`. The global phase runs after the shared networks are created, so a name in `attach_post_deploy` can be one of them. The value types are the per-app ones (lists of names, strings, `bind_all_interfaces: true/false`, and `false` to clear).

```yaml
networks:
  - backend-net               # created, as above

network:
  attach_post_deploy:         # network:set --global attach-post-deploy backend-net
    - backend-net
  attach_post_create:         # network:set --global attach-post-create init-net
    - init-net
  initial_network: custom-bridge   # network:set --global initial-network custom-bridge
  bind_all_interfaces: false  # network:set --global bind-all-interfaces false
  tld: internal               # network:set --global tld internal
```

| Value | Dokku command |
|-------|---------------|
| list of names (`attach_post_create`, `attach_post_deploy`) | `network:report --global --format json` (check)<br>`network:set --global <key> <name> <name>...` (names as separate arguments, if different) |
| string (`initial_network`, `tld`) | `network:set --global <key> <value>` (if different) |
| `bind_all_interfaces: true` | `network:set --global bind-all-interfaces true` (if the server does not report `true`) |
| `bind_all_interfaces: false` | `network:set --global bind-all-interfaces false` (only if the server reports `true`; unset counts as in sync, as per app) |
| `false`, or `[]` for `attach_post_deploy` | `network:set --global <key>` (clear, if the server has a value) |
| absent | no action |

A change lists every app the run processes, except an app whose own file block declares that key, for `dokku ps:rebuild <app>` (`attach_post_create`, `initial_network`, `attach_post_deploy`) or `dokku ps:restart <app>` (`tld`, `bind_all_interfaces`), as the per-app keys do. A global change also reaches apps that are not in the file or that this run filtered out; the summary never lists them, so rebuild or restart those yourself. Every app without its own `attach_post_deploy` joins the listed networks on its next deploy, so list only networks that exist. `export` writes the server's global values as this block. A read or `--global` command that fails aborts the whole run, as every global step does.

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

`false` clears `attach_post_create`, `initial_network`, `static_web_listener` and `tld`: `network:set <app> <property>` with no value, run only when `network:report` shows a value. When the property is already unset nothing runs and `diff` is in sync. A key left out is not touched (remove it and run `up --prune` to reset it, see Removal).

```yaml
apps:
  myapp:
    network:
      attach_post_create:        # list = set; false = clear; absent = no action
        - init-net
      initial_network: custom-bridge  # string = set; false = clear; absent = no action
      bind_all_interfaces: true  # true = bind 0.0.0.0; false = bind internal; absent = no action
      static_web_listener: 127.0.0.1:5000  # string = set; false = clear; absent = no action
      tld: internal              # string = set; false = clear; absent = no action
```

### `attach_post_create`

Attach to networks after the container is created but before it starts. Useful for init containers or setup hooks that need network access before the app's first request.

| Value | Dokku command |
|-------|---------------|
| list of names | `network:set <app> attach-post-create <space-separated list>` (if different) |
| `false` | `network:set <app> attach-post-create` (clear, if the server has a value) |
| absent | no action |

### `initial_network`

Attach to a network at container creation time. This is the very first network attachment, before `attach-post-create`.

| Value | Dokku command |
|-------|---------------|
| network name | `network:set <app> initial-network <name>` (if different) |
| `false` | `network:set <app> initial-network` (clear, if the server has a value) |
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
| `host:port` string | `network:set <app> static-web-listener <value>` (if different) |
| `false` | `network:set <app> static-web-listener` (clear, if the server has a value) |
| absent | no action |

### `tld`

Appended to internal network aliases (e.g., `svc.cluster.local`). Useful when multiple apps on the same network need to resolve each other by a consistent hostname suffix.

| Value | Dokku command |
|-------|---------------|
| suffix string | `network:set <app> tld <suffix>` (if different) |
| `false` | `network:set <app> tld` (clear, if the server has a value) |
| absent | no action |

## Down behaviour

`down` does not clear any per-app network setting; destroying the app removes them. After all apps are gone, each network in the top-level `networks:` list is checked with `network:exists` and, if present, removed with `network:destroy <name> --force`. This step is skipped when app teardown failed.

## Removal

A `network` property (`attach_post_create`, `initial_network`, `bind_all_interfaces`, `static_web_listener`, `tld`) set on the server but absent from `apps.<app>.network` is a removal. `diff` shows it with a red `-` and counts it as drift, including when the whole block is gone from the file. `up` leaves it on the server and, for a block the file declares, includes it in a one-line count of leftovers it noticed; `dokku-compose diff` gives the full list, including removed blocks. `up --prune` resets it with `network:set <app> <property>` and no value (`attach-post-create`, `initial-network`, `bind-all-interfaces`, `static-web-listener`, `tld`), also for a removed block. `attach-post-deploy` belongs to `networks:`: `--prune` does not touch it and a missing `networks:` key does not clear it (that could detach a running app from its network on the next deploy); `networks: []` does.

`attach-post-deploy` belongs to `apps.<app>.networks`, so its removals are shown under `networks`, not under network properties. `web-listeners` is a read-only report line and is never shown.

Networks in `apps.<app>.networks` are replaced as a whole by `up`, so an attached network the file lacks is shown with `-` and removed by `up` when the key is present.

### Top-level

A global key set on the server but absent from a top-level `network:` block that the file declares is a removal: `diff` shows it with a red `-` under `global`, `up` leaves it, and `up --prune` resets it with `network:set --global <key>` and no value (`attach-post-create`, `initial-network`, `bind-all-interfaces`, `tld`) and lists the apps for rebuild or restart as above. `attach-post-deploy` is the exception, as it is per app: a missing `attach_post_deploy` key is not pruned (it could detach running apps from their network on the next deploy), and `attach_post_deploy: []` clears it. A file with no top-level `network:` block never touches the global values.
