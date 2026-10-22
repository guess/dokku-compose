# Changelog

## [Unreleased]

### Added

- **`up` lists the apps that need a restart.** Env, storage, deploy and run Docker options, links and network changes (`networks`, `network`) only reach a running container when it restarts, so `up` ends with `dokku ps:restart <app>  # <reasons>` for each app it changed (`would need` on `--dry-run`, also after a partial failure). Settings only a rebuild applies (build args and options, `networks`, `attach_post_create`, `initial_network`) print `dokku ps:rebuild <app>` instead. A global `env:` change lists the apps the run processes. Nothing is restarted and there is no `--restart` flag. Changes Dokku applies live (ports, domains, nginx, proxy, logs, checks) are not listed. See the README's `up` section for the evidence table.

### Fixed

- **Build args with unusual values round-trip.** `build.args` are read from `docker-options:report <app> --format json` (`build-list`, each option as Dokku stored it) instead of splitting the text report, and are added with the `KEY=VALUE` word shell-quoted so Dokku stores it as one word. A value containing ` --x`, `-t x` stored beside a build arg, spaces, `?`, `$` or a quote is no longer re-added on every `up`, and `up --prune` removes a stale one by its stored text. `diff` and `export` read build settings per app.

### Changed (behaviour)

- **When `diff` says a box is in sync, `up` changes nothing.** A test harness pairs a compose file declaring every resource with a server whose state equals it, and requires `diff` in sync and an empty `up --dry-run` command log.
- **SSL certificates are compared, not re-added.** `up` reads `certs:report --ssl-enabled`, then `certs:show <app> crt`, and compares the certificate with `certfile` (trailing whitespace ignored): the same one runs nothing, a different one runs `certs:update` and shows in `diff` as `~ ssl`. The key is never read. An unreadable certificate is unknown, never "no certificate".
- **`checks:` reads first** and runs only the calls that differ. Process types go to `checks:disable`, `checks:skip` and `checks:enable` as one comma-separated argument, as Dokku reads them (before, only the first type was applied).
- **Global `domains:`, `logs:` and `nginx:` read first** (`domains:report --global`, `logs:report --global --format json`, `nginx:report --global --format json`) and set only what differs; `domains: false` clears only when global domains are set.
- **App `logs:` is read as JSON**, because the plain report prints a sink as `<type>://redacted`; a declared `vector-sink` was re-set on every `up`.
- **App `domains:` with more than one domain** no longer removes and re-adds them on every `up`: Dokku prints the vhosts on one line, space-separated.

### Added

- **`diff` shows a datastore `version` or `image` change** (`~ version`, `~ image`) for `postgres:` and `redis:` services, read from `<plugin>:info <svc> --format json`, and exits non-zero. `up` warns once per service with both values of each field and runs no `:upgrade`; a service that declares neither field never drifts.
- **`diff` shows global `domains:`, `logs:` and `nginx:` drift** under a `global` section (log sinks masked), and a declared network missing on the server under `networks:`.
- **`diff --verbose` prints `Everything in sync.`** when nothing differs.

## [0.13.1] - 2026-10-22

### Changed (behaviour)

- **Every command that talks to a server stops on a Dokku too old for dokku-compose.** `up`, `diff`, `down`, `export` and `ps` read `dokku version` first and, below 0.38.22 (the first release where `plugin:list`, `ps:scale`, `config:export` and `ps:report` all accept `--format json`), stop with `dokku-compose <version> needs Dokku >= 0.38.22; this server runs <server>. Upgrade Dokku first.` before any other Dokku call. `validate` and `init` are unchanged. This replaces the buried "plugin:list --format json did not return JSON" failure on older servers.
- **`dokku.version` is a hard minimum for `up`.** `up` stops before changing anything when the server is older than the file's value (it was a warning).
- **Version drift in `diff`.** A server whose Dokku version differs from `dokku.version` (older or newer) shows `~ version: <file> (file) → <server> (server)` and makes `diff` exit non-zero like other drift; `diff` never throws for it. A newer server makes `up` log one notice and carry on.

## [0.13.0] - 2026-10-22

### Breaking

- **Requires Dokku with `--format json`** for `config:export`, `plugin:list`, `ps:report` and `ps:scale` (Dokku 0.38 has it). A read that does not return JSON now fails the run instead of being treated as empty.
- **A `${VAR}` is substituted after the YAML is parsed**, in string values only. A variable can no longer inject YAML structure, a `${VAR}` value is always a string, and keys and comments are not substituted. `$${` writes a literal `${`.

