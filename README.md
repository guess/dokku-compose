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

Configuring a Dokku server means running dozens of imperative commands in the right order. Miss one and your deploy breaks. Change servers and you're starting over.

`dokku-compose` replaces that with a single YAML file. Like Docker Compose, but for Dokku.

## A Complete Example

```yaml
dokku:
  version: "0.35.12"

plugins:
  postgres:
    url: https://github.com/dokku/dokku-postgres.git
    version: "1.41.0"
  redis:
    url: https://github.com/dokku/dokku-redis.git

services:
  api-postgres:
    plugin: postgres
    version: "17-3.5"
  shared-cache:
    plugin: redis

networks:
  - backend-net

domains:
  - example.com

nginx:
  client-max-body-size: "50m"

logs:
  max-size: "50m"

apps:
  api:
    build:
      context: apps/api
      dockerfile: docker/prod/api/Dockerfile
    env:
      APP_ENV: production
      APP_SECRET: "${SECRET_KEY}"
    domains:
      - api.example.com
    links:
      - api-postgres
      - shared-cache
    networks:
      - backend-net
    ports:
      - "https:4001:4000"
    ssl:
      certfile: certs/example.com/fullchain.pem
      keyfile: certs/example.com/privkey.pem
    storage:
      - "/var/lib/dokku/data/storage/api/uploads:/app/uploads"
    nginx:
      client-max-body-size: "15m"
      proxy-read-timeout: "120s"
    checks:
      wait-to-retire: 60
      disabled:
        - worker

  worker:
    links:
      - api-postgres
      - shared-cache
    checks: false
    proxy:
      enabled: false
```

## Quick Start

```bash
# Install
curl -fsSL https://github.com/guess/dokku-compose/releases/latest/download/dokku-compose \
  | sudo install /dev/stdin /usr/local/bin/dokku-compose

# Create a starter config
dokku-compose init myapp

# Preview what will happen
dokku-compose up --dry-run

# Apply configuration
dokku-compose up

# Or apply to a remote server over SSH
DOKKU_HOST=my-server.example.com dokku-compose up
```

