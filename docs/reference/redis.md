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

Service creation is idempotent — if the service already exists, it is skipped (its `properties` and `mounts` are then reconciled, see below). With `redis:` absent, `up` does nothing for Redis services. `down` runs `redis:destroy <name> --force` for each declared service that exists, after the apps are gone.

### Service Properties (`redis.<name>.properties`)

Settings of a service after it exists. Each key is the plugin's own `redis:set` property name, with the value the plugin documents. `up` reads `redis:info <name> --format json`, compares each declared key, and runs `redis:set <name> <key> -- <value>` for the ones that differ (the value follows `--` because a config option or a password can start with `-`).

```yaml
redis:
  api-cache:
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
| `properties.<key>: <value>` (differs) | `redis:set <name> <key> -- <value>` |
| `properties.password` (fingerprint differs) | `redis:set --no-restart <name> password -- <value>` |
| `properties.<key>` (service created in this run, key is a create flag) | `redis:create <name> --<flag> <value>` |
| a known key removed from the file, with `--prune` | `redis:set <name> <key>` (no value clears it) |

Values are strings or numbers (a number is written as its decimal string). A key the file does not declare is left alone. `diff` shows `~ properties.<key>` for a difference, and `- properties.<key>` for a known key that the server holds with a non-default value and the file omits; both count as drift, and only `up --prune` clears a `-`. A service that does not exist yet is planned with its create flags on the `:create` line (in `--dry-run` too); a key with no built-in entry follows as a `redis:set` line, since it is not a create flag. Neither restarts the service. After a `redis:set`, the info read is not reused: the next comparison reads again.

**Compared as the plugin reports them.** The info JSON reports what was set, not the plugin's default, so an unset key reads empty (`memory` reads `0`, which equals an absent or `0` value). A declared value equal to the default (`restart-policy: always`) differs once, is set, and then matches. Network and `log-opt` lists compare as sets, since order does not matter to the plugin; `custom-env` compares as a set of `KEY=value` pairs (the server reads it back joined with `;`). Every other key, including a key with no built-in entry, compares as an exact string: write the value exactly as `redis:info` prints it (`512`, not `512m`).

**Keys with built-in handling.** dokku-compose carries a small table of the keys below, and of every other key the plugin lists as settable (the known keys). A key outside the table is passed to `redis:set` unchanged.

| Key | Handling |
|-----|----------|
| `password` | Secret. Compared by the sha256 fingerprint `redis:info` reports as `password-fingerprint`; applied with `--no-restart`, and every app linked to the service (from `redis:links <name>`; in `--dry-run`, from the file's `links:`) is then added to the restart summary, because the plugin rewrites the url they hold. Letters, digits, `.`, `_`, `~` and `-` only. A `:create` flag. Never pruned (a password cannot be cleared), with no warning. On a stopped service the plugin refuses before changing anything and that service's step fails with its message |
| `custom-env` | Takes a map of names to values (a plain `;`-joined string also works). A value containing `;` or a newline is a `validate` error. Values are masked. Stop and start. A `:create` flag |
| `config-options` | One line only. Stop and start. A `:create` flag |
| `memory`, `shm-size` | Stop and start. `:create` flags |
| `volume-targets` | Takes a map of the plugin's volume names to absolute container paths (a plain `volume=path volume=path` string also works); `validate` rejects a relative path, a path with a colon, comma or space, `/`, and a volume named twice. Compared as a set. Stop and start. A `:create` flag, given once per entry (`--volume-target <volume>=<path>`) |
| `initial-network`, `post-create-network`, `post-start-network` | The last two take a list. Stop and start. `:create` flags |
| `log-driver`, `log-opt`, `restart-policy` | Stop and start. `:create` flags (`restart-policy` is `--restart`). `log-opt` takes a list |
| `wait-timeout` | Immediate. A `:create` flag. `0` is rejected by the plugin |
| `backup-*` | Rejected: use [`backup`](#automated-backups-redisnamebackup) |
| `expose-host`, `expose-mode`, `port-bind-address`, `port-source-range` | Rejected: reserved for a future `expose` key |
| `service-memory` | Rejected: redis has no service memory |
| `root-password` | Rejected: redis has no root password |
| `image`, `image-version`, `definition`, `mounts`, `backup-schedule` | Rejected: the plugin refuses them in `:set` (`version` and `image` are declared beside `properties`, `mounts` is its own key) |

"Stop and start" keys take effect only after the container is made again.

**Restarts.** `up` never restarts a service. A stop-and-start key that changed on an existing service is set, and `up` adds a line to its restart summary, once per service with the reasons after it:

```
dokku redis:stop api-cache && dokku redis:start api-cache  # memory, custom-env
dokku ps:restart myapp  # api-cache password changed
```

A service created in the same run needs no restart. A key with no built-in entry adds nothing: read the `redis:set` output.

**Masking.** Secrets and `custom-env` values (keys are shown) are masked in `diff`, logs, dry-run and error output unless `--sensitive` is given, like app `env:`. The masked commands are `redis:set <name> password -- <value>` (positional value), `redis:create ... --password <value>` and the `custom-env` values in `redis:set` and `redis:create --custom-env`. The literal `REPLACE_ME` is a `validate` error as the value of `password` or of a `custom-env` entry (export writes it as a placeholder).

**Unknown keys.** `validate` warns about a key that the plugin version dokku-compose is tested with (dokku-redis 2.4.0) does not list, and `up` passes it on anyway. If the server's plugin rejects a key or a value, that service's step fails: it is reported, the run goes on with the other services and apps, and `up` exits non-zero.

**Removal.** A missing `properties:` block or key is no action. With `--prune`, `up` reads the service once and clears every known key (the table above, from the plugin's settable list) that the file does not declare and the server holds with a non-default value, with an empty `redis:set <name> <key>` (`memory` then reads `0`). The info JSON also carries about fifty read-only keys, so a key outside the known list is never pruned. `password` is never pruned, and keys owned by another block (`backup-*`, `expose-*`) and rejected keys are left alone.

### Mounts (`redis.<name>.mounts`)

Storage entries mounted into the service container. An entry is declared once under the top-level [`volumes:`](storage.md) and named here, as for an app's `storage:`; dokku-compose resolves it to its host path.

```yaml
volumes:
  api-cache-data:
    chown: "999"                  # the user the database container runs as (see below)
  api-cache-dumps:
    path: /srv/dumps              # an existing directory; you manage its owner and mode

