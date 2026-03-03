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

### Global Domains (`dokku.domains`)

Set the default global domains that Dokku applies to new apps. When set to `false`, global domains are disabled and cleared.

```yaml
dokku:
  domains:                      # set global domains
    - example.com
    - example.org
```

```yaml
dokku:
  domains: false                # disable + clear global domains
```

| Value | Dokku Commands |
|-------|----------------|
| `[list]` | `domains:enable --all`<br>`domains:set-global <domains...>` |
| `false` | `domains:disable --all`<br>`domains:clear-global` |
| absent | no action |
