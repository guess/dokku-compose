# Proxy

Dokku docs: https://dokku.com/docs/networking/proxy-management/

Module: `src/resources/toggle.ts`

## YAML Keys

### Enable/Disable Proxy (`apps.<app>.proxy.enabled`)

Enable or disable the proxy. `proxy` is always a map: the shorthand `proxy: true` / `proxy: false` is rejected by `validate`.

```yaml
apps:
  api:
    proxy:
      enabled: true           # proxy:enable
      type: caddy             # proxy:set api type caddy

  worker:
    proxy:
      enabled: false          # proxy:disable
```

| Value | Dokku Commands |
|-------|----------------|
| `true` | `proxy:report <app> --proxy-enabled` (check)<br>`proxy:enable <app>` (if not already enabled) |
| `false` | `proxy:report <app> --proxy-enabled` (check)<br>`proxy:disable <app>` (if not already disabled) |
| absent | no action |

### Proxy Properties (`apps.<app>.proxy.type`, `proxy_port`, `proxy_ssl_port`)

Set the proxy implementation and the ports it listens on. Dokku 0.38.31's `proxy:set` takes `disabled` (`proxy.enabled`), `type`, `proxy-port` and `proxy-ssl-port`. Idempotent: `proxy:set` runs only when the value differs, read from `proxy:report <app>`.

```yaml
apps:
  api:
    proxy:
      type: caddy             # proxy:set api type caddy
      proxy_port: 80          # proxy:set api proxy-port 80
      proxy_ssl_port: 443     # proxy:set api proxy-ssl-port 443
```

| Value | Dokku Commands |
|-------|----------------|
| `type: <string>` (e.g. `"nginx"`, `"caddy"`, `"haproxy"`, `"traefik"`; any string is accepted) | `proxy:report <app>` (check)<br>`proxy:set <app> type <type>` (if changed) |
| `proxy_port: <port>` | `proxy:report <app>` (check)<br>`proxy:set <app> proxy-port <port>` (if changed) |
| `proxy_ssl_port: <port>` | `proxy:report <app>` (check)<br>`proxy:set <app> proxy-ssl-port <port>` (if changed) |
| absent | no action |

### Global Proxy Properties (`proxy`, top-level)

Sets Dokku's global proxy defaults, which every app without its own value inherits. Dokku accepts `type`, `proxy-port` and `proxy-ssl-port` with `--global`; `enabled` has no global form (it is per app, `proxy:enable` / `proxy:disable`), so `validate` rejects it at the top level. `up` reads `proxy:report --global --format json` and runs `proxy:set --global` only for the entries that differ; `diff` shows them under `global`. A global change reaches an app when its proxy config is next built (a deploy or `proxy:build-config`); `up` lists no restart for it.

```yaml
proxy:
  type: nginx             # proxy:set --global type nginx
  proxy_port: 80          # proxy:set --global proxy-port 80
  proxy_ssl_port: 443     # proxy:set --global proxy-ssl-port 443
```

| Value | Dokku Commands |
|-------|----------------|
| `type`, `proxy_port`, `proxy_ssl_port` | `proxy:report --global --format json` (check)<br>`proxy:set --global <key> <value>` (if changed) |
| absent | no action |

A global `type` switches every app that has no `proxy.type` of its own to that proxy, so set it deliberately. dokku-compose is tested with nginx; another proxy is yours to verify. `export` writes the server's global values as this block. A read or `--global` command that fails aborts the whole run, as every global step does.

## Removal

`proxy.enabled` has no unset: when the key is absent `up` and `diff` leave the server's proxy state alone, and the `Proxy enabled` report line is never shown as a removal. A `type` set on the server but absent from the file is a removal; `up --prune` resets it with `proxy:set <app> type`. `proxy-port` and `proxy-ssl-port` are written by Dokku on each nginx build, so they are compared only when declared and are never a removal.

### Top-level

A global key set on the server but absent from a top-level `proxy:` block that the file declares is a removal: `diff` shows it with a red `-` under `global`, `up` leaves it, and `up --prune` resets it with `proxy:set --global <key>` and no value. Unlike the per-app values, which Dokku rewrites on each nginx build, Dokku never writes a global `proxy-port` or `proxy-ssl-port` itself, so all three global keys can be removals. A file with no top-level `proxy:` block never touches the global values.
