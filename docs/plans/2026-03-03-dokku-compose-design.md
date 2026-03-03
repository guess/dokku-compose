# dokku-compose Design Document

**Date**: 2026-03-03
**Status**: Approved

## Overview

dokku-compose is a general-purpose Dokku deployment orchestrator. It reads a declarative YAML config file (`dokku-compose.yml`) and idempotently configures a Dokku server — creating apps, linking services, setting ports, SSL, environment variables, and more.

**Language**: Bash + [yq](https://github.com/mikefarah/yq) for YAML parsing.

**Philosophy**: Replace Ansible-based Dokku orchestration with a lightweight, zero-dependency bash tool that maps directly to Dokku commands.

## YAML Config Format

```yaml
# dokku-compose.yml

dokku:
  version: "0.35.12"           # Expected Dokku version (warns on mismatch)
  plugins:
    postgres:
      url: https://github.com/dokku/dokku-postgres.git
      version: "1.41.0"        # Optional: pin version
    redis:
      url: https://github.com/dokku/dokku-redis.git

networks:
  - studio-net
  - qultr-net

apps:
  funqtion:
    dockerfile: docker/prod/api/Dockerfile
    app_json: docker/prod/api/app.json
    build_dir: apps/funqtion-api
    ports:
      - "https:4001:4000"
    ssl: certs/funqtion.co
    postgres:
      version: "17-3.5"
      image: postgis/postgis     # Optional image override
    redis:
      version: "7.2-alpine"
    env:
      APP_ENV: "${APP_ENV}"
    build_args:
      SENTRY_AUTH_TOKEN: "${SENTRY_AUTH_TOKEN}"

  studio:
    build_dir: apps/studio-api
    ports:
      - "https:4002:4000"
    ssl: certs/strates.io
    postgres: true               # Shorthand: default version
    redis: true
    networks:
      - studio-net

  qultr:
    build_dir: apps/qultr-api
    ports:
      - "https:4003:4000"
    ssl: certs/qultr.dev
    postgres: true
    redis: true
    nginx:
      client-max-body-size: "15m"
    networks:
      - qultr-net
```

### Config conventions

- **Services as shorthand or objects**: `postgres: true` for defaults, `postgres: { version: "17-3.5" }` for specifics
- **Environment variable interpolation**: `${VAR}` resolved at runtime from the shell environment
- **SSL as path**: Directory containing `cert.crt` and `cert.key`
- **No vhosts by default**: Apps use Tailscale/Cloudflare Tunnel, not domain-based routing
- **Flat structure**: Minimal nesting

## CLI Commands

```
dokku-compose up [--file dokku-compose.yml] [--dry-run] [--fail-fast] [app-name...]
dokku-compose down [--force] [app-name...]
dokku-compose ps
dokku-compose setup
```

### `dokku-compose up`

Main command. Idempotently ensures desired state:

1. Check Dokku version (warn on mismatch)
2. Install missing plugins declared in `dokku.plugins`
3. Create shared networks
4. For each app:
   a. Create app (if not exists)
   b. Disable vhosts
   c. Create + link postgres (if configured)
   d. Create + link redis (if configured)
   e. Attach to networks
   f. Set port mappings
   g. Add SSL certificate
   h. Configure nginx properties
   i. Set environment variables
   j. Configure build settings (dockerfile path, build args)

Flags:
- `--dry-run`: Print commands without executing
- `--fail-fast`: Stop on first error (default: continue to next app)
- `--file <path>`: Specify config file (default: `dokku-compose.yml`)
- App names: Target specific apps (`dokku-compose up studio`)

### `dokku-compose down`

Destroys apps and linked services. Requires `--force` flag.

### `dokku-compose ps`

Shows status of all configured apps: running/stopped, linked services, port mappings.

### `dokku-compose setup`

One-time server bootstrapping: installs Dokku at the declared version.

## Execution Modes

- **Server mode** (default): If `dokku` is available locally, runs commands directly
- **Remote mode**: If `DOKKU_HOST` env var is set (or `host:` in YAML), wraps commands with SSH

```bash
dokku_cmd() {
    if [[ -n "$DOKKU_HOST" ]]; then
        ssh "dokku@${DOKKU_HOST}" "$@"
    else
        dokku "$@"
    fi
}
```

## File Architecture

```
dokku-compose/
├── bin/
│   └── dokku-compose              # Entry point: arg parsing, command dispatch
├── lib/
│   ├── core.sh                    # Logging, colors, dokku_cmd wrapper
│   ├── yaml.sh                    # YAML helpers wrapping yq
│   │
│   │  # One file per Dokku command namespace:
│   ├── apps.sh                    # dokku apps:*
│   │                              # https://dokku.com/docs/deployment/application-management/
│   ├── builder.sh                 # dokku builder-dockerfile:*, app-json:*
│   │                              # https://dokku.com/docs/builders/dockerfiles/
│   ├── config.sh                  # dokku config:*
│   │                              # https://dokku.com/docs/configuration/environment-variables/
│   ├── certs.sh                   # dokku certs:*
│   │                              # https://dokku.com/docs/configuration/ssl/
│   ├── network.sh                 # dokku network:*
│   │                              # https://dokku.com/docs/networking/network/
│   ├── ports.sh                   # dokku ports:*
│   │                              # https://dokku.com/docs/networking/port-management/
│   ├── nginx.sh                   # dokku nginx:*
│   │                              # https://dokku.com/docs/networking/proxies/nginx/
│   ├── postgres.sh                # dokku postgres:* (plugin)
│   │                              # https://github.com/dokku/dokku-postgres
│   ├── redis.sh                   # dokku redis:* (plugin)
│   │                              # https://github.com/dokku/dokku-redis
│   ├── git.sh                     # dokku git:*
│   │                              # https://dokku.com/docs/deployment/methods/git/
│   ├── dokku.sh                   # Dokku version check, installation
│   │                              # https://dokku.com/docs/getting-started/installation/
│   └── plugins.sh                 # dokku plugin:*
│                                  # https://dokku.com/docs/advanced-usage/plugin-management/
├── tests/
│   ├── test_helper.bash           # Shared: mock dokku_cmd, fixtures
│   ├── fixtures/
│   │   ├── simple.yml             # Single app, minimal config
│   │   ├── full.yml               # All features exercised
│   │   └── invalid.yml            # Malformed config for error tests
│   ├── apps.bats
│   ├── postgres.bats
│   ├── redis.bats
│   ├── network.bats
│   ├── ports.bats
│   ├── certs.bats
│   ├── nginx.bats
│   ├── config.bats
│   ├── builder.bats
│   └── integration.bats
├── dokku-compose.yml.example
└── README.md
```

Each `lib/*.sh` file:
- Maps to one Dokku command namespace / doc page
- Contains `ensure_<resource>()` and `destroy_<resource>()` functions
- Header comment links to the relevant Dokku documentation
- Can be understood in isolation

## Error Handling

- **Idempotency**: Every `ensure_*` function checks current state before acting. Running `up` twice produces no changes.
- **Failure mode**: Log error and continue to next app (default). `--fail-fast` stops on first error.
- **Missing plugins**: Clear error message with install command.
- **yq dependency**: Auto-install on first run if missing.
- **Exit code**: Non-zero if any errors occurred.

## Output Style

Colored, concise output:

```
[networks] Creating studio-net... done
[networks] Creating qultr-net... done
[funqtion] Creating app... done
[funqtion] Creating postgres (17-3.5)... done
[funqtion] Linking postgres... done
[funqtion] Creating redis (7.2-alpine)... done
[funqtion] Setting ports https:4001:4000... done
[funqtion] Adding SSL certificate... done
[funqtion] Setting 2 env vars... done
[funqtion] Setting dockerfile path... done
[studio]   Creating app... already exists
[studio]   Postgres... already linked
```

## Testing

BATS (Bash Automated Testing System) test suite.

Strategy: Mock the `dokku_cmd` wrapper so tests run without a real Dokku server. Each test verifies correct commands would be called with correct arguments.

## Dependencies

- **bash** >= 4.0
- **yq** >= 4.0 (auto-installed if missing)
- **dokku** (on server) or SSH access (remote mode)
- **BATS** (for tests only)

## Out of Scope (for now)

- 1Password integration (stays in consuming projects)
- Cloudflare Tunnel configuration
- Tailscale setup
- Backup scheduling (could be added later as `postgres.backup` config)
- Monitoring/logging setup
- App deployment (`dokku git:sync`) — this tool configures infrastructure, deployment is separate