### Added

- **`up --prune`** resets settings the file no longer declares: nginx, logs, registry, scheduler, `ps` and network properties, checks, and build args. `diff` is the preview; there is no prompt. It never destroys an app, service or network, never uninstalls a plugin, and never changes `scale` or env.
- **`diff` `-` lines** for settings on the server that the file does not declare, and a warning when an app with no `links:` has linked services.
- **`ps:` and `scale:`** per-app keys: `ps:set` properties (`procfile-path`, `restart-policy`, `stop-timeout-seconds`) and `ps:scale`, applied with `--skip-deploy`. A `scale` count may be a `${VAR}` reference: numeric strings are coerced to integers.
- **Plugin `version` pins.** A missing plugin is installed with `--committish`; an older installed plugin is moved forward with `plugin:update`; a newer one is never downgraded; a SHA pin is compared with the installed commit.

### Changed (behaviour)

- **Env keys removed from the file are really unset**, including when the whole `env:` block is removed. `env` is read with `config:export --format json`, so any value round-trips and an unchanged value is no longer re-set on every `up`.
- **Each step keeps going after a failure**; the run ends non-zero with a summary. A failed `apps:create` stops that app.
- **Leftovers on the box no longer trigger nginx `proxy:build-config`.**
- `diff --verbose` shows an env key that is marked but gone from the app as `(unset)`.

### Known limit

- Only keys named in `DOKKU_COMPOSE_MANAGED_KEYS` are unset. dokku-compose 0.12 and earlier rewrote that marker on every run, so keys removed from the file under those versions are orphaned (set on the app, absent from the marker). Unset them by hand once. See `docs/reference/config.md`.

## [0.12.0] - 2026-09-18

### Fixed

- **Every `execa` call now passes `stdin: 'ignore'`.** On a real Dokku box, execa's default `stdin: 'pipe'` made several Dokku bash-plugin commands (`nginx:report`, `certs:report`, `domains:report`, `git:report`, `docker-options:report`, `builder-dockerfile:*`, `postgres:create`, `postgres:link`, ...) silently do nothing and exit 0 with empty stdout, while Go-plugin commands were unaffected. This made `diff` report `ssl`, `domains` etc. as missing when they were actually set, and made `up` print "done" for mutations (like creating and linking a postgres service) that never ran.
- **A failed mutation is no longer reported as done.** `Runner.run()` now throws a `DokkuCommandError` (masked command, exit code, stderr) on a non-zero exit instead of swallowing it. `check()` still returns `false` and `query()` still returns lenient (possibly empty) output on failure — their existing contracts are unchanged.
- **`up` (and `down`) now fail loudly.** A failing global-phase command (plugins, docker auth, global config, networks, services) aborts the whole run. In the per-app phase, a failing app is reported with its command and stderr, and the run continues to the next app by default — the documented behaviour — then exits non-zero with a summary of which apps failed. `--fail-fast` (already declared but previously unwired) now actually stops at the first failure.
- **`diff` no longer reports "missing" for state it could not read.** If a bulk report comes back with zero parseable sections while apps exist, `diff` falls back to a per-app read instead of treating every app as missing that resource; if the per-app read is also empty, the resource is reported as `unknown` (not `missing`) and `diff` exits non-zero with a warning naming what it could not read.
- **`ssl` no longer shows as "changed" on every `diff`/`up` run.** `certs:report` only ever reports a boolean (cert present or not), so comparing it against a desired `{certfile, keyfile}` object always looked different. `diff` now treats a desired cert object against a present cert (`true`) as in-sync, and against an absent one (`false`) as missing.
- **Backup credentials no longer leak into error messages.** `postgres:backup-auth`/`redis:backup-auth` (and any other `*:backup-auth`) pass the access key ID and secret access key as positional arguments; a failing call used to include them verbatim in the thrown error and in dry-run output. They're now masked the same way `registry:login`'s password already was, and any part of the same command's stderr that echoes a masked value back is scrubbed too.
- **`diff` on a first run no longer shows `unknown` for apps that don't exist yet.** The unreadable-bulk-report heuristic used to count every *configured* app, so planning against a server with no apps produced `unknown` + read warnings instead of `missing`. It now checks which configured apps actually exist first; an app that doesn't exist yet reports its desired resources as `missing`, and only apps that do exist feed the unreadable check.
- **`ssl`'s own read no longer coerces an unreadable report to "no cert".** An empty/unreadable `certs:report` used to read as `false`, which made `diff` report an installed cert as missing — the exact production incident. It now reads as unknown and defers to the same `unknown` handling as any other unreadable resource.
- **`diff --verbose` now shows read warnings**, matching `diff`'s default summary output, and renders an `unknown` resource as a distinct line rather than a `+`/`-` block that looks like a proposed change.

