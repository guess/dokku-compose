# Postgres

Dokku docs: https://dokku.com/docs/community/plugins/#official-plugins-beta

Module: `src/modules/postgres.ts`

## YAML Keys

### Service Declaration (`postgres.<name>`)

Declare Postgres service instances. Services are created before apps during `up`, so they are ready to be linked.

```yaml
postgres:
  api-db:                              # service name
    version: "17-3.5"                  # optional: image version
    image: postgis/postgis             # optional: custom Docker image

  other-db: {}                         # defaults: standard postgres image, latest version
```

| Key | Dokku Flag |
|-----|------------|
| `version` | `postgres:create <name> --image-version <version>` |
| `image` | `postgres:create <name> --image <image>` |

Service creation is idempotent — if the service already exists, it is skipped.

### Automated Backups (`postgres.<name>.backup`)

Configure S3-compatible automated backups for a Postgres service. Backup configuration is applied idempotently using a content hash — it only re-runs when the config changes.

```yaml
postgres:
  api-db:
    version: "17-3.5"
    backup:
      schedule: "0 * * * *"                          # cron schedule
      bucket: "db-backups/api-db"                     # S3 bucket/path
      auth:
        access_key_id: "${R2_ACCESS_KEY_ID}"
        secret_access_key: "${R2_SECRET_ACCESS_KEY}"
        region: "auto"
        signature_version: "s3v4"
        endpoint: "${R2_SCHEME}://${R2_HOST}"
```

| Key | Dokku Command |
|-----|---------------|
| `backup.auth.*` | `postgres:backup-auth <name> <key> <secret> <region> <sig_version> <endpoint>` |
| `backup.schedule` + `backup.bucket` | `postgres:backup-schedule <name> <schedule> <bucket>` |

All `backup.auth` fields are required when backup is configured.

### Export

### Changing `version` or `image` later

`up` creates a service with them and never changes an existing one: an upgrade can need a dump and downtime, so run `postgres:upgrade` yourself. When the declared value differs from `postgres:info <name> --format json` (`image-version`, `image`), `up` logs one warning per field with both values, and `diff` shows `~ version` or `~ image` and exits non-zero. A field the file does not declare never drifts; a declared `image: postgres` equals the default.

`dokku-compose export` discovers Postgres services by querying `postgres:list` and `postgres:info` on the server. Custom images (e.g., `postgis/postgis`) are included when they differ from the default `postgres` image.
