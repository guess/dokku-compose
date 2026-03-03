# dokku-compose

- 📄 **Declarative** -- Define your entire Dokku server in a single YAML file
- 🔁 **Idempotent** -- Run it twice, nothing changes. Safe to re-run anytime
- 👀 **Dry-run** -- Preview every command before it touches your server
- 🔌 **Zero dependencies** -- Just bash and yq. No Python, no Ruby, no Ansible
- 🏗️ **Modular** -- One file per Dokku namespace. Easy to read, extend, and debug

[![Tests](https://github.com/guess/dokku-compose/actions/workflows/tests.yml/badge.svg)](https://github.com/guess/dokku-compose/actions/workflows/tests.yml)
[![License: MIT](https://img.shields.io/github/license/guess/dokku-compose)](LICENSE)
[![Latest Release](https://img.shields.io/github/v/release/guess/dokku-compose)](https://github.com/guess/dokku-compose/releases/latest)

<p align="center">
  <img src="assets/dokku-compose.png" alt="dokku-compose" width="300">
</p>

## Why

Configuring a Dokku server means running dozens of imperative commands in the right order: create apps, install plugins, link databases, set ports, add certs, configure nginx, set env vars. Miss one and your deploy breaks. Change a server and you're doing it all over again.

`dokku-compose` replaces that with a single YAML file. Describe what you want, run `dokku-compose up`, and it figures out what needs to change. Like Docker Compose, but for Dokku.

## Install

```bash
curl -fsSL https://github.com/guess/dokku-compose/releases/latest/download/dokku-compose \
  | sudo install /dev/stdin /usr/local/bin/dokku-compose
```

Or install a specific version:

```bash
VERSION=0.2.0
curl -fsSL "https://github.com/guess/dokku-compose/releases/download/v${VERSION}/dokku-compose" \
  | sudo install /dev/stdin /usr/local/bin/dokku-compose
```

### Requirements

| Dependency | Version | Notes |
|------------|---------|-------|
| Bash | >= 4.0 | Ships with most Linux distros |
| [yq](https://github.com/mikefarah/yq) | >= 4.0 | Auto-installed on servers if running as root |
| [Dokku](https://dokku.com) | any | Local or remote via `DOKKU_HOST` |

## Quick Start

```bash
# Install
curl -fsSL https://github.com/guess/dokku-compose/releases/latest/download/dokku-compose \
  | sudo install /dev/stdin /usr/local/bin/dokku-compose

# Copy the example config and edit it
cp dokku-compose.yml.example dokku-compose.yml

# Install Dokku on a fresh server (optional, requires root)
dokku-compose setup

# Preview what will happen
dokku-compose up --dry-run

# Apply configuration (locally on the Dokku server)
dokku-compose up

# Or apply to a remote server over SSH
DOKKU_HOST=my-server.example.com dokku-compose up
```

## Features

Features are listed roughly in execution order — the sequence `dokku-compose up` follows.

### Dokku Version Check

Declare the expected Dokku version. A warning is logged if the running version doesn't match.

```yaml
dokku:
  version: "0.35.12"
```

```
[dokku      ] WARN: Version mismatch: running 0.34.0, config expects 0.35.12
```

Use `dokku-compose setup` to install Dokku at the declared version on a fresh Ubuntu/Debian server. It only handles fresh installs — if Dokku is already installed at a different version, it will print an upgrade link and exit. Requires root.

### Plugin Management

Declare required plugins with optional version pinning. Already-installed plugins are skipped.

```yaml
dokku:
  plugins:
    postgres:
      url: https://github.com/dokku/dokku-postgres.git
      version: "1.41.0"
    redis:
      url: https://github.com/dokku/dokku-redis.git
    letsencrypt:
      url: https://github.com/dokku/dokku-letsencrypt.git
```

```
dokku plugin:install https://github.com/dokku/dokku-postgres.git --committish 1.41.0
dokku plugin:install https://github.com/dokku/dokku-redis.git
dokku plugin:install https://github.com/dokku/dokku-letsencrypt.git
```

### Networks

Create shared Docker networks for inter-app communication and attach apps to them.

```yaml
networks:
  - backend-net
  - worker-net

apps:
  api:
    networks:
      - backend-net

  worker:
    networks:
      - backend-net
      - worker-net
```

```
dokku network:create backend-net
dokku network:create worker-net
dokku network:set api attach-post-deploy backend-net
dokku network:set worker attach-post-deploy backend-net worker-net
```

Networks are created once globally, then attached per-app.

### Application Management

Create and destroy Dokku apps idempotently. If the app already exists, it's skipped. ([full reference](docs/reference/apps.md))

```yaml
apps:
  api:
    # per-app configuration goes here
```

```
dokku apps:create api
```

### Domains

Configure custom domains per app. When domains are declared, vhosts are enabled and the domains are set atomically. When omitted, vhosts are disabled.

```yaml
apps:
  api:
    domains:
      - api.example.com
      - api.example.co
```

```
dokku domains:enable api
dokku domains:set api api.example.com api.example.co
```

### Port Mappings

Map external ports to container ports. Supports `http` and `https` schemes.

```yaml
apps:
  api:
    ports:
      - "https:4001:4000"

  worker:
    ports:
      - "http:5001:5000"
```

```
dokku ports:set api https:4001:4000
dokku ports:set worker http:5001:5000
```

Ports are compared against current state — if they already match, the command is skipped.

### SSL Certificates

Point to a directory containing `cert.crt` and `cert.key`. The files are tarred and piped to Dokku.

```yaml
apps:
  api:
    certs: certs/example.com
```

```
tar cf - -C certs/example.com cert.crt cert.key | dokku certs:add api
```

In `--dry-run` mode, cert file existence is not checked so you can preview without having certs locally.

### Proxy

Enable or disable the proxy for an app.

```yaml
apps:
  api:
    proxy:
      enabled: true

  worker:
    proxy:
      enabled: false
```

```
dokku proxy:enable api
dokku proxy:disable worker
```

### Persistent Storage

Mount host directories into containers. Existing mounts are detected and skipped.

```yaml
apps:
  api:
    storage:
      - "/var/lib/dokku/data/storage/api/uploads:/app/uploads"
```

```
dokku storage:mount api /var/lib/dokku/data/storage/api/uploads:/app/uploads
```

Storage mounts are reconciled during `down` — declared mounts are unmounted when destroying an app.

### Nginx Configuration

Set any nginx property supported by Dokku. Each key-value pair maps directly to `nginx:set`.

```yaml
apps:
  api:
    nginx:
      client-max-body-size: "15m"
      proxy-buffer-size: "8k"
      proxy-read-timeout: "120s"
```

```
dokku nginx:set api client-max-body-size 15m
dokku nginx:set api proxy-buffer-size 8k
dokku nginx:set api proxy-read-timeout 120s
```

### Zero-Downtime Checks

Configure zero-downtime deploy check settings.

```yaml
apps:
  api:
    checks:
      wait-to-retire: 60
      attempts: 5
```

```
dokku checks:set api wait-to-retire 60
dokku checks:set api attempts 5
```

### Log Management

Configure log shipping and retention settings.

```yaml
apps:
  api:
    logs:
      max-size: "10m"
```

```
dokku logs:set api max-size 10m
```

### Registry

Configure container registry push settings.

```yaml
apps:
  api:
    registry:
      push-on-release: true
      server: registry.example.com
```

```
dokku registry:set api push-on-release true
dokku registry:set api server registry.example.com
```

### Scheduler

Select the scheduler for an app.

```yaml
apps:
  api:
    scheduler: docker-local
```

```
dokku scheduler:set api selected docker-local
```

### Environment Variables

Set config vars in a single `config:set` call. Values containing `${VAR}` are resolved from your shell environment at runtime via `envsubst`. Unset variables resolve to empty strings.

```yaml
apps:
  api:
    env:
      APP_ENV: production
      SECRET_KEY: "${SECRET_KEY}"
      DATABASE_POOL: "10"
```

```
dokku config:set --no-restart api APP_ENV=production SECRET_KEY=abc123 DATABASE_POOL=10
```

### Dockerfile Builder

Configure Dokku's Dockerfile builder: custom Dockerfile path, build directory, app.json location, and build args.

```yaml
apps:
  api:
    builder:
      dockerfile: docker/prod/api/Dockerfile
      build_dir: apps/api
      app_json: docker/prod/api/app.json
      build_args:
        SENTRY_AUTH_TOKEN: "${SENTRY_AUTH_TOKEN}"
```

```
dokku builder-dockerfile:set api dockerfile-path docker/prod/api/Dockerfile
dokku builder:set api build-dir apps/api
dokku app-json:set api appjson-path docker/prod/api/app.json
dokku docker-options:add api build --build-arg SENTRY_AUTH_TOKEN=xyz
```

### Docker Options

Add custom Docker options per build phase (`build`, `deploy`, `run`).

```yaml
apps:
  api:
    docker_options:
      deploy:
        - "--shm-size 256m"
      run:
        - "--ulimit nofile=12"
```

```
dokku docker-options:add api deploy --shm-size 256m
dokku docker-options:add api run --ulimit nofile=12
```

### Services

Services are declared in a top-level `services:` section rather than inline on apps. Each service has a unique name and specifies which plugin to use. This enables sharing a single service instance between multiple apps.

```yaml
dokku:
  plugins:
    postgres:
      url: https://github.com/dokku/dokku-postgres.git
    redis:
      url: https://github.com/dokku/dokku-redis.git

services:
  api-postgres:
    plugin: postgres
    version: "17-3.5"
    image: postgis/postgis       # custom image (e.g., PostGIS)
  api-redis:
    plugin: redis
  shared-cache:
    plugin: redis                # shared between multiple apps
```

```
dokku postgres:create api-postgres -I 17-3.5 -i postgis/postgis
dokku redis:create api-redis
dokku redis:create shared-cache
```

Services are created before apps during `up`, so they are ready to be linked.

#### Linking Services to Apps

Apps reference services by name using `links:`. This connects the service to the app and injects the service's connection URL as an environment variable.

```yaml
apps:
  api:
    links:
      - api-postgres
      - api-redis
      - shared-cache

  worker:
    links:
      - shared-cache
```

```
dokku postgres:link api-postgres api --no-restart
dokku redis:link api-redis api --no-restart
dokku redis:link shared-cache api --no-restart

dokku redis:link shared-cache worker --no-restart
```

Link reconciliation is declarative:

| `links:` value | Behavior |
|-----------------|----------|
| Present with values | Link listed services, unlink any others |
| Present but empty (`links: []`) | Unlink all services from the app |
| Absent (key omitted) | Skip -- do not change links |

This means you can safely remove a service from an app by removing it from the `links` list and re-running `up`. Any services currently linked to the app that are not in the list will be unlinked.

#### Shared Services

Because services are named independently from apps, multiple apps can link to the same service:

```yaml
services:
  shared-cache:
    plugin: redis

apps:
  api:
    links:
      - shared-cache
  worker:
    links:
      - shared-cache
```

Both `api` and `worker` will receive the same Redis connection URL.

#### Custom Plugin Scripts

For plugins that don't follow the standard service API (like letsencrypt), add a `script:` key pointing to a custom handler. The script is sourced with `SERVICE_ACTION` (`up`/`down`), `SERVICE_APP`, and `SERVICE_CONFIG` (JSON of the app's config for this plugin) variables set.

```yaml
dokku:
  plugins:
    letsencrypt:
      url: https://github.com/dokku/dokku-letsencrypt.git
      script: scripts/letsencrypt.sh

apps:
  web:
    letsencrypt:
      email: admin@example.com
```

Example handler (`scripts/letsencrypt.sh`):

```bash
#!/usr/bin/env bash
local email
email=$(echo "$SERVICE_CONFIG" | yq -r '.email')

if [[ "$SERVICE_ACTION" == "up" ]]; then
    dokku_cmd letsencrypt:set "$SERVICE_APP" email "$email"
    dokku_cmd letsencrypt:enable "$SERVICE_APP"
elif [[ "$SERVICE_ACTION" == "down" ]]; then
    dokku_cmd letsencrypt:disable "$SERVICE_APP"
fi
```

### Commands

| Command | Description |
|---------|-------------|
| `dokku-compose up` | Create/update apps and services to match config |
| `dokku-compose down --force` | Destroy apps and services (requires `--force`) |
| `dokku-compose ps` | Show status of configured apps |
| `dokku-compose setup` | Install Dokku at declared version (fresh Ubuntu/Debian only) |

#### `ps` — Show Status

Queries each configured app and prints its deploy status:

```
$ dokku-compose ps
api                  running
worker               running
web                  not created
```

#### `down` — Tear Down

Destroys apps and their linked services. Requires `--force` as a safety measure. For each app, services are unlinked first, then the app is destroyed. Service instances from the top-level `services:` section are destroyed after all apps. You can target a single app or tear down everything:

```bash
dokku-compose down --force myapp     # Destroy one app and its services
dokku-compose down --force           # Destroy all configured apps
```

### Options

| Option | Description |
|--------|-------------|
| `--file <path>` | Config file (default: `dokku-compose.yml`) |
| `--dry-run` | Print commands without executing |
| `--fail-fast` | Stop on first error (default: continue to next app) |
| `--remove-orphans` | Destroy services and networks not in config |
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

### Execution Modes

```bash
# Run locally on the Dokku server
dokku-compose up

# Run remotely over SSH
DOKKU_HOST=my-server.example.com dokku-compose up
```

When `DOKKU_HOST` is set, all Dokku commands are sent over SSH. This is the typical workflow — you keep `dokku-compose.yml` in your project repo and apply it from your local machine. SSH key access to the Dokku server is required.

### What `up` Does

Idempotently ensures desired state, in order:

1. Check Dokku version (warn on mismatch)
2. Install missing plugins
3. Create shared networks
4. Create service instances (from top-level `services:`)
5. For each app:
   - Create app (if not exists)
   - Lock/unlock app (if declared)
   - Set domains (or disable vhosts)
   - Link/unlink services (from `links:`)
   - Run custom plugin scripts
   - Attach to networks
   - Enable/disable proxy
   - Set port mappings
   - Add SSL certificate
   - Mount persistent storage
   - Configure nginx properties
   - Configure zero-downtime checks
   - Configure log settings
   - Configure registry settings
   - Set scheduler
   - Set environment variables
   - Configure builder (dockerfile path, build dir, build args)
   - Add docker options (per phase)

Running `up` twice produces no changes -- every step checks current state before acting.

**Note:** `up` is mostly additive. It creates and updates configuration to match your YAML, but removing a key (e.g. deleting a `ports:` block) won't remove the corresponding setting from Dokku. The exception is `links:`, which is fully declarative -- services not in the list are unlinked. To fully reset an app, use `down --force` and re-run `up`. Use `--remove-orphans` to destroy services and networks that are no longer in the config file.

### Output

```
[networks  ] Creating backend-net... done
[services  ] Creating api-postgres (postgres 17-3.5)... done
[services  ] Creating api-redis (redis)... done
[services  ] Creating shared-cache (redis)... done
[api       ] Creating app... done
[api       ] Setting domains: api.example.com... done
[api       ] Linking api-postgres... done
[api       ] Linking api-redis... done
[api       ] Linking shared-cache... done
[api       ] Setting ports https:4001:4000... done
[api       ] Adding SSL certificate... done
[api       ] Mounting /var/lib/dokku/data/storage/api/uploads:/app/uploads... done
[api       ] Setting nginx client-max-body-size=15m... done
[api       ] Setting checks wait-to-retire=60... done
[api       ] Setting 2 env var(s)... done
[worker    ] Creating app... already configured
[worker    ] Linking shared-cache... already configured
```

## Architecture

```
dokku-compose/
├── bin/
│   └── dokku-compose         # Entry point: arg parsing, command dispatch
├── lib/
│   ├── core.sh               # Logging, colors, dokku_cmd wrapper, helpers
│   ├── yaml.sh               # YAML helpers wrapping yq
│   ├── apps.sh               # dokku apps:*
│   ├── builder.sh            # dokku builder-dockerfile:*, builder:*, app-json:*
│   ├── certs.sh              # dokku certs:*
│   ├── checks.sh             # dokku checks:*
│   ├── config.sh             # dokku config:*
│   ├── docker_options.sh     # dokku docker-options:*
│   ├── dokku.sh              # Dokku version check, installation
│   ├── domains.sh            # dokku domains:*
│   ├── logs.sh               # dokku logs:*
│   ├── network.sh            # dokku network:*
│   ├── nginx.sh              # dokku nginx:*
│   ├── plugins.sh            # dokku plugin:*
│   ├── ports.sh              # dokku ports:*
│   ├── proxy.sh              # dokku proxy:*
│   ├── registry.sh           # dokku registry:*
│   ├── scheduler.sh          # dokku scheduler:*
│   ├── services.sh           # Service instances, links, and plugin scripts
│   └── storage.sh            # dokku storage:*
├── tests/
│   ├── test_helper.bash      # Mock dokku_cmd, assertion helpers
│   ├── fixtures/             # Test YAML configs
│   ├── *.bats                # Unit tests per module
│   └── integration.bats      # End-to-end tests
└── dokku-compose.yml.example
```

Each `lib/*.sh` file maps to one Dokku command namespace and contains `ensure_*()` / `destroy_*()` functions.

## Development

### Setup

```bash
git clone --recurse-submodules https://github.com/guess/dokku-compose.git
cd dokku-compose
```

### Running tests

Tests use [BATS](https://github.com/bats-core/bats-core) with a mocked `dokku_cmd` wrapper -- no real Dokku server needed.

```bash
# Run all tests
./tests/bats/bin/bats tests/

# Run a specific module's tests
./tests/bats/bin/bats tests/services.bats
```

CI runs unit tests on every push and PR.

### Releasing

```bash
scripts/release.sh 0.2.0
```

This verifies CI passed on the current commit, then creates and pushes a git tag. The release workflow bundles the script and publishes a GitHub Release automatically.

## License

[MIT](LICENSE)
