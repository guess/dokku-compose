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

Dokku is a battle-tested, single-server PaaS — and one of the best platforms for self-hosting. But configuring it means running dozens of imperative commands in the right order. Miss one and your deploy breaks. Change servers and you're starting over.

AI agents can generate and deploy code better than ever, but they can't reason about infrastructure that lives as a sequence of shell commands. There's no file to diff, no history to track, no way to review changes in a PR.

`dokku-compose` makes Dokku declarative. One YAML file. Git-trackable. AI-friendly. Like Docker Compose, but for Dokku.

## Quick Start

```bash
npm install -g dokku-compose
```

Requires Node.js >= 20. See the [Installation Reference](docs/reference/install.md) for details.

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
| `--remove-orphans` | Destroy services and networks not in config |
| `--verbose` | Show git-style +/- diff (diff command only) |

## Features

All features are idempotent — running `up` twice produces no changes.

| Feature | Description | Reference |
|---------|-------------|-----------|
| Apps | Create and destroy Dokku apps | [apps](docs/reference/apps.md) |
| Environment Variables | Set config vars per app or globally, with full convergence | [config](docs/reference/config.md) |
| Build | Dockerfile path, build context, app.json, build args | [builder](docs/reference/builder.md) |
| Docker Options | Custom Docker options per phase (build/deploy/run) | [docker_options](docs/reference/docker_options.md) |
| Networks | Create shared Docker networks, attach to apps | [network](docs/reference/network.md) |
| Domains | Configure domains per app or globally | [domains](docs/reference/domains.md) |
| Port Mappings | Map external ports to container ports | [ports](docs/reference/ports.md) |
| SSL Certificates | Add or remove SSL certs | [certs](docs/reference/certs.md) |
| Proxy | Enable/disable proxy, select implementation | [proxy](docs/reference/proxy.md) |
| Storage | Persistent bind mounts with full convergence | [storage](docs/reference/storage.md) |
| Nginx | Set any nginx property per app or globally | [nginx](docs/reference/nginx.md) |
| Zero-Downtime Checks | Configure deploy checks, disable per process type | [checks](docs/reference/checks.md) |
| Log Management | Log retention and vector sink configuration | [logs](docs/reference/logs.md) |
| Plugins | Install Dokku plugins declaratively | [plugins](docs/reference/plugins.md) |
| Postgres | Postgres services with optional S3 backups | [postgres](docs/reference/postgres.md) |
| Redis | Redis service instances | [redis](docs/reference/redis.md) |
| Service Links | Link postgres/redis services to apps | [plugins](docs/reference/plugins.md#linking-services-to-apps-appsapplinks) |

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
│       └── *.test.ts         # Unit tests per module
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

# Run a specific module's tests
bun test src/modules/postgres.test.ts
```

Tests use [Bun's test runner](https://bun.sh/docs/cli/test) with a mocked `Runner` — no real Dokku server needed.

```bash
# Cut a release (bumps version, tags, pushes — CI publishes to npm)
scripts/release.sh 0.3.0
```

## License

[MIT](LICENSE)
