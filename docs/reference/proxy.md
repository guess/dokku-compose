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

### No top-level `proxy:`

There is no top-level `proxy:` key. Dokku accepts `proxy:set --global` for `type`, `proxy-port` and `proxy-ssl-port`, but dokku-compose runs the nginx proxy only: a global `type` would move every app to another proxy, and Dokku writes each app's ports itself on every nginx build. Set them per app above, or run `dokku proxy:set --global` by hand.

## Removal

`proxy.enabled` has no unset: when the key is absent `up` and `diff` leave the server's proxy state alone, and the `Proxy enabled` report line is never shown as a removal. A `type` set on the server but absent from the file is a removal; `up --prune` resets it with `proxy:set <app> type`. `proxy-port` and `proxy-ssl-port` are written by Dokku on each nginx build, so they are compared only when declared and are never a removal.
