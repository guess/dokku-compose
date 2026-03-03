# dokku-compose

- 📄 **Declarative** -- Define your entire Dokku server in a single YAML file
- 🔁 **Idempotent** -- Run it twice, nothing changes. Safe to re-run anytime
- 👀 **Dry-run** -- Preview every command before it touches your server
- 🔌 **Zero dependencies** -- Just bash and yq. No Python, no Ruby, no Ansible
- 🏗️ **Modular** -- One file per Dokku namespace. Easy to read, extend, and debug

<p align="center">
  <img src="assets/dokku-compose.png" alt="dokku-compose" width="300">
</p>

## Why

Configuring a Dokku server means running dozens of imperative commands in the right order: create apps, install plugins, link databases, set ports, add certs, configure nginx, set env vars. Miss one and your deploy breaks. Change a server and you're doing it all over again.

`dokku-compose` replaces that with a single YAML file. Describe what you want, run `dokku-compose up`, and it figures out what needs to change. Like Docker Compose, but for Dokku.

## Install

### On a Dokku server (recommended)

```bash
# Clone into /opt or wherever you keep tools
git clone --recurse-submodules https://github.com/your-org/dokku-compose.git /opt/dokku-compose

# Symlink to PATH
ln -s /opt/dokku-compose/bin/dokku-compose /usr/local/bin/dokku-compose

# yq is auto-installed when running as root — or install manually:
# https://github.com/mikefarah/yq#install

# Verify
dokku-compose --version
```

### Requirements

| Dependency | Version | Notes |
|------------|---------|-------|
| Bash | >= 4.0 | Ships with most Linux distros |
| [yq](https://github.com/mikefarah/yq) | >= 4.0 | Auto-installed on servers if running as root |
| [Dokku](https://dokku.com) | any | Local or remote via `DOKKU_HOST` |
| [BATS](https://github.com/bats-core/bats-core) | — | Included as git submodule (tests only) |

## Features

Features are listed in execution order — this is the sequence `dokku-compose up` follows.

### Dokku Version Check

Declare the expected Dokku version. A warning is logged if the running version doesn't match.

```yaml
dokku:
  version: "0.35.12"
```

```
[dokku      ] WARN: Version mismatch: running 0.34.0, config expects 0.35.12
```

Use `dokku-compose setup` to install Dokku at the declared version on a fresh server.

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

Create and destroy Dokku apps idempotently. If the app already exists, it's skipped.

```yaml
apps:
  api:
    build_dir: apps/api       # sets APP_PATH build arg
```

```
dokku apps:create api
dokku domains:disable api     # vhosts disabled by default
```

### PostgreSQL

Provision a PostgreSQL service and link it to an app. Use `true` for defaults or an object for version/image control.

```yaml
apps:
  api:
    # Simple — default version
    postgres: true

  analytics:
    # Advanced — pin version, use PostGIS image
    postgres:
      version: "17-3.5"
      image: postgis/postgis
```

```
dokku postgres:create api-db
dokku postgres:link api-db api --no-restart

dokku postgres:create analytics-db -I 17-3.5 -i postgis/postgis
dokku postgres:link analytics-db analytics --no-restart
```

### Redis

Same pattern as PostgreSQL. Use `true` for defaults or specify a version.

```yaml
apps:
  api:
    redis: true

  cache:
    redis:
      version: "7.2-alpine"
```

```
dokku redis:create api-redis
dokku redis:link api-redis api --no-restart

dokku redis:create cache-redis -I 7.2-alpine
dokku redis:link cache-redis cache --no-restart
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
    ssl: certs/example.com
```

```
tar cf - -C certs/example.com cert.crt cert.key | dokku certs:add api
```

In `--dry-run` mode, cert file existence is not checked so you can preview without having certs locally.

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

### Environment Variables

Set config vars in a single `config:set` call. Values containing `${VAR}` are resolved from your shell environment at runtime.

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

Configure Dokku's Dockerfile builder: custom Dockerfile path, app.json location, and build args.

```yaml
apps:
  api:
    dockerfile: docker/prod/api/Dockerfile
    app_json: docker/prod/api/app.json
    build_dir: apps/api
    build_args:
      SENTRY_AUTH_TOKEN: "${SENTRY_AUTH_TOKEN}"
```

```
dokku builder-dockerfile:set api dockerfile-path docker/prod/api/Dockerfile
dokku app-json:set api appjson-path docker/prod/api/app.json
dokku docker-options:add api build --build-arg APP_PATH=apps/api
dokku docker-options:add api build --build-arg APP_NAME=api
dokku docker-options:add api build --build-arg SENTRY_AUTH_TOKEN=xyz
```

`build_dir` is automatically passed as `APP_PATH` and `APP_NAME` build args.

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

### Execution Modes

```bash
# Run locally on the Dokku server
dokku-compose up

# Run remotely over SSH
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

## Development

### macOS setup

```bash
# Clone with submodules (needed for test framework)
git clone --recurse-submodules https://github.com/your-org/dokku-compose.git
cd dokku-compose

# Install yq
brew install yq

# Run against a remote Dokku server over SSH
DOKKU_HOST=my-server.example.com bin/dokku-compose up --dry-run
```

### Running tests

Tests use [BATS](https://github.com/bats-core/bats-core) with a mocked `dokku_cmd` wrapper -- no real Dokku server needed.

```bash
# Run all tests
./tests/bats/bin/bats tests/

# Run a specific module's tests
./tests/bats/bin/bats tests/postgres.bats
```

CI runs unit tests on every push and PR ([![Tests](https://github.com/guess/dokku-compose/actions/workflows/tests.yml/badge.svg)](https://github.com/guess/dokku-compose/actions/workflows/tests.yml)).

## License

[MIT](LICENSE)