Requires bash >= 4.0 and [yq](https://github.com/mikefarah/yq) >= 4.0. See the [Installation Reference →](docs/reference/install.md) for version pinning, requirements, and remote execution details.

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

Use `dokku-compose setup` to install Dokku at the declared version on a fresh Ubuntu/Debian server.

### Application Management

Create and destroy Dokku apps idempotently. If the app already exists, it's skipped.

```yaml
apps:
  api:
    # per-app configuration goes here
```

[Application Management Reference →](docs/reference/apps.md)

### Environment Variables

Set config vars per app or globally. Vars prefixed with `APP_` (default) are converged — orphaned vars are automatically unset.

```yaml
apps:
  api:
    env:
      APP_ENV: production
      APP_SECRET: "${SECRET_KEY}"
```

[Environment Variables Reference →](docs/reference/config.md)

### Build

Configure Dockerfile builds: build context, Dockerfile path, app.json location, and build args. Key names follow docker-compose conventions.

```yaml
apps:
  api:
    build:
      context: apps/api
      dockerfile: docker/prod/api/Dockerfile
      app_json: docker/prod/api/app.json
      args:
        SENTRY_AUTH_TOKEN: "${SENTRY_AUTH_TOKEN}"
```

[Build Reference →](docs/reference/builder.md)

### Docker Options

Add custom Docker options per build phase (`build`, `deploy`, `run`). Each phase is cleared and re-populated on every `up` for idempotent convergence.

```yaml
apps:
  api:
    docker_options:
      deploy:
        - "--shm-size 256m"
      run:
        - "--ulimit nofile=12"
```

[Docker Options Reference →](docs/reference/docker_options.md)

### Networks

Create shared Docker networks and configure per-app network properties.

```yaml
networks:
  - backend-net

apps:
  api:
    networks:                      # attach-post-deploy
      - backend-net
    network:                       # other network:set properties
      attach_post_create:
        - init-net
      initial_network: custom-bridge
      bind_all_interfaces: true
      tld: internal
```

`down --force` clears network settings and destroys declared networks.

[Networks Reference →](docs/reference/network.md)

### Domains

Configure custom domains per app or globally.

```yaml
domains:
  - example.com

apps:
  api:
    domains:
      - api.example.com
      - api.example.co
```

[Domains Reference →](docs/reference/domains.md)

### Port Mappings

Map external ports to container ports using `SCHEME:HOST_PORT:CONTAINER_PORT` format.

```yaml
apps:
  api:
    ports:
      - "https:4001:4000"
```

Comparison is order-insensitive. `down --force` clears port mappings before destroying the app.

[Port Mappings Reference →](docs/reference/ports.md)

### SSL Certificates

Specify cert and key file paths. Idempotent — skips if SSL is already enabled. Set to `false` to remove an existing certificate.

```yaml
apps:
  api:
    ssl:                                  # add cert (idempotent)
      certfile: certs/example.com/fullchain.pem
      keyfile: certs/example.com/privkey.pem
  worker:
    ssl: false                            # remove cert
```

[SSL Certificates Reference →](docs/reference/certs.md)

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

### Persistent Storage

Declare persistent bind mounts for an app. Mounts are fully converged on each `up` run — new mounts are added, mounts removed from YAML are unmounted, and existing mounts are skipped.

```yaml
apps:
  api:
    storage:
      - "/var/lib/dokku/data/storage/api/uploads:/app/uploads"
```

Host directories must exist before mounting. On `down`, declared mounts are unmounted.

[Storage Reference →](docs/reference/storage.md)

### Nginx Configuration

Set any nginx property supported by Dokku via a key-value map — per-app or globally.

```yaml
nginx:                        # global defaults
  client-max-body-size: "50m"

apps:
  api:
    nginx:                    # per-app overrides
      client-max-body-size: "15m"
      proxy-read-timeout: "120s"
```

[Nginx Reference →](docs/reference/nginx.md)

### Zero-Downtime Checks

Configure zero-downtime deploy check properties, disable checks entirely, or control per process type. Properties are idempotent — current values are checked before setting.

```yaml
apps:
  api:
    checks:
      wait-to-retire: 60
      attempts: 5
      disabled:
        - worker
      skipped:
        - cron
  worker:
    checks: false                     # disable all checks (causes downtime)
```

[Zero-Downtime Checks Reference →](docs/reference/checks.md)

### Log Management

Configure log retention and shipping globally or per-app.

```yaml
logs:                            # global defaults
  max-size: "50m"
  vector-sink: "console://?encoding[codec]=json"

apps:
  api:
    logs:                        # per-app overrides
      max-size: "10m"
```

[Log Management Reference →](docs/reference/logs.md)

### Plugins and Services

Install plugins and declare service instances. Services are created before apps during `up` and linked on demand.

```yaml
plugins:
  postgres:
    url: https://github.com/dokku/dokku-postgres.git
    version: "1.41.0"

services:
  api-postgres:
    plugin: postgres

apps:
  api:
    links:
      - api-postgres
```

[Plugins and Services Reference →](docs/reference/plugins.md)

## Commands

| Command | Description |
|---------|-------------|
| `dokku-compose init [app...]` | Create a starter `dokku-compose.yml` |
| `dokku-compose up` | Create/update apps and services to match config |
| `dokku-compose down --force` | Destroy apps and services (requires `--force`) |
| `dokku-compose ps` | Show status of configured apps |
| `dokku-compose setup` | Install Dokku at declared version (fresh Ubuntu/Debian only) |

### `ps` — Show Status

Queries each configured app and prints its deploy status:

```
$ dokku-compose ps
api                  running
worker               running
web                  not created
```

### `down` — Tear Down

Destroys apps and their linked services. Requires `--force` as a safety measure. For each app, services are unlinked first, then the app is destroyed. Service instances from the top-level `services:` section are destroyed after all apps.

```bash
dokku-compose down --force myapp     # Destroy one app and its services
dokku-compose down --force           # Destroy all configured apps
```

## Options

| Option | Description |
|--------|-------------|
| `--file <path>` | Config file (default: `dokku-compose.yml`) |
| `--dry-run` | Print commands without executing |
| `--fail-fast` | Stop on first error (default: continue to next app) |
| `--remove-orphans` | Destroy services and networks not in config |
| `--help` | Show usage |
| `--version` | Show version |

## Examples

```bash
dokku-compose up                      # Configure all apps
dokku-compose up myapp                # Configure one app
dokku-compose up --dry-run            # Preview changes
dokku-compose down --force myapp      # Destroy an app
dokku-compose ps                      # Show status
```

## Execution Modes

```bash
# Run locally on the Dokku server
dokku-compose up

# Run remotely over SSH
DOKKU_HOST=my-server.example.com dokku-compose up
```

When `DOKKU_HOST` is set, all Dokku commands are sent over SSH. This is the typical workflow — keep `dokku-compose.yml` in your project repo and apply it from your local machine. SSH key access to the Dokku server is required.

## What `up` Does

Idempotently ensures desired state, in order:

1. Check Dokku version (warn on mismatch)
2. Install missing plugins
3. Set global config (domains, env vars, nginx defaults)
4. Create shared networks
5. Create service instances (from top-level `services:`)
6. For each app:
   - Create app (if not exists)
   - Lock/unlock app (if declared)
   - Set domains, link/unlink services, attach networks
   - Enable/disable proxy, set ports, add SSL, mount storage
   - Configure nginx, checks, logs, env vars, build, and docker options

Running `up` twice produces no changes — every step checks current state before acting.

`up` is mostly additive. Removing a key (e.g. deleting a `ports:` block) won't remove the corresponding setting from Dokku. The exception is `links:`, which is fully declarative — services not in the list are unlinked. Use `down --force` to fully reset an app, or `--remove-orphans` to destroy services and networks no longer in config.

## Output

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

<details>
<summary>File structure</summary>

```
dokku-compose/
├── bin/
│   └── dokku-compose         # Entry point: arg parsing, command dispatch
├── lib/
│   ├── core.sh               # Logging, colors, dokku_cmd wrapper, helpers
│   ├── yaml.sh               # YAML helpers wrapping yq
│   ├── apps.sh               # dokku apps:*
│   ├── builder.sh            # dokku builder:*, builder-dockerfile:*, app-json:*
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
│   ├── services.sh           # Service instances, links, and plugin scripts
│   └── storage.sh            # dokku storage:*
├── tests/
│   ├── test_helper.bash      # Mock dokku_cmd, assertion helpers
│   ├── fixtures/             # Test YAML configs
│   ├── *.bats                # Unit tests per module
│   └── integration.bats      # End-to-end tests
└── dokku-compose.yml.example
```

Each `lib/*.sh` file maps to one Dokku command namespace and contains `ensure_*()` / `destroy_*()` functions. See [CLAUDE.md](CLAUDE.md) for development conventions.

</details>

## Development

```bash
git clone --recurse-submodules https://github.com/guess/dokku-compose.git
cd dokku-compose

# Run all tests
./tests/bats/bin/bats tests/

# Run a specific module's tests
./tests/bats/bin/bats tests/services.bats
```

Tests use [BATS](https://github.com/bats-core/bats-core) with a mocked `dokku_cmd` — no real Dokku server needed.

```bash
# Cut a release (checks CI passed first)
scripts/release.sh 0.2.0
```

## License

[MIT](LICENSE)
