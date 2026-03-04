# SSL Certificates

Dokku docs: https://dokku.com/docs/configuration/ssl/

Module: `lib/certs.sh`

## YAML Keys

### App SSL (`apps.<app>.ssl`)

Add or remove SSL certificates for an app. When set to a map with `certfile` and `keyfile`, the files are tarred as `server.crt`/`server.key` and added to Dokku (skipped if SSL is already enabled). When set to `false`, the certificate is removed. When absent, no changes are made.

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
| `{certfile, keyfile}` | `certs:report <app> --ssl-enabled` (check)<br>`certs:add <app>` (if not already enabled) |
| `false` | `certs:report <app> --ssl-enabled` (check)<br>`certs:remove <app>` (if currently enabled) |
| absent | no action |

Both `certfile` and `keyfile` are required. In `--dry-run` mode, file existence is not checked so you can preview without having certs locally.
