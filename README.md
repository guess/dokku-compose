# dokku-compose

- 📄 **Declarative** -- One YAML file for your entire Dokku server. Git-trackable, reviewable, reproducible
- 🔁 **Idempotent** -- Run it twice, nothing changes. Safe to re-run anytime
- 👀 **Dry-run** -- Preview every command before it touches your server
- 🔍 **Diff** -- See exactly what's out of sync before applying changes
- 📤 **Export** -- Reverse-engineer an existing server into a config file

[![Tests](https://github.com/guess/dokku-compose/actions/workflows/tests.yml/badge.svg)](https://github.com/guess/dokku-compose/actions/workflows/tests.yml)
[![License: MIT](https://img.shields.io/github/license/guess/dokku-compose)](LICENSE)
[![Latest Release](https://img.shields.io/github/v/release/guess/dokku-compose)](https://github.com/guess/dokku-compose/releases/latest)

<p align="center">
  <img src="assets/dokku-compose.png" alt="dokku-compose" width="300">
</p>

## Why

[Dokku](https://dokku.com) is a battle-tested, single-server PaaS — and one of the best platforms for self-hosting. But configuring it means running dozens of imperative commands in the right order. Miss one and your deploy breaks. Change servers and you're starting over.

AI agents can generate and deploy code better than ever, but infrastructure as shell history can't be diffed, reviewed, or reproduced.

`dokku-compose` makes Dokku declarative. One YAML file. Git-trackable. Agent-friendly. 

Like Docker Compose, but for Dokku.

## Quick Start

```bash
npm install -g dokku-compose
```

Requires Node.js >= 20 and a server running Dokku >= 0.38.32 (every server command stops on an older one; dokku-compose never installs or upgrades Dokku). See the [Installation Reference](docs/reference/install.md) for details.

### 1. Export your existing server

Point at your Dokku server and generate a config file from its current state:

```bash
DOKKU_HOST=my-server.example.com dokku-compose export -o dokku-compose.yml
```

This produces a complete `dokku-compose.yml` reflecting everything on the server — apps, services, domains, env vars, and more.

### 2. See what's in sync

```bash
dokku-compose diff
```

```
  app: api
    (in sync)
  app: worker
    ~ env: 1 → 2 items
    + ports: (not set on server)

  1 resource(s) out of sync.
```

When `diff` says a box is in sync, `up` runs no command on it. `diff` also covers the top-level `domains:`, `env:`, `nginx:`, `logs:`, `scheduler:`, `registry:`, `checks:`, `ps:`, `build:`, `network:`, `proxy:` and `git:` (under `global`; log sinks are masked), shared networks and storage entries (`volumes:`) missing or different on the server, and a replaced `ssl.certfile` (compared with the installed certificate). `diff --verbose` prints `Everything in sync.` when nothing differs. `diff` also notes, by name only, each app env key the file does not declare (a key set by hand or by a script); a note is not drift and never changes the exit code. List the keys something else sets under the app's `env_external:` and `diff` stops noting them ([config](docs/reference/config.md#keys-set-elsewhere-appsappenv_external)).

### 3. Preview changes

```bash
dokku-compose up --dry-run
```

```
[worker    ] Setting 2 env var(s)... (dry run)
[worker    ] Setting ports http:5000:5000... (dry run)

# Commands that would run:
dokku config:set --no-restart worker APP_ENV=production WORKER_COUNT=****
dokku ports:set worker http:5000:5000
```

### 4. Apply

```bash
dokku-compose up
```

Running `up` again produces no changes — every step checks current state before acting.

#### Apps that need a restart

`up` applies env, storage, links and Docker options without restarting anything, so the changes wait for a restart. It ends by listing each app it changed that way, with the exact command (`dokku ps:rebuild <app>` for settings only a rebuild applies, which replaces the restart line for an app needing both) (`would need` on `--dry-run`, also after a partial failure). It never runs the restart and has no `--restart` flag.

```
# Apps that need a restart or rebuild:
dokku ps:restart worker  # env, storage
```

| Change | Listed | Evidence (Dokku 0.38.31) |
|--------|--------|--------------------------|
| `env` set or unset, per app | yes | applied with `--no-restart` |
| top-level `env:` | yes, every app the run processes, when a global key is set or unset | global env is read when a container starts |
| `storage` mount or unmount | yes | persistent-storage docs: "the app requires a restart" |
| `docker_options` deploy and run | yes | docker-options docs: applies "only to containers created after" the change |
| `links` link or unlink | yes | applied with `--no-restart` |
| `network` `tld`, `bind_all_interfaces` | yes | read when containers start |
| top-level `network:` `tld`, `bind_all_interfaces` | yes, every app the run processes | as above |
| `networks`, `network` `attach_post_create`, `initial_network` | rebuild: `dokku ps:rebuild <app>` | network docs (network.md:210): "A change in these values will require an app deploy or rebuild" |
| top-level `network:` `attach_post_create`, `attach_post_deploy`, `initial_network` | rebuild, every app the run processes | as above |
| `docker_options` build, `build.args`, `build.dockerfile`, `app_json`, `context` | rebuild | read by a build, which a restart does not run |
| top-level `build:` `selected`, `context`, `dockerfile`, `app_json` | rebuild, every app the run processes | as above |
| `ports` | no | `ports:set` fires `post-proxy-ports-update`, which rebuilds the nginx config |
| `domains`, `nginx`, `proxy`, `certs`, `logs`, `checks`, `registry`, `scheduler`, `git`, and their top-level blocks | no | applied live or read at deploy |
| `scale`, `ps`, top-level `ps:` | no | `--skip-deploy`: takes effect on the next deploy |

A top-level (global) change also reaches apps that are not in the file or that the run filtered out. The summary lists only the apps the run processes, so restart or rebuild the others yourself.

## Commands

| Command | Description |
|---------|-------------|
| `dokku-compose up [apps...]` | Create/update apps and services to match config |
| `dokku-compose down --force [apps...]` | Destroy apps and services (requires `--force`) |
| `dokku-compose diff` | Show what's out of sync between config and server |
| `dokku-compose export` | Export current server state to YAML |
| `dokku-compose ps [apps...]` | Show status of configured apps |
| `dokku-compose validate [file]` | Validate config file offline (no server contact); an unknown key anywhere in the file is an error |
| `dokku-compose init [apps...]` | Create a starter `dokku-compose.yml` |

### Options

| Option | Description |
|--------|-------------|
| `-f, --file <path>` | Config file (default: `dokku-compose.yml`); `validate` takes the file as an argument instead |
| `--dry-run` | `up` only: print commands without executing |
| `--sensitive` | `up`, `diff` and `export`: show sensitive values in output (masked by default) |
| `--fail-fast` | `up` and `down`: stop on first error (default: continue to next app) |
| `--prune` | `up` only: also reset settings the file no longer declares (read `diff` first) |
| `--force` | `down` only: required to destroy anything |
| `--app <app>` | `export` only: export one app |
| `-o, --output <path>` | `export` only: write to a file instead of stdout |
| `--verbose` | Show git-style +/- diff (diff command only) |

### Settings removed from the file

`diff` marks with a red `-` every setting the server still has that the file no longer declares
(managed env keys, nginx, logs, registry, scheduler, checks, `ps`, network, proxy and git
<<<<<<< HEAD
properties, build settings and args, and entries missing from a declared list), including when the whole block is gone. A key set globally on the server that a declared top-level block (`nginx:`, `logs:`, `scheduler:`, `registry:`, `checks:`, `ps:`, `build:`, `network:`, `proxy:`, `git:`) no longer lists is shown too, under `global`; a top-level block that is absent from the file is never read, so settings made outside the file stay. Only
=======
properties, build settings and args, postgres/redis `properties`, and entries missing from a declared list), including when the whole block is gone. Only
>>>>>>> 147f824 (fix(services): Reject service-memory, plan pass-through keys in dry-run, read linked apps from info (F8))
settable keys count, never read-only report lines, and a `-` counts as drift. It also warns when
an app has no `links:` but has services linked on the server, because `up` unlinks them.

`up` always unsets env keys removed from the file. For every other removal it leaves the setting in place and prints a one-line count per app of the leftovers it noticed in the blocks you declare; it does not look at removed whole blocks, and does not count checks. Run `dokku-compose diff` for the full list.

**`up --prune`** resets those leftovers. Read `diff` first: every `-` it shows for the resources below is what `--prune` will reset, and there is no prompt (`diff` is the preview, the flag is the consent). Add `--dry-run` to print the reset commands without running them.

| Resource | Reset command |
|----------|---------------|
| `nginx`, `logs`, `registry`, `ps` (not the Dokku-written `ps` key `restore`) | `<plugin>:set <app> <key>` with no value (Dokku's default); nginx then rebuilds the proxy config |
| top-level `nginx`, `logs`, `scheduler`, `registry`, `checks`, `ps`, `build`, `network`, `proxy`, `git` (only the keys of a block the file declares) | `<plugin>:set --global <key>` with no value (`builder:set`, `builder-dockerfile:set` and `app-json:set` for `build`; `network` never clears `attach_post_deploy`) |
| `scheduler` | `scheduler:set <app> selected` or `shell` |
| `proxy` properties | `proxy:set <app> type` with no value (`proxy-port` and `proxy-ssl-port` are written by Dokku) |
| `network` properties | `network:set <app> <key>` with no value (`attach_post_create` becomes `attach-post-create`, and so on) |
| `checks` | `checks:enable <app> <type,type>` for the process types of a removed `disabled`/`skipped` list that the file declares in no list (a type the file does declare is left, with a warning naming the command to run by hand), `checks:set <app> wait-to-retire` |
| `build.selected`, `build.skip_cleanup` | `builder:set <app> selected` / `skip-cleanup` with no value |
| `git` (`keep_git_dir`, and a `deploy_branch` equal to the top-level `git:` one that the app does not declare, which is a copy; `source_image`, `rev_env_var` and any other `deploy_branch` are never reset) | `git:set <app> keep-git-dir` / `deploy-branch` with no value |
| `postgres`/`redis` `properties` | `<plugin>:set <service> <key>` with no value for a known key the file dropped (never `password`); `mounts` is never cleared because its key is missing, only `mounts: []` clears it |
| `build.args` | `docker-options:remove <app> build "--build-arg KEY=VALUE"` for each stale key, by the exact option text (every occurrence); other build options stay |

It covers a block that is gone from the file as well as keys removed from a declared block, and it reads the app once more for a block the file no longer has. `--prune` never destroys an app, service, network or storage entry, never uninstalls a plugin, never changes `scale`, never clears a `chown` or `mode` removed from a `volumes:` entry, and does not clear whole `domains`, `ports`, `storage` or `networks` lists because their key is missing (those already prune inside a block the file declares). `proxy.enabled` is not a removal (`type` is). `networks:` owns `attach-post-deploy`: `--prune` does not touch it, and a missing `networks:` key does not clear it (that could detach a running app from its network on the next deploy); `networks: []` does. After `up --prune`, `diff` shows no `-` for the resources above, except for checks that were skipped with a warning (their `-` lines stay).

### Order of a run

`up` applies the host and global settings first, then each app. The global part runs in this order: version check, plugins and Docker auth, global `domains`, `env`, `logs`, `nginx`, `scheduler`, `registry`, `checks`, `ps`, `build`, `proxy` and `git`, then the shared `networks` are created, the global `network` properties are set and the `volumes:` entries are created, then services. Every app is processed after all of that, so a per-app value, or a `--prune` that clears one, always meets the final global value. The top-level blocks are Dokku's own `--global` settings: Dokku does the inheritance, and a block that is absent from the file is never touched.

### Errors

A failing Dokku command (mutation) is never reported as a success. On `up` and `down`, a
global-phase failure (plugins, docker auth, global config such as the top-level settings, networks, services) aborts the whole
run immediately. A per-app failure is printed with the command and Dokku's error output, and by
default the run continues to the next app, exiting non-zero at the end with a summary of which
apps or services failed (a datastore service whose `properties:` the plugin refuses is reported the same way); pass `--fail-fast` to stop at the first failure instead. `diff` never reports a
resource as missing when it could not actually read server state — it falls back to a per-app
read and, if that's unreadable too, marks the resource `unknown` and exits non-zero with a
warning naming what it couldn't read.

## Features

All features are idempotent — running `up` twice produces no changes.

| Feature | Description | Reference |
|---------|-------------|-----------|
| Apps | Create and destroy Dokku apps | [apps](docs/reference/apps.md) |
| Dokku Version | Stop when the server runs Dokku older than 0.38.32; `dokku.version` in the file is a hard minimum for `up` | [dokku](docs/reference/dokku.md) |
| Environment Variables | Set config vars per app or globally, with full convergence (keys removed from the YAML are unset) | [config](docs/reference/config.md) |
| Build | Dockerfile path, build context, app.json, builder selection per app or globally, build args | [builder](docs/reference/builder.md) |
| Docker Options | Custom Docker options per phase (build/deploy/run) | [docker_options](docs/reference/docker_options.md) |
| Networks | Create shared Docker networks, attach to apps, set network properties per app or globally | [network](docs/reference/network.md) |
| Domains | Configure domains per app or globally | [domains](docs/reference/domains.md) |
| Port Mappings | Map external ports to container ports | [ports](docs/reference/ports.md) |
| SSL Certificates | Add, replace or remove SSL certs | [certs](docs/reference/certs.md) |
| Proxy | Enable/disable proxy, select implementation per app or globally | [proxy](docs/reference/proxy.md) |
| Storage | Named storage entries (`volumes:`) with owner and mode, mounted into apps by name and converged with `storage:mount --replace` | [storage](docs/reference/storage.md) |
| Nginx | Set any nginx property per app or globally | [nginx](docs/reference/nginx.md) |
| Scheduler | Select the scheduler and shell per app or globally (`scheduler:set`) | [scheduler](docs/reference/scheduler.md) |
| Registry | Image repo, template, push and server properties per app or globally (`registry:set`) | [registry](docs/reference/registry.md) |
| Git | `deploy_branch`, `keep_git_dir`, `rev_env_var`, `source_image` per app; top-level `git:` sets the global `deploy_branch`, `keep_git_dir`, `archive_max_files`, `archive_max_size` (`git:set --global`) | [git](docs/reference/git.md) |
| Zero-Downtime Checks | Configure deploy checks, disable per process type, set `wait-to-retire` globally | [checks](docs/reference/checks.md) |
| Log Management | Log retention and vector sink configuration | [logs](docs/reference/logs.md) |
| Plugins | Install Dokku plugins at pinned versions, updating forward only | [plugins](docs/reference/plugins.md) |
| Process Scale & ps | Declare process counts (`ps:scale`) and ps properties per app or globally (`ps:set`) | [scale](docs/reference/scale.md) |
| Docker Auth | Authenticate the host docker daemon to private registries (e.g. ghcr.io) for `git:from-image` flows | [docker_auth](docs/reference/docker_auth.md) |
| Postgres | Postgres services with settings (`properties:`: memory, networks, restart policy, password, custom env, …), mounts and optional S3 backups, encrypted or not, all read from `postgres:info` so drift shows in `diff`; a changed version or image shows in `diff` | [postgres](docs/reference/postgres.md) |
| Redis | Redis service instances with the same properties, mounts and optional S3 backups | [redis](docs/reference/redis.md) |
| Service Links | Link postgres/redis services to apps, with `alias`, `env_var` or `querystring` | [links](docs/reference/links.md) |

### Global defaults

A top-level `nginx`, `logs`, `scheduler`, `registry`, `checks`, `ps`, `build`, `network`, `proxy` or `git` block is Dokku's own `--global` setting for that namespace: apps without their own value inherit it, and Dokku does the inheriting. The keys are the per-app ones that Dokku accepts globally.

```yaml
git:
  deploy_branch: main        # git:set --global deploy-branch main
registry:
  server: registry.example.com
checks:
  wait-to-retire: 30
network:
  attach_post_deploy: [backend-net]   # `networks:` creates networks; `network:` sets properties
```

`diff` shows these under `global`, `up --prune` clears a key that left a declared block, and a block the file does not declare is never touched. The top-level `git:` used to be copied onto each app; see the [upgrade note](CHANGELOG.md) and [git](docs/reference/git.md#migrating-from-the-old-top-level-git).

## Variable interpolation

`${VAR}` in a string value is replaced with the environment variable `VAR`. The file is parsed as YAML first and substituted afterwards, value by value, so a secret can contain any character (`"`, `'`, `#`, `\`, `:`, newlines) and arrives in the value unchanged; it can never change the file's structure. Keys and comments are never substituted. Every unset or empty variable is collected and reported together:

```
Unset environment variable(s) referenced in config: R2_HOST, GITHUB_TOKEN
```

To write a literal `${`, use `$${`: `"$${NOT_A_VAR}"` loads as `${NOT_A_VAR}`.

Because substitution happens after parsing, a value that is a bare `${VAR}` is always a string, and a variable cannot inject YAML (extra keys, lists, quoting). Earlier versions substituted into the raw text, so anything that relied on that must now be written in the file.

## Execution Modes

```bash
# Run remotely over SSH (recommended)
DOKKU_HOST=my-server.example.com dokku-compose up

# Run on the Dokku server itself
DOKKU_HOST=localhost dokku-compose up
```

When `DOKKU_HOST` is set, all commands are sent over SSH. This is the recommended mode — it works both remotely and on the server. SSH key access to the Dokku server is required.

## Architecture

<details>
<summary>File structure</summary>

```
dokku-compose/
├── bin/
│   └── dokku-compose         # Entry point (delegates to src/index.ts via tsx)
├── src/
│   ├── index.ts              # CLI entry point (Commander.js)
│   ├── core/
│   │   ├── schema.ts         # Zod config schema and types
│   │   ├── config.ts         # YAML loading and parsing
│   │   ├── dokku.ts          # Runner interface and factory
│   │   └── logger.ts         # Colored output helpers
│   ├── resources/            # Per-app resources, reconciled by core/reconcile.ts
│   │   ├── lifecycle.ts      # dokku apps:create/destroy
│   │   ├── lists.ts          # ports:*, domains:*
│   │   ├── storage.ts        # storage:mount --replace, storage:unmount (per app)
│   │   ├── properties.ts     # nginx:*, logs:*, registry:*, scheduler:*
│   │   ├── toggle.ts         # proxy:*
│   │   ├── network.ts        # network:*
│   │   ├── certs.ts          # certs:*
│   │   ├── checks.ts         # checks:*
│   │   ├── config.ts         # config:* (per app)
│   │   ├── builder.ts        # builder:*, builder-dockerfile:*, app-json:*
│   │   ├── docker-options.ts # docker-options:*
│   │   ├── git.ts            # git:*
│   │   └── ps.ts             # ps:scale, ps:set
│   ├── modules/              # Global and service steps, and the Dokku version check
│   │   ├── config.ts         # dokku config:* (global)
│   │   ├── docker-auth.ts    # docker login for docker_auth
│   │   ├── domains.ts        # dokku domains:* (global)
│   │   ├── global.ts         # <ns>:set --global for the top-level nginx, logs, scheduler, registry, checks, ps, build, network, proxy and git blocks
│   │   ├── links.ts          # Service link resolution across plugins
│   │   ├── logs.ts           # dokku logs:* (per-app helpers)
│   │   ├── network.ts        # dokku network:create
│   │   ├── nginx.ts          # dokku nginx:* (per-app helpers)
│   │   ├── plugins.ts        # dokku plugin:*
│   │   ├── postgres.ts       # dokku postgres:* (create, export)
│   │   ├── redis.ts          # dokku redis:* (create, export)
│   │   ├── service-backup.ts # <plugin>:backup-* and set backup-* (postgres and redis)
│   │   ├── service-properties.ts # <plugin>:set, mount, unmount, create flags (postgres and redis)
│   │   ├── service-property-keys.ts # the built-in table of property keys
│   │   └── version.ts        # Dokku version check
│   ├── commands/
│   │   ├── up.ts             # up command orchestration
│   │   ├── down.ts           # down command orchestration
│   │   ├── export.ts         # export command
│   │   ├── diff.ts           # diff command
│   │   └── validate.ts       # validate command (offline)
│   └── tests/
│       ├── fixtures/         # Test YAML configs
│       └── *.test.ts         # Unit tests, beside src/modules and src/resources
└── dokku-compose.yml.example
```

Each `src/resources/*.ts` file defines resources that `up`, `diff` and `export` share; `src/modules/*.ts` holds the global and service steps. See [CLAUDE.md](CLAUDE.md) for development conventions.

</details>

## Development

```bash
git clone https://github.com/guess/dokku-compose.git
cd dokku-compose
bun install

# Run all tests
bun test

# Run a specific file's tests
bun test src/resources/config.test.ts
```

Tests use [Bun's test runner](https://bun.sh/docs/cli/test) with a mocked `Runner` — no real Dokku server needed.

```bash
# Cut a release (bumps version, tags, pushes — CI publishes to npm)
scripts/release.sh 0.3.0
```

## License

[MIT](LICENSE)
