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

Service creation is idempotent — if the service already exists, it is skipped (its `properties` and `mounts` are then reconciled, see below). With `postgres:` absent, `up` does nothing for Postgres services. `down` runs `postgres:destroy <name> --force` for each declared service that exists, after the apps are gone.

### Service Properties (`postgres.<name>.properties`)

Settings of a service after it exists. Each key is the plugin's own `postgres:set` property name, with the value the plugin documents. `up` reads `postgres:info <name> --format json`, compares each declared key, and runs `postgres:set <name> <key> -- <value>` for the ones that differ (the value follows `--` because a config option or a password can start with `-`).

```yaml
postgres:
  api-db:
    properties:
      memory: 512                        # container limit in MB
      shm-size: 256m
      restart-policy: unless-stopped
      log-driver: json-file
      log-opt: [max-size=10m, max-file=3]          # list, joined with ","
      wait-timeout: 120                  # seconds, greater than 0
      initial-network: myapp-net
      post-create-network: [myapp-net, other-net]  # list, joined with ","
      post-start-network: [myapp-net]
      config-options: "-c max_connections=200"     # one line
      volume-targets:                              # map: the plugin's volume name to the container path it is mounted at
        data: /var/lib/data
      custom-env:                                  # map, joined as KEY=value;KEY=value
        TZ: UTC
      password: ${DB_PASSWORD}                    # managed, see below
```

| Key | Dokku command |
|-----|---------------|
| `properties.<key>: <value>` (differs) | `postgres:set <name> <key> -- <value>` |
| `properties.password` (fingerprint differs) | `postgres:set --no-restart <name> password -- <value>` |
| `properties.<key>` (service created in this run, key is a create flag) | `postgres:create <name> --<flag> <value>` |
| a known key removed from the file, with `--prune` | `postgres:set <name> <key>` (no value clears it) |

Values are strings or numbers (a number is written as its decimal string). A key the file does not declare is left alone. `diff` shows `~ properties.<key>` for a difference, and `- properties.<key>` for a known key that the server holds with a non-default value and the file omits; both count as drift, and only `up --prune` clears a `-`. A service that does not exist yet is planned with its create flags on the `:create` line (in `--dry-run` too); a key with no built-in entry follows as a `postgres:set` line, since it is not a create flag. Neither restarts the service. After a `postgres:set`, the info read is not reused: the next comparison reads again.

**Compared as the plugin reports them.** The info JSON reports what was set, not the plugin's default, so an unset key reads empty (`memory` reads `0`, which equals an absent or `0` value). A declared value equal to the default (`restart-policy: always`) differs once, is set, and then matches. Network and `log-opt` lists compare as sets, since order does not matter to the plugin; `custom-env` compares as a set of `KEY=value` pairs (the server reads it back joined with `;`). Every other key, including a key with no built-in entry, compares as an exact string: write the value exactly as `postgres:info` prints it (`512`, not `512m`).

**Keys with built-in handling.** dokku-compose carries a small table of the keys below, and of every other key the plugin lists as settable (the known keys). A key outside the table is passed to `postgres:set` unchanged.