### Breaking (behavioural, not API)

- `up`/`down` and any script wrapping them will now see non-zero exit codes for failures that previously exited 0 silently. `diff` can now exit non-zero with a read-warning even when nothing is actually out of sync, if server state could not be read at all.

## [0.11.0] - 2026-04-28

### Added

- Optional `dokku.version` field pins a minimum Dokku version. On `up` and `diff`, dokku-compose queries the server's `dokku version` and prints a warning if it falls below the pin. Warning-only and opt-in — omitting the field skips the check entirely. See `docs/reference/dokku.md`.

### Fixed

- `docker_auth` now passes `--global` to `dokku registry:login`, making the host-scope login explicit and silencing Dokku's deprecation warning about implicit positional-arg disambiguation. The dry-run password mask was updated to accept the new flag while preserving back-compat for the unflagged form.

## [0.10.1] - 2026-04-28

### Fixed

- `Storage.read` queried the non-existent `--storage-mounts` flag, so reads always returned empty and every mount looked missing on every run. Switched to `--storage-deploy-mounts` and added a parser for the `-v PATH:PATH -v PATH:PATH` line format dokku reports.
- SSH arg quoting wrapped every arg in single quotes, which dokku 0.36's SSH command wrapper handles inconsistently across subcommands — `git:report` failed (so reads returned empty and every app's git deploy branch reconciled every run) while other reports happened to pass through. Plain identifiers and flags now reach the remote unmodified; only args containing shell-significant characters are quoted.

## [0.10.0] - 2026-04-28

### Added

- `docker_auth:` top-level block for declaring host-level container registry credentials. On `up`, dokku-compose runs `dokku registry:login` for each entry so the docker daemon can pull from private registries — useful with `dokku git:from-image` flows. Passwords are masked in `--dry-run` output. Distinct from the per-app `apps.<app>.registry:` block, which configures push behavior. See `docs/reference/docker_auth.md`.

## [0.9.3] - 2026-04-08

### Fixed

- Postgres backup reconciliation can no longer silently leave a service with no backups. Three related changes:
  - `loadConfig` now throws on unset `${VAR}` references instead of substituting empty strings, so missing credentials fail loudly at parse time
  - `ServiceBackup` / `ServiceBackupAuth` schemas require `.min(1)` on every string field as a second line of defense against empty values
  - `ensurePostgresBackups` no longer runs `postgres:backup-deauth` before `backup-auth` (the latter overwrites in place), and now verifies the installed cron via `postgres:backup-schedule-cat` before persisting the global hash — silent failures retry on the next run instead of masquerading as "already configured"

## [0.9.2] - 2026-03-05

### Fixed

- npm `bin` entry now points to `bin/dokku-compose` instead of `dist/index.js`, so the correct shebang and entry point are used when installed globally

## [0.9.1] - 2026-03-05

### Fixed

- CLI bin script now runs the compiled `dist/index.js` via Node instead of `src/index.ts` via Bun, which wasn't shipped in the npm package

## [0.9.0] - 2026-03-05

### Fixed

