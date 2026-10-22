# Proxy

Dokku docs: https://dokku.com/docs/networking/proxy-management/

Module: `lib/proxy.sh`

## YAML Keys

### Enable/Disable Proxy — Shorthand (`apps.<app>.proxy: true/false`)

Enable or disable the proxy for an app using the shorthand form. This is the simplest way to control proxy state when you don't need to set the proxy type.

```yaml
apps:
  api:
    proxy: true               # proxy:enable

  worker:
    proxy: false              # proxy:disable — no web traffic
```

| Value | Dokku Commands |
|-------|----------------|
| `true` | `proxy:report <app> --proxy-enabled` (check)<br>`proxy:enable <app>` (if not already enabled) |
| `false` | `proxy:report <app> --proxy-enabled` (check)<br>`proxy:disable <app>` (if not already disabled) |
| absent | no action |

### Enable/Disable Proxy — Map Form (`apps.<app>.proxy.enabled`)

Enable or disable the proxy using the map form. Use this when you also want to configure `proxy.type` on the same app.

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
      type: caddy             # proxy:set api caddy
```

| Value | Dokku Commands |
|-------|----------------|
| `type: "nginx"` / `"caddy"` / `"haproxy"` / `"traefik"` | `proxy:report <app>` (check)<br>`proxy:set <app> type <type>` (if changed) |
| `proxy_port: <port>` | `proxy:set <app> proxy-port <port>` (if changed) |
| `proxy_ssl_port: <port>` | `proxy:set <app> proxy-ssl-port <port>` (if changed) |
| absent | no action |

## Removal

`proxy.enabled` has no unset: when the key is absent `up` and `diff` leave the server's proxy state alone, and the `Proxy enabled` report line is never shown as a removal. A `type` set on the server but absent from the file is a removal; `up --prune` resets it with `proxy:set <app> type`. `proxy-port` and `proxy-ssl-port` are written by Dokku on each nginx build, so they are compared only when declared and are never a removal.
