# Nginx

Dokku docs: https://dokku.com/docs/networking/proxies/nginx/
Module: `src/resources/properties.ts` (per app), `src/modules/nginx.ts` (global)

Configure Nginx proxy settings for apps and globally. Each entry is passed to `nginx:set`; only the properties `nginx:set` accepts are allowed.

## `apps.<app>.nginx`

Sets per-app Nginx properties. `up` reads `nginx:report <app>` and runs `nginx:set <app>` only for the entries that differ, then `proxy:build-config <app>` once (a failure on an app that was never deployed is only a warning). Only the 31 properties `nginx:set` accepts in Dokku 0.38.31 pass `validate`, including `nginx-conf-sigil-path` and `nginx-service-command`; any other key is rejected. The same keys are valid at the top level.

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
| map of `key: value` pairs | `nginx:set <app> <key> <value>` for each entry that differs<br>`proxy:build-config <app>` (after any change) |
| absent | no action |

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

### Top-level

A global key set on the server but absent from a top-level `nginx:` block that the file declares is a removal: `diff` shows it with a red `-` under `global`, `up` leaves it, and `up --prune` resets it with `nginx:set --global <key>` and no value. A file with no top-level `nginx:` block never touches the global values. `export` writes the server's global values as this block. A read or `--global` command that fails aborts the whole run.
