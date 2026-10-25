# Postgres

Dokku docs: https://github.com/dokku/dokku-postgres

Module: `src/modules/postgres.ts` (service lifecycle), `src/modules/service-backup.ts` (backups, shared with Redis)

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

Service creation is idempotent — if the service already exists, it is skipped. With `postgres:` absent, `up` does nothing for Postgres services. `down` runs `postgres:destroy <name> --force` for each declared service that exists, after the apps are gone.

### Automated Backups (`postgres.<name>.backup`)

Configure S3-compatible automated backups for a Postgres service. `up` and `diff` read the server's backup settings from `postgres:info <name> --format json` (the same read as the version check, one per service) and run only what differs. Redis takes the same block: see [Redis](redis.md#automated-backups-redisnamebackup).

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
      encryption:                                    # optional: exactly one of the two forms, or false
        passphrase: "${BACKUP_PASSPHRASE}"           #   GPG symmetric passphrase
        # public_key_id: "ABCD1234ABCD1234"          #   or a GPG public key id
        # keyserver: "hkp://keys.example.com"        #   optional, with public_key_id only
      storage_class: STANDARD_IA                     # optional: S3 storage class
      object_name: "db/latest"                       # optional: name backups are uploaded under
      timestamp: false                               # optional: only false; same key every backup
      mailto: "ops@example.com"                      # optional: who cron mails the output to

  old-db:
    backup: false                                    # remove the schedule, credentials, encryption and settings
