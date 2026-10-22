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

Requires Node.js >= 20 and a server running Dokku >= 0.38.29 (every server command stops on an older one; dokku-compose never installs or upgrades Dokku). See the [Installation Reference](docs/reference/install.md) for details.

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

When `diff` says a box is in sync, `up` runs no command on it. `diff` also covers the top-level `domains:`, `logs:` and `nginx:` (under `global`; log sinks are masked), shared networks missing on the server, and a replaced `ssl.certfile` (compared with the installed certificate). `diff --verbose` prints `Everything in sync.` when nothing differs. `diff` also notes, by name only, each app env key the file does not declare (a key set by hand or by a script); a note is not drift and never changes the exit code. List the keys something else sets under the app's `env_external:` and `diff` stops noting them ([config](docs/reference/config.md#keys-set-elsewhere-appsappenv_external)).

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
# Apps that need a restart:
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
| `networks`, `network` `attach_post_create`, `initial_network` | rebuild: `dokku ps:rebuild <app>` | network docs (network.md:210): "A change in these values will require an app deploy or rebuild" |
| `docker_options` build, `build.args`, `build.dockerfile`, `app_json`, `context` | rebuild | read by a build, which a restart does not run |
| `ports` | no | `ports:set` fires `post-proxy-ports-update`, which rebuilds the nginx config |
| `domains`, `nginx`, `proxy`, `certs`, `logs`, `checks`, `registry`, `scheduler` | no | applied live or read at deploy |
| `scale`, `ps` | no | `--skip-deploy`: takes effect on the next deploy |

## Commands

| Command | Description |
|---------|-------------|
| `dokku-compose up [apps...]` | Create/update apps and services to match config |
| `dokku-compose down --force [apps...]` | Destroy apps and services (requires `--force`) |
| `dokku-compose diff` | Show what's out of sync between config and server |
| `dokku-compose export` | Export current server state to YAML |
| `dokku-compose ps [apps...]` | Show status of configured apps |
| `dokku-compose validate` | Validate config file offline (no server contact) |
| `dokku-compose init [apps...]` | Create a starter `dokku-compose.yml` |

### Options

| Option | Description |
|--------|-------------|
| `--file <path>` | Config file (default: `dokku-compose.yml`) |
| `--dry-run` | Print commands without executing |
| `--sensitive` | Show sensitive values in output (masked by default) |
| `--fail-fast` | Stop on first error (default: continue to next app) |
| `--prune` | `up` only: also reset settings the file no longer declares (read `diff` first) |
| `--remove-orphans` | Destroy services and networks not in config |
| `--verbose` | Show git-style +/- diff (diff command only) |

### Settings removed from the file

`diff` marks with a red `-` every setting the server still has that the file no longer declares
(managed env keys, nginx, logs, registry, scheduler, checks, `ps`, network, proxy and git
properties, build settings and args, and entries missing from a declared list), including when the whole block is gone. Only
settable keys count, never read-only report lines, and a `-` counts as drift. It also warns when
an app has no `links:` but has services linked on the server, because `up` unlinks them.

`up` always unsets env keys removed from the file. For every other removal it leaves the setting in place and prints a one-line count per app of the leftovers it noticed in the blocks you declare; it does not look at removed whole blocks, and does not count checks. Run `dokku-compose diff` for the full list.

**`up --prune`** resets those leftovers. Read `diff` first: every `-` it shows for the resources below is what `--prune` will reset, and there is no prompt (`diff` is the preview, the flag is the consent). Add `--dry-run` to print the reset commands without running them.

