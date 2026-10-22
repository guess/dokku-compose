# Domains

Dokku docs: https://dokku.com/docs/configuration/domains/

Module: `lib/domains.sh`

## YAML Keys

### App Domains (`apps.<app>.domains`)

Configure custom domains for an app. When a list is provided, vhosts are enabled and domains are set atomically. When set to `false`, vhosts are disabled and domains are cleared. When absent, no changes are made.

```yaml
apps:
  api:
    domains:                    # enable vhosts + set domains
      - api.example.com
      - www.example.com

  worker:
    domains: false              # disable vhosts + clear domains

  other:
    # domains key absent — no change to domain config
```

| Value | Dokku Commands |
|-------|----------------|
| `[list]` | `domains:enable <app>`<br>`domains:set <app> <domains...>` |
| `false` | `domains:disable <app>`<br>`domains:clear <app>` |
| absent | no action |

### Global Domains (`domains`)

Set the default global domains that Dokku applies to new apps. `up` reads `domains:report --global --domains-global-vhosts` first: the same domains (in any order) run nothing, different ones run `domains:set-global` with the declared list. When set to `false`, global domains are cleared, only if the server has any. A report that cannot be read stops `up` with an error before anything is set.

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