```

| Key | Dokku Command |
|-----|---------------|
| `backup.auth.*` | `postgres:backup-auth <name> <key> <secret> <region> <sig_version> <endpoint>` |
| `backup.schedule` (with `backup.bucket`) | `postgres:backup-schedule <name> <schedule> <bucket>` |
| `backup.bucket` (only the bucket differs) | `postgres:set <name> backup-bucket <bucket>`; when the service has a schedule other than `default`, `postgres:backup-schedule <name> <schedule> <bucket>` instead (`set backup-bucket` is refused then) |
| `backup.encryption.passphrase` | `postgres:set <name> backup-encryption-passphrase <passphrase>`<br>`postgres:set <name> backup-public-key-id` and `backup-keyserver` with no value (a public key takes precedence over a passphrase, so it is cleared) |
| `backup.encryption.public_key_id` | `postgres:set <name> backup-keyserver <keyserver>` (no value when `keyserver` is omitted)<br>`postgres:set <name> backup-public-key-id <id>`<br>`postgres:set <name> backup-encryption-passphrase` with no value |
| `backup.encryption: false` | `postgres:set <name> backup-encryption-passphrase`, `backup-public-key-id` and `backup-keyserver` with no value, each only if set |
| `backup.storage_class` | `postgres:set <name> backup-storage-class <class>` |
| `backup.object_name` | `postgres:set <name> backup-object-name <name>` |
| `backup.timestamp: false` | `postgres:set <name> backup-timestamp false` |
| `backup.mailto` | `postgres:set <name> backup-mailto <address[,address]>` |
| `backup: false` | `postgres:backup-unschedule <name> --id default` (only if scheduled), then `postgres:backup-deauth <name>`, then the encryption and other settings above with no value, each only if set; nothing when the server has none of them |

`schedule`, `bucket` and all five `backup.auth` fields are required when `backup` is a map; everything else is optional. Unscheduling always names `--id default`: without `--id` the plugin refuses when the service has other schedules.

`validate` checks what the plugin checks at `set` time, so a bad value never reaches the server:

- `encryption` is `false` or names exactly one form: `passphrase` or `public_key_id` (both, or `{}`, is rejected). `keyserver` only goes with `public_key_id`. Passphrase and `public_key_id` are non-empty and single-line.
- `storage_class` is one of `STANDARD`, `REDUCED_REDUNDANCY`, `STANDARD_IA`, `ONEZONE_IA`, `INTELLIGENT_TIERING`, `GLACIER`, `DEEP_ARCHIVE`, `GLACIER_IR`.
- `object_name` is at most 512 characters of letters, numbers, dots, dashes, underscores and slashes, with no leading or trailing slash and no empty, `.` or `..` segment.
- `mailto` has no spaces.
- `timestamp` accepts only `false`: the plugin takes `false` or unset, so there is no `true`.

With `backup:` absent, `up` leaves any backup alone (see Removal below). A service created in the same `--dry-run` is planned with `:backup-auth`, `:backup-schedule` and every declared setting, since a new service has no backup.

Order within a service: auth, schedule, bucket, then encryption, then the other settings. `:set` of encryption, storage class, object name and timestamp is read when a backup runs, so it applies to the next backup, scheduled ones included. `mailto` is read when Dokku writes its crontab: `set backup-mailto` regenerates it, so it applies to the next scheduled run. `mailto` works on every Dokku dokku-compose supports (0.38.32 or later, the first release with a `MAILTO` per cron entry).

How each setting is compared:

- **Credentials**: the server reports `backup-auth-fingerprint`, the sha256 of the stored access key id and secret joined by one newline (`printf '%s\n%s' "$id" "$secret" | sha256sum`). dokku-compose computes the same from the file and runs `:backup-auth` only when it, `backup-default-region`, `backup-signature-version` or `backup-endpoint-url` differs, so a rotated key is picked up on the next `up`. Credentials are never printed: `diff` says only which of them differ, and the dry-run listing masks them.
- **Schedule**: `backup-schedule` against `backup.schedule`. A change runs `:backup-schedule` (which also writes the bucket), and `up` then checks with `:backup-schedule-cat` that the cron entry landed.
- **Bucket**: `backup-bucket` (the full `bucket/prefix`) against `backup.bucket`. A change alone runs `set backup-bucket`, with no re-auth, or `:backup-schedule` when another schedule exists (see the table).
- **Passphrase**: the server reports `backup-encryption-fingerprint`, the sha256 of the stored passphrase with no trailing newline (`printf '%s' "$passphrase" | sha256sum`), empty when none is stored. A different fingerprint runs `set backup-encryption-passphrase`, so a rotated passphrase is picked up. The passphrase is never printed: `diff` says only that a passphrase is missing or different.
- **Public key**: `backup-public-key-id` and `backup-keyserver` are compared as exact strings (no `0x` prefix or case normalisation), so write the id the way the server reports it. `set backup-public-key-id` neither fetches nor validates the key: a wrong id or keyserver fails at the first backup, not at `up`. The declared form must be the only one stored: a passphrase declared while a public key is stored (or the reverse) drifts.
- **Other settings**: `backup-storage-class`, `backup-object-name` and `backup-mailto` are compared as strings. `backup-timestamp` reads `"true"` unless disabled, so a declared `false` drifts only while it reads `"true"`.
- **Removal**: only `backup: false` removes a backup, and it removes the encryption and the other settings with it. `:backup-deauth` removes only the credentials (encryption lives apart, in `backup-encryption/`), so they are cleared explicitly. With `backup:` absent, `diff` shows what the server holds (schedule, credentials, encryption or any of the other settings) as a note, not drift; `up` leaves it, and `up --prune` only warns. `up` never runs `:backup-deauth` before `:backup-auth`: deauth deletes the service's credentials, so a failed auth would leave no backups.
- **Encryption left out**: with `backup` declared but `encryption:` absent, the server's encryption is left alone. `diff` notes it (`backup encryption on the server is not in the file`), `up` leaves it, and `up --prune` only warns, never removing encryption by omission. `encryption: false` clears it.
- **Other settings left out** (`storage_class`, `object_name`, `timestamp`, `mailto`): `up` leaves a value the file does not declare; `up --prune` clears it (`set <name> <key>` with no value).
- **Other schedules**: only the default schedule is managed. A service with schedules other than `default` (`postgres:backup-schedule --id`) gets a `diff` note naming their ids, read from `backup-schedules` in `postgres:info`; `up` and `--prune` never touch them. Plugins before 2.5.0 do not report `backup-schedules`, and `diff` then says nothing.

Needs dokku-postgres 2.3.1 or later. The `backup-*` keys arrived over several releases: `backup-public-key-id` and `backup-keyserver` in 2.1.0; `backup-auth-fingerprint`, `backup-encryption-fingerprint` and `backup-storage-class` in 2.2.0; `backup-mailto`, `backup-timestamp` and `backup-object-name` in 2.3.0; `backup-schedules` in 2.5.0 (optional). `up` and `diff` fail with `dokku-postgres too old to report backup state (needs 2.3.1+)` when `backup-auth-fingerprint` is missing from `postgres:info --format json`, or when `backup-timestamp` or `backup-mailto` is missing and `encryption`, `timestamp`, `mailto`, `storage_class` or `object_name` is declared. A missing `backup-schedules` is never an error.

Masking: a passphrase is masked completely (no trailing characters shown) in `up` and dry-run command logs (`postgres:set <name> backup-encryption-passphrase ****`), in stderr that echoes it, and in `diff` and `export` output. `public_key_id` and `keyserver` are not secrets and are shown as they are, although their names contain `KEY`.

Earlier versions tracked backups as a hash in the global env var `DOKKU_COMPOSE_BACKUP_HASH_<SERVICE>`. `up` unsets every such key once (`config:unset --global --no-restart`, which restarts no app), and `diff` lists them under `global / backup_hash` until it has.

### Changing `version` or `image` later

`up` creates a service with them and never changes an existing one: an upgrade can need a dump and downtime, so run `postgres:upgrade` yourself. When the declared value differs from `postgres:info <name> --format json` (`image-version`, `image`), `up` logs one warning per service with both values of each field, and `diff` shows `~ version` or `~ image` and exits non-zero. A field the file does not declare never drifts; a declared `image: postgres` equals the default.

### Export

`dokku-compose export` discovers Postgres services by querying `postgres:list` and `postgres:info` on the server. Custom images (e.g., `postgis/postgis`) are included when they differ from the default `postgres` image. Backups are read from `postgres:info <name> --format json`. A service with a default schedule is exported with `schedule` and `bucket` and every `auth` field set to `REPLACE_ME`: credentials are never read back. When encryption is on, `encryption` is exported as `passphrase: REPLACE_ME` (a passphrase is never read back) or with the real `public_key_id` and `keyserver`; `storage_class`, `object_name`, `mailto` and `timestamp: false` are exported with the server's values. A service with encryption or settings but no default schedule gets no `backup:` block, because a map needs `schedule`, `bucket` and `auth`; `export` and `diff` note it.

`export` writes `REPLACE_ME` for every secret. `validate` rejects the literal `REPLACE_ME` as the value of `encryption.passphrase` and of `auth.access_key_id` and `auth.secret_access_key` ("replace the REPLACE_ME placeholder written by export"), so an exported file cannot be applied before its secrets are filled in.