| Resource | Reset command |
|----------|---------------|
| `nginx`, `logs`, `registry`, `ps`, `git` (not Dokku-written keys: `ps` `restore`, git `deploy-branch` and `source-image`) | `<plugin>:set <app> <key>` with no value (Dokku's default); nginx then rebuilds the proxy config |
| `scheduler` | `scheduler:set <app> selected` or `shell` |
| `proxy` properties | `proxy:set <app> type` with no value (`proxy-port` and `proxy-ssl-port` are written by Dokku) |
| `network` properties | `network:set <app> <key>` with no value (`attach_post_create` becomes `attach-post-create`, and so on) |
| `checks` | `checks:enable <app> <type,type>` for the process types of a removed `disabled`/`skipped` list that the file declares in no list (a type the file does declare is left, with a warning naming the command to run by hand), `checks:set <app> wait-to-retire` |
| `build.selected`, `build.skip_cleanup` | `builder:set <app> selected` / `skip-cleanup` with no value |
| `build.args` | `docker-options:remove <app> build "--build-arg KEY=VALUE"` for each stale key, by the exact option text (every occurrence); other build options stay |

It covers a block that is gone from the file as well as keys removed from a declared block, and it reads the app once more for a block the file no longer has. `--prune` never destroys an app, service or network, never uninstalls a plugin, never changes `scale`, and does not clear whole `domains`, `ports`, `storage` or `networks` lists because their key is missing (those already prune inside a block the file declares). `proxy` is not a removal. `networks:` owns `attach-post-deploy`: `--prune` does not touch it, and a missing `networks:` key does not clear it (that could detach a running app from its network on the next deploy); `networks: []` does. After `up --prune`, `diff` shows no `-` for the resources above, except for checks that were skipped with a warning (their `-` lines stay).

### Errors

A failing Dokku command (mutation) is never reported as a success. On `up` and `down`, a
global-phase failure (plugins, docker auth, global config, networks, services) aborts the whole
run immediately. A per-app failure is printed with the command and Dokku's error output, and by
default the run continues to the next app, exiting non-zero at the end with a summary of which
apps failed; pass `--fail-fast` to stop at the first failure instead. `diff` never reports a
resource as missing when it could not actually read server state — it falls back to a per-app
read and, if that's unreadable too, marks the resource `unknown` and exits non-zero with a
warning naming what it couldn't read.

## Features

All features are idempotent — running `up` twice produces no changes.

| Feature | Description | Reference |
|---------|-------------|-----------|
| Apps | Create and destroy Dokku apps | [apps](docs/reference/apps.md) |
| Dokku Version | Warn when the server's Dokku version is older than the pinned floor | [dokku](docs/reference/dokku.md) |
| Environment Variables | Set config vars per app or globally, with full convergence (keys removed from the YAML are unset) | [config](docs/reference/config.md) |
| Build | Dockerfile path, build context, app.json, build args | [builder](docs/reference/builder.md) |
| Docker Options | Custom Docker options per phase (build/deploy/run) | [docker_options](docs/reference/docker_options.md) |
| Networks | Create shared Docker networks, attach to apps | [network](docs/reference/network.md) |
| Domains | Configure domains per app or globally | [domains](docs/reference/domains.md) |
| Port Mappings | Map external ports to container ports | [ports](docs/reference/ports.md) |
| SSL Certificates | Add, replace or remove SSL certs | [certs](docs/reference/certs.md) |
| Proxy | Enable/disable proxy, select implementation | [proxy](docs/reference/proxy.md) |
| Storage | Persistent bind mounts with full convergence (keys removed from the YAML are unset) | [storage](docs/reference/storage.md) |
| Nginx | Set any nginx property per app or globally | [nginx](docs/reference/nginx.md) |
| Scheduler, Registry, Git | `scheduler` (`selected`, `shell`), `registry` and `git` properties per app; every app-scope `:set` key of Dokku 0.38.31 (audit F5), keys Dokku refuses fail `validate` | [logs](docs/reference/logs.md#removal), [audit](docs/dokku-audit.md) |
| Zero-Downtime Checks | Configure deploy checks, disable per process type | [checks](docs/reference/checks.md) |
| Log Management | Log retention and vector sink configuration | [logs](docs/reference/logs.md) |
| Plugins | Install Dokku plugins at pinned versions, updating forward only | [plugins](docs/reference/plugins.md) |
| Process Scale & ps | Declare process counts (`ps:scale`) and ps properties (`ps:set`) | [scale](docs/reference/scale.md) |
| Docker Auth | Authenticate the host docker daemon to private registries (e.g. ghcr.io) for `git:from-image` flows | [docker_auth](docs/reference/docker_auth.md) |
| Postgres | Postgres services with optional S3 backups, read from `postgres:info` so backup drift shows in `diff`; a changed version or image shows in `diff` | [postgres](docs/reference/postgres.md) |
| Redis | Redis service instances | [redis](docs/reference/redis.md) |
| Service Links | Link postgres/redis services to apps, with `alias`, `env_var` or `querystring` | [plugins](docs/reference/plugins.md#linking-services-to-apps-appsapplinks) |

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
│   ├── modules/              # One file per Dokku namespace
│   │   ├── apps.ts           # dokku apps:*
│   │   ├── builder.ts        # dokku builder:*, builder-dockerfile:*, app-json:*
│   │   ├── certs.ts          # dokku certs:*
│   │   ├── checks.ts         # dokku checks:*
│   │   ├── config.ts         # dokku config:*
│   │   ├── docker_options.ts # dokku docker-options:*
│   │   ├── domains.ts        # dokku domains:*
│   │   ├── logs.ts           # dokku logs:*
│   │   ├── network.ts        # dokku network:*
│   │   ├── nginx.ts          # dokku nginx:*
│   │   ├── plugins.ts        # dokku plugin:*
│   │   ├── ports.ts          # dokku ports:*
│   │   ├── proxy.ts          # dokku proxy:*
│   │   ├── registry.ts       # dokku registry:*
│   │   ├── scheduler.ts      # dokku scheduler:*
│   │   ├── postgres.ts       # dokku postgres:* (create, backup, export)
│   │   ├── redis.ts          # dokku redis:* (create, export)
│   │   ├── links.ts          # Service link resolution across plugins
│   │   └── storage.ts        # dokku storage:*
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

Each `src/modules/*.ts` file maps to one Dokku command namespace and exports `ensure*()`, `destroy*()`, and `export*()` functions. See [CLAUDE.md](CLAUDE.md) for development conventions.

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
