# Domains

Dokku docs: https://dokku.com/docs/configuration/domains/

Module: `src/resources/lists.ts` (per app), `src/modules/domains.ts` (global)

## YAML Keys

### App Domains (`apps.<app>.domains`)

Configure custom domains for an app. When a list is provided, the app's domains are made to match it (enabling vhosts first if they were disabled). When set to `false`, the app's domains are disabled. When absent, no changes are made.

```yaml
apps:
  api:
    domains:                    # make the app's domains match this list
      - api.example.com
      - www.example.com

  worker:
    domains: false              # disable vhosts (removes the app's domains)

  other:
    # domains key absent — no change to domain config
```

| Value | Dokku Commands |
|-------|----------------|
| `[list]` | enabled: `domains:remove <app> <domain>` / `domains:add <app> <domain>` for the difference only<br>disabled (or unreadable): `domains:enable <app>`, then `domains:set <app> <domains...>` |
| `false` | `domains:disable <app>`, only when enabled |
| absent | no action |

`up` reads `domains:report <app> --domains-app-enabled` first (Dokku reports `false` when `NO_VHOST=1`) and then the vhosts. An app that is already in the declared state runs nothing, and an enabled-state report that is neither `true` nor `false` stops `up` with an error rather than guessing. `domains:disable` removes the app's vhost file, so a disabled app has no domains; going back to a list runs `domains:enable` first, because enabling can write the global default vhosts, which `domains:set` then replaces. `domains:enable` restarts a deployed app (Dokku sets `NO_VHOST=0` with `config:set`, which restarts); `domains:disable`, `domains:set`, `domains:add` and `domains:remove` do not. `diff` shows a disabled app as `false` and `export` writes `domains: false` for it.

### Global Domains (`domains`)

Set the default global domains that Dokku applies to new apps. `up` reads `domains:report --global --domains-global-vhosts` first: the same domains (in any order) run nothing, different ones run `domains:set-global` with the declared list. When set to `false`, global domains are cleared, only if the server has any. A report that cannot be read stops `up` with an error before anything is set. `diff` shows a difference under its `global` section.

```yaml
domains:                        # set global domains
  - example.com
  - example.org
```

```yaml
domains: false                  # disable + clear global domains
```

| Value | Dokku Commands |
|-------|----------------|
| `[list]` | `domains:report --global --domains-global-vhosts` (check)<br>`domains:set-global <domains...>` (if different) |
| `false` | `domains:report --global --domains-global-vhosts` (check)<br>`domains:clear-global` (if any are set) |
| absent | no action |

## Removal

`up` already removes a domain on the server that is missing from a declared `domains` list, and `diff` shows it with a red `-`. A `domains` key gone from the file is left alone.
