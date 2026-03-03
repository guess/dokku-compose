<p align="center">
  <img src="assets/dokku-compose.png" alt="dokku-compose" width="300">
</p>

# dokku-compose

A declarative Dokku deployment orchestrator. Define your apps, services, and infrastructure in a single YAML file and let `dokku-compose` idempotently configure your Dokku server.

**Philosophy**: Replace Ansible-based Dokku orchestration with a lightweight bash tool that maps directly to Dokku commands.

## Quick Start

**Prerequisites**
```bash
# bash >= 4.0 and yq >= 4.0 (auto-installed if missing)
brew install yq   # or: https://github.com/mikefarah/yq#install
```

**Get Running**
```bash
# 1. Create your config
cp dokku-compose.yml.example dokku-compose.yml
# Edit to match your apps...

# 2. Preview what will happen
dokku-compose up --dry-run

# 3. Apply configuration
dokku-compose up

# 4. Check status
dokku-compose ps
```

## Architecture

```
dokku-compose/
├── bin/
│   └── dokku-compose         # Entry point: arg parsing, command dispatch
├── lib/
│   ├── core.sh               # Logging, colors, dokku_cmd wrapper
│   ├── yaml.sh               # YAML helpers wrapping yq
│   ├── apps.sh               # dokku apps:*, domains:*
│   ├── builder.sh            # dokku builder-dockerfile:*, app-json:*
│   ├── certs.sh              # dokku certs:*
│   ├── config.sh             # dokku config:*
│   ├── dokku.sh              # Dokku version check, installation
│   ├── network.sh            # dokku network:*
│   ├── nginx.sh              # dokku nginx:*
│   ├── plugins.sh            # dokku plugin:*
│   ├── ports.sh              # dokku ports:*
│   ├── postgres.sh           # dokku postgres:* (plugin)
│   └── redis.sh              # dokku redis:* (plugin)
├── tests/
│   ├── test_helper.bash      # Mock dokku_cmd, assertion helpers
│   ├── fixtures/             # Test YAML configs
│   ├── *.bats                # Unit tests per module
│   └── integration.bats      # End-to-end tests
└── dokku-compose.yml.example
```

Each `lib/*.sh` file maps to one Dokku command namespace and contains `ensure_*()` / `destroy_*()` functions.

### Execution Modes

- **Server mode** (default): Runs `dokku` commands directly on the local machine
- **Remote mode**: Set `DOKKU_HOST` to run commands over SSH

```bash
# Run locally on the Dokku server
dokku-compose up

# Run remotely
DOKKU_HOST=my-server.example.com dokku-compose up
```

### What `up` Does

Idempotently ensures desired state, in order:

1. Check Dokku version (warn on mismatch)
2. Install missing plugins
3. Create shared networks
4. For each app:
   - Create app (if not exists)
   - Disable vhosts
   - Create + link PostgreSQL (if configured)
   - Create + link Redis (if configured)
   - Attach to networks
   - Set port mappings
   - Add SSL certificate
   - Configure nginx properties
   - Set environment variables
   - Configure build settings (dockerfile path, build args)

Running `up` twice produces no changes -- every step checks current state before acting.

### Output

```
[networks  ] Creating backend-net... done
[api       ] Creating app... done
[api       ] Creating postgres (17-3.5)... done
[api       ] Linking postgres... done
[api       ] Setting ports https:4001:4000... done
[api       ] Adding SSL certificate... done
[api       ] Setting 2 env vars... done
[worker    ] Creating app... already configured
[worker    ] Postgres... already configured
```

## Config Format

```yaml
# dokku-compose.yml

# Optional: Dokku version and plugins
dokku:
  version: "0.35.12"
  plugins:
    postgres:
      url: https://github.com/dokku/dokku-postgres.git
      version: "1.41.0"
    redis:
      url: https://github.com/dokku/dokku-redis.git

# Shared Docker networks
networks:
  - backend-net

# Application definitions
apps:
  # Full example with all options
  api:
    dockerfile: docker/prod/api/Dockerfile
    app_json: docker/prod/api/app.json
    build_dir: apps/api
    ports:
      - "https:4001:4000"
    ssl: certs/example.com
    postgres:
      version: "17-3.5"
      image: postgis/postgis
    redis:
      version: "7.2-alpine"
    nginx:
      client-max-body-size: "15m"
    env:
      APP_ENV: "${APP_ENV}"
    build_args:
      SENTRY_AUTH_TOKEN: "${SENTRY_AUTH_TOKEN}"
    networks:
      - backend-net

  # Minimal example
  worker:
    build_dir: apps/worker
    ports:
      - "http:5001:5000"
    postgres: true          # shorthand: default version
    networks:
      - backend-net
```

### Conventions

- **Services as shorthand or objects**: `postgres: true` for defaults, `postgres: { version: "17-3.5" }` for specifics
- **Environment variable interpolation**: `${VAR}` resolved at runtime from the shell environment
- **SSL as path**: Directory containing `cert.crt` and `cert.key`
- **No vhosts by default**: Apps use Tailscale/Cloudflare Tunnel, not domain-based routing

## Essential Commands

### Commands

| Command | Description |
|---------|-------------|
| `dokku-compose up` | Create/update apps and services to match config |
| `dokku-compose down --force` | Destroy apps and services (requires `--force`) |
| `dokku-compose ps` | Show status of configured apps |
| `dokku-compose setup` | Install Dokku at declared version |

### Options

| Option | Description |
|--------|-------------|
| `--file <path>` | Config file (default: `dokku-compose.yml`) |
| `--dry-run` | Print commands without executing |
| `--fail-fast` | Stop on first error (default: continue to next app) |
| `--help` | Show usage |
| `--version` | Show version |

### Examples

```bash
dokku-compose up                      # Configure all apps
dokku-compose up myapp                # Configure one app
dokku-compose up --dry-run            # Preview changes
dokku-compose down --force myapp      # Destroy an app
dokku-compose ps                      # Show status
```

## Testing

Tests use [BATS](https://github.com/bats-core/bats-core) with a mocked `dokku_cmd` wrapper -- no real Dokku server needed.

```bash
# Run all tests
./tests/bats/bin/bats tests/

# Run a specific module's tests
./tests/bats/bin/bats tests/postgres.bats
```

## Key Technologies

- **Runtime**: Bash >= 4.0
- **YAML parsing**: [yq](https://github.com/mikefarah/yq) >= 4.0 (auto-installed if missing)
- **Server**: [Dokku](https://dokku.com) (local or via SSH)
- **Testing**: [BATS](https://github.com/bats-core/bats-core) with mocked commands

## Out of Scope

This tool handles infrastructure configuration. The following are intentionally excluded:

- App deployment (`dokku git:sync`) -- deployment is a separate concern
- 1Password / secrets management
- Cloudflare Tunnel / Tailscale configuration
- Backup scheduling
- Monitoring and logging setup
