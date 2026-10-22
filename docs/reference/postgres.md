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

Configure S3-compatible automated backups for a Postgres service. `up` and `diff` read the server's backup settings from `postgres:info <name> --format json` (the same read as the version check, one per service) and run only what differs.

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
| `backup.schedule` (with `backup.bucket`) | `postgres:backup-schedule <name> <schedule> <bucket>` |
| `backup.bucket` alone | `postgres:set <name> backup-bucket <bucket>` |
| `backup: false` | `postgres:backup-unschedule <name>`, then `postgres:backup-deauth <name>` |

All `backup.auth` fields are required when backup is configured.

How each setting is compared:

- **Credentials**: the server reports `backup-auth-fingerprint`, the sha256 of the stored access key id and secret joined by one newline (`printf '%s\n%s' "$id" "$secret" | sha256sum`). dokku-compose computes the same from the file and runs `:backup-auth` only when it, `backup-default-region`, `backup-signature-version` or `backup-endpoint-url` differs, so a rotated key is picked up on the next `up`. Credentials are never printed: `diff` says only which of them differ, and the dry-run listing masks them.
- **Schedule**: `backup-schedule` against `backup.schedule`. A change runs `:backup-schedule` (which also writes the bucket), and `up` then checks with `:backup-schedule-cat` that the cron entry landed.
- **Bucket**: `backup-bucket` (the full `bucket/prefix`) against `backup.bucket`. A change alone runs `postgres:set <name> backup-bucket`, with no re-auth.
- **Removal**: only `backup: false` removes a backup. With `backup:` absent, `diff` shows a backup found on the server as a note (not drift), `up` leaves it, and `up --prune` only warns. `up` never runs `:backup-deauth` before `:backup-auth`: deauth deletes the service's whole backup directory.
- **Encryption** (`:backup-set-encryption`, `:backup-set-public-key-encryption`) is out of scope: dokku-compose neither sets nor compares it.

Needs dokku-postgres 2.3.1 or later (the `backup-*` keys in `postgres:info --format json`).

Earlier versions tracked backups as a hash in the global env var `DOKKU_COMPOSE_BACKUP_HASH_<SERVICE>`. `up` unsets every such key once (`config:unset --global --no-restart`, which restarts no app), and `diff` lists them under `global / backup_hash` until it has.

### Export

### Changing `version` or `image` later

`up` creates a service with them and never changes an existing one: an upgrade can need a dump and downtime, so run `postgres:upgrade` yourself. When the declared value differs from `postgres:info <name> --format json` (`image-version`, `image`), `up` logs one warning per service with both values of each field, and `diff` shows `~ version` or `~ image` and exits non-zero. A field the file does not declare never drifts; a declared `image: postgres` equals the default.

`dokku-compose export` discovers Postgres services by querying `postgres:list` and `postgres:info` on the server. Custom images (e.g., `postgis/postgis`) are included when they differ from the default `postgres` image.
