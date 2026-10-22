# Nginx

Dokku docs: https://dokku.com/docs/networking/proxies/nginx/
Module: `lib/nginx.sh`

Configure Nginx proxy settings for apps and globally. All standard `nginx:set` properties are supported via a map passthrough — no fixed list of allowed keys.

## `apps.<app>.nginx`

Sets per-app Nginx properties. Each key-value pair maps to a `nginx:set <app>` call. Any property supported by `dokku nginx:set` can be used.

```yaml
apps:
  myapp:
    nginx:
      client-max-body-size: "15m"   # nginx:set myapp client-max-body-size 15m
      proxy-read-timeout: "120s"    # nginx:set myapp proxy-read-timeout 120s
      hsts: "true"                  # nginx:set myapp hsts true
```

| Value | Dokku command |
|-------|---------------|
| map of `key: value` pairs | `nginx:set <app> <key> <value>` for each entry |
| absent | no action |

On `down`: each configured property is reset to Dokku's default via `nginx:set <app> <key>` with an empty value.

## `nginx` (top-level)

Sets global Nginx defaults that apply to all apps unless overridden per-app. `up` reads `nginx:report --global --format json` first and runs `nginx:set --global` only for the values that differ; `diff` shows them under a `global` section.

```yaml
nginx:
  client-max-body-size: "50m"   # nginx:set --global client-max-body-size 50m
  hsts: "true"                  # nginx:set --global hsts true
```

| Value | Dokku command |
|-------|---------------|
| map of `key: value` pairs | `nginx:report --global --format json` (check)<br>`nginx:set --global <key> <value>` for each entry that differs |
| absent | no action |

Value precedence follows Dokku's hierarchy: app-specific → global → Dokku default.

## Removal

A property set on the server but absent from `apps.<app>.nginx` is a removal. `diff` shows it with a red `-` and counts it as drift, including when the whole block is gone from the file. Only the settable nginx properties are considered, never read-only report lines. `up` leaves it on the server and, for a block the file declares, includes it in a one-line count of leftovers it noticed; `dokku-compose diff` gives the full list, including removed blocks. `up --prune` resets it with `nginx:set <app> <key>` and no value, then rebuilds the proxy config, also for a removed block.
