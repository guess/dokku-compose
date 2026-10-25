# SSL Certificates

Dokku docs: https://dokku.com/docs/configuration/ssl/

Module: `src/resources/certs.ts`

## YAML Keys

### App SSL (`apps.<app>.ssl`)

Add, replace or remove SSL certificates for an app. When set to a map with `certfile` and `keyfile`, `up` reads the installed certificate with `certs:show <app> crt` and compares it with `certfile` (trailing whitespace ignored): the same certificate runs nothing, a different one runs `certs:update`, and an app with no certificate gets `certs:add`. The key is never read or printed. `ssl: true` (what `export` writes for an installed certificate) runs no command: it only counts as in sync when a certificate is installed, so `diff` reports a missing one. When set to `false`, the certificate is removed. When absent, no changes are made.

```yaml
apps:
  api:
    ssl:                              # add cert from files
      certfile: certs/example.com/fullchain.pem
      keyfile: certs/example.com/privkey.pem

  worker:
    ssl: false                        # remove SSL certificate

  other:
    # ssl key absent — no change to SSL config
```

| Value | Dokku Commands |
|-------|----------------|
| `{certfile, keyfile}` | `certs:report <app> --ssl-enabled`, then `certs:show <app> crt` (check)<br>`certs:add <app> <certfile> <keyfile>` (no certificate)<br>`certs:update <app> <certfile> <keyfile>` (a different certificate) |
| `true` | `certs:report <app> --ssl-enabled`, then `certs:show <app> crt` (check only) |
| `false` | `certs:report <app> --ssl-enabled` (check)<br>`certs:remove <app>` (if currently enabled) |
| absent | no action |

Both `certfile` and `keyfile` are required, and `certfile` must be readable where dokku-compose runs, since it is compared with the server's certificate. The same two paths are passed to `certs:add` / `certs:update`, which Dokku reads on the Dokku host, so with `DOKKU_HOST` set they must exist on both machines. `certs:show` failing with "doesn't have an SSL endpoint" means no certificate is installed. A certificate that cannot be read is unknown: `diff` shows `?` and `up` stops that step with an error rather than adding a certificate over it.

`diff` shows a replaced `certfile` as `~ ssl` with the server side as `(certificate installed)`; the certificate text is never printed.