- `export` now includes backup schedule and bucket for postgres services (auth credentials use `REPLACE_ME` placeholders since Dokku doesn't expose stored secrets)

## [0.8.0] - 2026-03-05

### Breaking

- **`services:` key removed** — replaced with dedicated `postgres:` and `redis:` top-level keys. The `plugin` field is no longer needed (implicit from the key). See the updated README for the new format.

### Added

- Dedicated `postgres:` top-level key with support for `version`, `image`, and `backup` (S3-compatible automated backups)
- Dedicated `redis:` top-level key with support for `version` and `image`
- Cross-plugin link resolution — `links:` references are resolved across both `postgres:` and `redis:` sections
- Export discovers postgres and redis services from server state via `postgres:list`/`redis:list`

### Changed

- Validator cross-field checks now scan `postgres:`/`redis:` instead of `services:`

## [0.7.0] - 2026-03-05

### Added

- `export` command now discovers and exports services (postgres, redis) from server state, including custom images

## [0.6.13] - 2026-03-05

### Fixed

- Shell-quote arguments sent over SSH to prevent cron schedules and other space-containing values from being split by the remote shell

## [0.6.12] - 2026-03-05

### Fixed

- NetworkProps resource now reads `attach-post-create`, `initial-network`, `bind-all-interfaces`, and `tld` from server state, removing `forceApply`
- `export` and `diff` now show `network` properties (e.g. `attach_post_create`) for apps that use them

## [0.6.11] - 2026-03-05

### Added

- `export` command now masks sensitive values by default, with `--sensitive` flag to reveal

## [0.6.10] - 2026-03-05

### Added

- `diff` command now masks sensitive values (TOKEN, SECRET, PASSWORD, KEY, AUTH, CREDENTIAL) by default
- `--sensitive` flag on `diff` to reveal full values
- `maskSensitiveData` for deep-masking values in data structures (env vars, build args)

## [0.6.9] - 2026-03-05

### Changed

- Restored bulk `readAll` for Builder, DockerOptions, and `plugin:list` — these work correctly via SSH mode (`DOKKU_HOST`), which is the recommended way to run on the server

## [0.6.8] - 2026-03-05

### Fixed

- Plugin detection now uses `plugin:installed` per-plugin check instead of `plugin:list` bulk query, which fails from Node subprocess due to Dokku basher issues

## [0.6.7] - 2026-03-05

### Fixed

- Builder and DockerOptions resources no longer use bulk `readAll` — these Dokku plugins don't support bulk mode (no app arg) from Node subprocesses due to basher environment issues
- Removed debug logging from `dokku.ts` and `context.ts`

## [0.6.3] - 2026-03-05

### Added

- `DOKKU_COMPOSE_DEBUG=1` env var to trace builder readAll parsing

## [0.6.2] - 2026-03-04

### Fixed

- `parseBulkReport` now handles multi-word namespaces (e.g. `docker options`) in report headers
- Certs bulk report uses correct `ssl` namespace matching real Dokku output

## [0.6.1] - 2026-03-04

### Added

- DockerOptions resource now reads from `docker-options:report`, removing `forceApply`
- `docker_options` now appear in `export` and `diff` output

### Fixed

- DockerOptions `onChange` uses targeted add/remove instead of clearing all options, preventing loss of `--link` and `--build-arg` entries managed by other resources

## [0.6.0] - 2026-03-04

### Added

- Build properties (`dockerfile`, `app_json`, `context`, `args`) now appear in `export` and `diff` output
- Builder resource reads current state from Dokku reports instead of blindly reapplying

### Fixed

- Plugin detection now uses realistic `plugin:list` output parsing with bulk query (single SSH call)
- `parseReport` now handles hyphenated namespaces (`builder-dockerfile`, `app-json`, `docker-options`)

## [0.5.2] - 2026-03-04

### Fixed

- Sensitive value masking now handles values containing `=` (e.g. base64 tokens)

## [0.5.1] - 2026-03-04

### Changed

- `--dry-run` now queries real server state, only showing commands that would actually change something
- Sensitive env var values (TOKEN, SECRET, PASSWORD, KEY, AUTH, CREDENTIAL) are masked in dry-run output by default, showing last 4 chars
- Added `--sensitive` flag to reveal full values in dry-run output

## [0.5.0] - 2026-03-04

### Added

- Bulk prefetch via `readAll` on resources for ~10x fewer SSH calls in `export` and `diff`
- `parseBulkReport` for multi-app Dokku report parsing
- `readAll` support for property, list, toggle, certs, networks, and git resources

## [0.4.0] - 2026-03-04

### Added

- Resource reconciler with generic `Resource` interface and `reconcile` loop
- `computeChange` with scalar, list, and map diffing
- `Context` with cached queries and command recording
- Resource definitions for all modules: property, list, toggle, lifecycle, config, certs, docker-options, builder, git, checks, and network
- Git module (`git:initialize` + `deploy-branch`)
- Service backup configuration (`backup-auth` + `backup-schedule`)
- `${VAR}` environment variable interpolation in config loader
- `--image` and `--image-version` flags on service create

### Changed

- Rewrote `export` and `diff` commands using resource registry
- Wired resource registry into `up` command
- Unified on `Context` everywhere, removed `Runner` passthrough
- Removed old module files replaced by resource definitions

### Fixed

- Idempotent `nginx:set` with `proxy:build-config` on change
- Logging consistency in nginx and git modules
- Pass `--image` and `--image-version` flags on service create