| Key | Handling |
|-----|----------|
| `password` | Secret. Compared by the sha256 fingerprint `postgres:info` reports as `password-fingerprint`; applied with `--no-restart`, and every app linked to the service (from `postgres:links <name>`; in `--dry-run`, from the file's `links:`) is then added to the restart summary, because the plugin rewrites the url they hold. Letters, digits, `.`, `_`, `~` and `-` only. A `:create` flag. Never pruned (a password cannot be cleared), with no warning. On a stopped service the plugin refuses before changing anything and that service's step fails with its message |
| `custom-env` | Takes a map of names to values (a plain `;`-joined string also works). A value containing `;` or a newline is a `validate` error. Values are masked. Stop and start. A `:create` flag |
| `config-options` | One line only. Stop and start. A `:create` flag |
| `memory`, `shm-size` | Stop and start. `:create` flags |
| `volume-targets` | Takes a map of the plugin's volume names to absolute container paths (a plain `volume=path volume=path` string also works); `validate` rejects a relative path, a path with a colon, comma or space, `/`, and a volume named twice. Compared as a set. Stop and start. A `:create` flag, given once per entry (`--volume-target <volume>=<path>`) |
| `initial-network`, `post-create-network`, `post-start-network` | The last two take a list. Stop and start. `:create` flags |
| `log-driver`, `log-opt`, `restart-policy` | Stop and start. `:create` flags (`restart-policy` is `--restart`). `log-opt` takes a list |
| `wait-timeout` | Immediate. A `:create` flag. `0` is rejected by the plugin |
| `backup-*` | Rejected: use [`backup`](#automated-backups-postgresnamebackup) |
| `expose-host`, `expose-mode`, `port-bind-address`, `port-source-range` | Rejected: reserved for a future `expose` key |
| `export-args`, `import-args` | Rejected: not managed (extra arguments for ad-hoc exports and imports) |
| `service-memory` | Rejected: postgres has no service memory |
| `root-password` | Rejected: postgres has no root password |
| `image`, `image-version`, `definition`, `mounts`, `backup-schedule` | Rejected: the plugin refuses them in `:set` (`version` and `image` are declared beside `properties`, `mounts` is its own key) |

"Stop and start" keys take effect only after the container is made again.

**Restarts.** `up` never restarts a service. A stop-and-start key that changed on an existing service is set, and `up` adds a line to its restart summary, once per service with the reasons after it:

```
dokku postgres:stop api-db && dokku postgres:start api-db  # memory, custom-env
dokku ps:restart myapp  # api-db password changed
```

A service created in the same run needs no restart. A key with no built-in entry adds nothing: read the `postgres:set` output.

**Masking.** Secrets and `custom-env` values (keys are shown) are masked in `diff`, logs, dry-run and error output unless `--sensitive` is given, like app `env:`. The masked commands are `postgres:set <name> password -- <value>` (positional value), `postgres:create ... --password <value>` and the `custom-env` values in `postgres:set` and `postgres:create --custom-env`. The literal `REPLACE_ME` is a `validate` error as the value of `password` or of a `custom-env` entry (export writes it as a placeholder).

**Unknown keys.** `validate` warns about a key that the plugin version dokku-compose is tested with (dokku-postgres 2.4.0) does not list, and `up` passes it on anyway. If the server's plugin rejects a key or a value, that service's step fails: it is reported, the run goes on with the other services and apps, and `up` exits non-zero.

**Removal.** A missing `properties:` block or key is no action. With `--prune`, `up` reads the service once and clears every known key (the table above, from the plugin's settable list) that the file does not declare and the server holds with a non-default value, with an empty `postgres:set <name> <key>` (`memory` then reads `0`). The info JSON also carries about fifty read-only keys, so a key outside the known list is never pruned. `password` is never pruned, and keys owned by another block (`backup-*`, `expose-*`) and rejected keys are left alone.

### Mounts (`postgres.<name>.mounts`)

Host paths and Docker volumes mounted into the service container.

```yaml
postgres:
  api-db:
    mounts:
      - /var/lib/dokku/data/storage/myapp-extra:/opt/extra   # <source>:<container-dir>[:<options>]
      - dbvol:/opt/data:ro                                   # docker volume, read only
```

| Value | Dokku command |
|-------|---------------|
| list differs from the server's | `postgres:mount --replace <name> <spec>...` |
| `mounts: []` (and the server has mounts) | `postgres:unmount --all <name>` |
| absent | no action, with or without `--prune` |

The list is the whole set: `--replace` drops a mount that is not declared. A spec must not contain whitespace (`validate` rejects it). `postgres:info` reports mounts as one space-joined string of normalised specs, so each declared spec is normalised the same way before the set comparison: `ro` first, `rw` and a trailing `:` dropped, then other options, then `volume-subpath=` and `volume-chown=`. Order does not matter. A service created in the same run gets `--volume <spec>` on `:create`. Mounts reach the container after stop and start, so a change adds the same line to the restart summary as a property. A host source path must already exist (see [Storage](storage.md)). Like `domains`, `ports` and `networks`, a whole list is never cleared because its key is missing: only `mounts: []` clears the mounts.

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

Export writes `properties` from `postgres:info` for the known keys with a non-default value (`memory` of `0` is skipped), with `custom-env` as a map, every value written as `REPLACE_ME`, and the network and `log-opt` keys as lists. `password` is never written. Mounts become `mounts:`.
