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
      type: caddy             # proxy:set api caddy

  worker:
    proxy:
      enabled: false          # proxy:disable
```

| Value | Dokku Commands |
|-------|----------------|
| `true` | `proxy:report <app> --proxy-enabled` (check)<br>`proxy:enable <app>` (if not already enabled) |
| `false` | `proxy:report <app> --proxy-enabled` (check)<br>`proxy:disable <app>` (if not already disabled) |
| absent | no action |

### Proxy Type (`apps.<app>.proxy.type`)

Set the proxy implementation for an app. Dokku supports nginx (default), caddy, haproxy, and traefik. Idempotent — only calls `proxy:set` if the current type differs.

```yaml
apps:
  api:
    proxy:
      type: caddy             # proxy:set api caddy
```

| Value | Dokku Commands |
|-------|----------------|
| `"nginx"` / `"caddy"` / `"haproxy"` / `"traefik"` | `proxy:report <app> --proxy-type` (check)<br>`proxy:set <app> <type>` (if changed) |
| absent | no action |
