# Storage

Dokku docs: https://dokku.com/docs/advanced-usage/persistent-storage/

Module: `src/modules/volumes.ts` (top-level `volumes`), `src/resources/storage.ts` (`apps.<app>.storage`)

Needs Dokku >= 0.38.32 (named storage entries need 0.38.0 and `storage:mount --replace` with per-mount options 0.38.30). See [dokku](dokku.md).

Storage has two parts. A top-level `volumes:` block declares **entries**: named host directories with an owner and permissions. Each app then mounts entries **by name** in `apps.<app>.storage`, and each postgres or redis service in `<plugin>.<name>.mounts` (see [Postgres](postgres.md#mounts-postgresnamemounts)). Entries are the one way to declare host storage. A host path such as `/var/lib/dokku/data/storage/myapp/uploads:/app/uploads` is no longer accepted in `storage:`; point an entry at the directory with `path:` instead (see [Migrating](#migrating-host-path-mounts)).

dokku-compose takes one path for the common case: Dockerfile images whose app user is uid 32767. Entries are owned by `herokuish` (32767:32767) unless you say otherwise.

## `volumes` (top-level)

Declare storage entries. Names are global to the Dokku install and shared by every app that mounts them.

```yaml
volumes:
  uploads: {}               # /var/lib/dokku/data/storage/uploads, chowned to herokuish (32767)
  data:
    chown: 1000             # a preset (herokuish | heroku | paketo | root) or a uid 0-65535
    mode: "0750"            # octal string, 3 or 4 digits; quote it
  scratch:
    chown: false            # create the directory, never chown it
  media:
    path: /srv/media        # an existing directory elsewhere; you manage its owner and mode
```

| Key | Value | Dokku command |
|-----|-------|---------------|
| entry present | | `storage:list-entries --format json` (check)<br>`storage:create <name> [<path>] [--chown <v>] [--mode <v>]` (if missing) |
| `chown` | `herokuish`, `heroku`, `paketo`, `root`, or a uid 0-65535 | `storage:set <name> chown <value>` (if different from the entry's `chown`) |
| `chown: false` | opt out of ownership changes | `storage:set <name> chown false` (if different; an entry with no stored `chown` already counts as `false`) |
| `chown` absent | `herokuish` | as for `chown: herokuish`; `storage:create` always gets `--chown` (at the default location; a `path` entry is not chowned) |
| `mode` | quoted octal, e.g. `"0750"` or `"750"` | `storage:set <name> mode <value>` (if different from the entry's `mode`, compared in 4-digit form) |
| `mode` absent | not managed | no action (a new directory keeps 0755) |
| `path` | an absolute, normalised directory, or a Docker volume name | `storage:create <name> <path>` (only when the entry is missing) |
| `path` absent | `/var/lib/dokku/data/storage/<name>` | `storage:create <name>` |

`validate` rejects:

- a name that is not a DNS-1123 label (lowercase letters, digits and dashes) of at most 45 characters;
- a name starting with `legacy-`, which Dokku reserves for entries it made from old host-path mounts, unless the entry is `{}` (see below);
- `mode` that is not a quoted octal string. A YAML number such as `mode: 0750` is read as the number 488, so the message says to write `mode: "0750"`;
- `chown` other than a preset, a uid from 0 to 65535 (a string or a number) or `false`; `true` is rejected;
- a `path` that is not absolute, has a trailing slash, or an empty, `.` or `..` segment, and is not a Docker volume name (`^[a-zA-Z0-9][a-zA-Z0-9_.-]+$`);
- `path` combined with `mode`, or with `chown` other than `false` (see below);
- unknown keys.

### Ownership and mode

Dokku's `--chown` is `chown -R` on the whole directory, so `up` runs it only when the entry's stored `chown` differs from the declared one. An entry made by hand without a `chown` therefore gets a recursive chown to 32767 on the first `up`. Setting `chown` or `mode` on an existing entry changes the host directory at once and needs no app restart.

Dokku re-applies the entry's stored `chown` whenever `storage:set` touches the directory. A `mode` change on an entry whose `chown` is not `false` therefore also runs the recursive chown again, and the data is re-owned. `mode` itself applies to the directory only, not its contents.

### Entries with `path`

Dokku manages ownership and mode only under its default location, `/var/lib/dokku/data/storage/<name>`. An entry with any other `path` (an existing directory, or a Docker volume name) is yours to manage: `chown: false` is accepted and does nothing, and `chown` or `mode` with a value is rejected by `validate`. A `path` equal to the default location is the same as no `path` and may carry `chown` and `mode`. dokku-compose assumes the default Dokku library root `/var/lib/dokku` (`DOKKU_LIB_ROOT`); Dokku has no command that reports it. For an entry that already exists the comparison is with the path the server holds, so a relocated library root only affects the `validate` rule above.

If the directory does not exist, `storage:create` makes it with `mkdir -p` as the Dokku user, mode 0755. Set the owner and mode of an existing directory yourself.

Dokku cannot change an entry's path afterwards, and `storage:create` on an existing name rewrites the entry. So `up` never runs it for an entry that exists. When the server's entry has a different path than the file, `up` stops with an error naming both paths. Give the entry a new name in the file (the mount moves to it, see below), or correct `path`.

### Entries Dokku made

A `legacy-<hash>` name may appear under `volumes:` only as `{}`. It declares an entry Dokku created from an old host-path mount, so that apps can mount it by name. `up` never creates it and manages nothing about it, and stops with an error when the server has no such entry. `export` writes one only when it cannot find a valid name for the entry (see [`diff` and `export`](#diff-and-export)).

### Order, failures and `--dry-run`

`up` converges entries after networks and before any app. An entry that fails is logged and the other entries continue. An app that mounts a failed entry skips its storage step with an error naming the entry, and the run exits non-zero. An entry that is a `k3s` entry on the server (same name, other scheduler) fails the same way: dokku-compose manages only `docker-local` entries.

With `--dry-run`, an entry or an app that does not exist yet is planned: the `storage:create` and the `storage:mount --replace` that would follow are printed, and nothing is run.

### Removal

An entry removed from `volumes:` while an app or a service still mounts it is a `validate` error. An entry removed from `volumes:` is never destroyed, with or without `--prune`: `storage:destroy` can delete data, so it stays a manual step. For the same reason `--prune` does not clear a `chown` or `mode` that was removed from a declared entry. `diff` lists an entry the file does not declare as a note (`entry not in the compose file; left alone`) that does not count as drift. `legacy-*` entries and entries of another scheduler are never listed.

## `apps.<app>.storage`

Mount entries into an app. Each item is `<entry>:<container-dir>` or a map with per-mount options.

```yaml
apps:
  myapp:
    storage:
      - uploads:/app/uploads                    # short form: entry:container-dir
      - entry: data                             # long form
        container_dir: /app/data
        readonly: true                          # ro
        phases: [deploy]                        # deploy | run; default both
        process_type: worker                    # only this process type; default every process
        options: [Z]                            # Docker mount options, passed through

  worker:
    # storage key absent — no changes to mounts
```

| Option | Value | In `storage:mount --replace` |
|--------|-------|-------------------------|
| `entry` | a name declared in `volumes:` | first field of the pair |
| `container_dir` | absolute, normalised path in the container | second field |
| `readonly` | `true` / `false` (default) | `ro` token |
| `phases` | `[deploy]`, `[run]` or both (default) | one `phase=<p>` token per phase |
| `options` | list of Docker mount options | bare tokens, in order |
| `process_type` | a Procfile process type, not `_default_` (default: every process) | selects which `--replace` call carries the mount (`--process-type`) |

`subpath` and `volume_chown` are not supported: on docker-local, Dokku stores them but never applies them. `validate` rejects them, and rejects:

- an `entry` not declared in `volumes:`;
- a host path (an item starting with `/`), with a message that points at `path:`;
- a container dir that is not absolute or normalised, contains `:`, or is used twice in one scope;
- the same container dir in the default scope and a named one (Dokku forbids overlapping scopes);
- an `options` item that is empty or contains `ro`, `rw`, a comma or `=` (use `readonly`; Dokku rejects unknown `key=` tokens);
- `phases` that is empty or repeats a phase.

Mounting or unmounting needs `dokku ps:restart <app>` (Dokku: "the app requires a restart"); `up` lists the app at the end and does not restart it. `up` decides by expanding each mount into the set of (phase, process type, host path, container dir, readonly, options) it produces. When that set is the same before and after, nothing changes inside a container and the app is not listed. This is the case when an entry is swapped for another on the same host path.

On each `up` run, the app's mounts are converged against Dokku's current state, one process type at a time:

- Mounts are compared by process type and container dir. A mount that is missing, or differs in entry, phases, readonly or options, makes the scope differ. A `subpath` or `volume-chown` left on the server by hand differs too, and `--replace` clears it.
- A scope that differs is written with one call, `storage:mount --replace <app> <entry>:<dir>[:<options>]... [--process-type <p>]`. It is atomic and never leaves the app without the mount in between. `--replace` without `--process-type` only touches the default scope, so each named `process_type` gets its own call.
- A scope on the server that the file no longer declares is removed with `storage:unmount --all <app> --process-type <p>`. `--replace` refuses an empty list.
- Scopes are applied in an order that frees a container dir before another scope claims it. A swap between two scopes that cannot be ordered stops with an error; apply it in two runs.

| Value | Dokku Command |
|-------|---------------|
| `[list]` | `storage:report <app> --format json` (check)<br>`storage:mount --replace <app> <spec>... [--process-type <p>]` per differing scope<br>`storage:unmount --all <app> --process-type <p>` per scope no longer declared |
| `[]` | `storage:unmount --all <app>` (if any mount exists) |
| absent | no action |

`down` does not unmount storage; destroying the app removes its mounts. `--prune` changes nothing here: the list is already fully converged, and entries are never destroyed.

### Migrating host-path mounts

When Dokku is installed or upgraded it turns every colon-form mount (`/var/lib/dokku/data/storage/myapp/uploads:/app/uploads`) into a `legacy-<hash>` entry (`storage:migrate` repeats this on demand). The file can name the same directory with a normal entry, and `--replace` swaps the app onto it in one write, so the container sees the same host directory before and after and nothing is copied.

1. Upgrade the server to Dokku >= 0.38.32. `dokku storage:list-entries` shows the `legacy-<hash>` entries and `dokku storage:list <app>` the host paths.
2. Run `dokku-compose export`. It writes each `legacy-*` entry as a `volumes:` entry named after the directory, with `path:` (omitted when it is the default location), and the app's mount by that name:

   ```yaml
   volumes:
     uploads:
       path: /var/lib/dokku/data/storage/myapp/uploads
   apps:
     myapp:
       storage:
         - uploads:/app/uploads
   ```

3. Run `dokku-compose diff`. It shows `- legacy-3f9c1a2b7d:/app/uploads` and `+ uploads:/app/uploads`. A mount that Dokku migrated from a `-v` line in the deploy phase only carries `phases: [deploy]`; the file's default (both phases) is then real drift and lists the app for a restart. Write `phases: [deploy]` to keep it as it is.
4. Run `dokku-compose up`. It runs `storage:create uploads /var/lib/dokku/data/storage/myapp/uploads` (the directory exists and is not touched) and `storage:mount --replace myapp uploads:/app/uploads`. The running container keeps its mount. When nothing but the entry name changed, `up` does not ask for a restart.
5. The `legacy-<hash>` entry is now unmounted but still registered. `up` and `diff` leave it alone. `dokku storage:destroy legacy-3f9c1a2b7d` is safe once no app mounts it: it keeps the host directory (and Dokku refuses `--destroy-host-dir` for a custom path).

To get `chown` and `mode` managed as well, move the data into the default location (`/var/lib/dokku/data/storage/<name>`) in a maintenance window, then drop `path:`. Dokku has no command that renames or re-paths an entry.

Two apps that mounted the same host path shared one `legacy-<hash>` entry; declare one entry and mount it from both.

## `diff` and `export`

`diff` reads entries with `storage:list-entries --format json` (only when the file declares `volumes:`) and each app's mounts with `storage:report <app> --format json` (the `attachment.<n>.*` keys: entry name, host path, container path, phases, process type, subpath, readonly, volume options, volume chown). It shows:

- Under `volumes:`: `+ <name>: not created` for a declared entry the server lacks; `~ <name>: chown root → herokuish, mode 0700 → 0750` when a declared value differs (only declared values are compared); and, for an entry `up` cannot converge (another path, another scheduler, a `legacy-` entry that is not on the server), the reason. These count as drift.
- A note, `storage entries not in the compose file (up leaves them)`, for a docker-local entry the file does not declare. It does not count as drift. `legacy-*` entries and entries of another scheduler are never listed.
- Under an app's `storage`: the mounts as the server has them (`-`) and as the file declares them (`+`), each as `[<process type>=]<entry>:<container-dir>[:<tokens>]`, where the tokens are `ro`, `phase=<p>` (when not both phases), the Docker options, and a `volume-subpath=` or `volume-chown=` that only the server holds. A mount on a `legacy-<hash>` entry therefore shows against the named entry that replaces it.

`export` writes every docker-local entry under `volumes:` with `chown` and `mode` as stored, and `path:` only when it is not the default location. An entry at the default location with no stored `chown` is written as `chown: false`, so a later `up` leaves its directory as it is instead of chowning it to `herokuish`; `chown: false` also counts as in sync with an entry that has no stored `chown`. With `--app`, only the entries those apps mount are written. Each app's mounts go under `storage:` as `<entry>:<container-dir>`, in the map form when they have `readonly`, `phases`, `options` or `process_type`. A `subpath` or `volume-chown` on the server is dropped with a warning.

A `legacy-*` entry is written under a name made from its host path, with `path:`:

1. Take the last path component; if that does not give a free name, the last two joined with a dash.
2. Lowercase it, turn every run of characters outside `a-z0-9` into one dash, strip dashes from both ends, remove a leading `legacy-`, strip dashes again, cut to 45 characters and strip trailing dashes again.
3. The name is used when it is not empty and not already taken. A name is taken when the server has an entry of that name (other than this one) or an earlier entry of this export got it.
4. When both candidates are empty or taken, try the first candidate with `-2`, `-3`, … (cut so the name stays within 45 characters).
5. When no candidate is valid (for example the path is `/`), keep the `legacy-<hash>` name and write it as `{}`.

A `legacy-*` entry no app mounts is skipped, and so are entries of other schedulers.

## Out of scope

Entry properties of the `k3s` scheduler (`size`, `access-mode`, `storage-class-name`, `namespace`), `storage:annotations:set` / `storage:labels:set` and `reclaim-policy` are not managed; `up` creates only `docker-local` entries. `subpath` and `volume-chown` are not mounted. `storage:destroy`, `storage:exec`, `storage:wait`, `storage:migrate` and the deprecated `storage:ensure-directory` are never run.