redis:
  api-cache:
    mounts:
      - api-cache-data:/opt/extra            # short form: <entry>:<container-dir>
      - entry: api-cache-dumps               # long form
        container_dir: /opt/dumps
        readonly: true                   # ro
        options: [z]                     # Docker mount options, passed through
```

| Value | Dokku command |
|-------|---------------|
| list differs from the server's | `redis:mount --replace <name> <host-path>:<container-dir>[:<options>]...` |
| `mounts: []` (and the server has mounts) | `redis:unmount --all <name>` |
| absent | no action, with or without `--prune` |

The short form is exactly `<entry>:<container-dir>`; `readonly` and `options` need the long form (the same rule as an app's `storage:`). `validate` rejects an entry not declared under `volumes:`, a host path (`/srv/dumps:/opt/dumps`, with a hint to declare the directory as an entry's `path:`), a container dir that is not absolute and normalised or contains `:`, a container dir used twice in one service, and `options` that are empty or hold `ro`, `rw`, a comma, `=`, `:` or whitespace. `subpath` and `volume_chown` are not mounts options here.

**Resolution.** An entry's host path is its `path:`, or `/var/lib/dokku/data/storage/<entry>` when it has none (a `legacy-<hash>` entry declared as `{}` uses the path the server holds). `up` passes `<host-path>:<container-dir>[:ro,<options>]` to `redis:mount --replace`, and `--volume` with the same value to `redis:create`. `volumes:` entries are converged before services, so the directory exists; a service that mounts an entry that failed to converge fails its step with the entry's name.

**Comparison.** `redis:info` reports the mounts as one space-joined string of normalised specs, so each resolved spec is normalised the same way before a set comparison: `ro` first, `rw` and a trailing `:` dropped, then other options. Order does not matter, and `diff` compares the resolved host paths. A change adds `dokku redis:stop <name> && dokku redis:start <name>` to the restart summary, like a property. A service created in the same run needs no restart.

**Ownership.** An entry at the default location is chowned to `herokuish` (uid 32767) unless it says otherwise, and a database container usually does not run as that user (the official images use 999, for example). Set `chown:` on the entry to the container's uid, as in the example, or the service cannot write to the directory.

Like `domains`, `ports` and `networks`, a whole list is never cleared because its key is missing: only `mounts: []` clears the mounts.

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

Export writes `properties` from `redis:info` for the known keys with a non-default value (`memory` of `0` is skipped), with `custom-env` as a map, every value written as `REPLACE_ME`, and the network and `log-opt` keys as lists. `password` is never written. Each mount becomes a `mounts:` item on a `volumes:` entry: the declared or exported entry at that host path when there is one, otherwise a new entry named after the directory (the naming rules of [Storage](storage.md#diff-and-export)) with `path:`. A mount whose host path cannot be an entry's `path:` or gets no valid name is left out with a warning.
