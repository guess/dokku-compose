# Redis

Dokku docs: https://github.com/dokku/dokku-redis

Module: `src/modules/redis.ts` (service lifecycle), `src/modules/service-backup.ts` (backups, shared with Postgres)

## YAML Keys

### Service Declaration (`redis.<name>`)

Declare Redis service instances. Services are created before apps during `up`, so they are ready to be linked.

```yaml
redis:
  api-cache:                           # service name
    version: "7.2-alpine"             # optional: image version
    image: redis                       # optional: custom Docker image

  shared-cache: {}                     # defaults: standard redis image, latest version
```

| Key | Dokku Flag |
|-----|------------|
| `version` | `redis:create <name> --image-version <version>` |
| `image` | `redis:create <name> --image <image>` |

Service creation is idempotent — if the service already exists, it is skipped. With `redis:` absent, `up` does nothing for Redis services. `down` runs `redis:destroy <name> --force` for each declared service that exists, after the apps are gone.

### Automated Backups (`redis.<name>.backup`)

Works exactly as [Postgres backups](postgres.md#automated-backups-postgresnamebackup): the same `backup:` keys (`schedule`, `bucket`, `auth`, `encryption`, `storage_class`, `object_name`, `mailto`, `timestamp`), validation, comparison, removal and masking, with the `redis:` prefix on every command (`redis:backup-auth`, `redis:backup-schedule`, `redis:set <name> backup-*`, `redis:backup-unschedule <name> --id default`, `redis:backup-deauth`) and reads from `redis:info <name> --format json`.

```yaml
redis:
  api-cache:
    backup:
      schedule: "0 * * * *"
      bucket: "cache-backups/api-cache"
      auth: { access_key_id: "${R2_ACCESS_KEY_ID}", secret_access_key: "${R2_SECRET_ACCESS_KEY}", region: "auto", signature_version: "s3v4", endpoint: "${R2_SCHEME}://${R2_HOST}" }
```

Differences from Postgres:

- Needs dokku-redis 2.3.1 or later; the too-old error reads `dokku-redis too old to report backup state (needs 2.3.1+)`.
- There is no legacy `DOKKU_COMPOSE_BACKUP_HASH_*` clean-up: redis never had hash-tracked backups.
- `export` writes the `backup:` block the same way (`auth` fields and `encryption.passphrase` as `REPLACE_ME`).

### Changing `version` or `image` later

`up` creates a service with them and never changes an existing one: an upgrade can need a dump and downtime, so run `redis:upgrade` yourself. When the declared value differs from `redis:info <name> --format json` (`image-version`, `image`), `up` logs one warning per service with both values of each field, and `diff` shows `~ version` or `~ image` and exits non-zero. A field the file does not declare never drifts; a declared `image: redis` equals the default.

### Export

`dokku-compose export` discovers Redis services by querying `redis:list` and `redis:info` on the server. Custom images are included when they differ from the default `redis` image.
