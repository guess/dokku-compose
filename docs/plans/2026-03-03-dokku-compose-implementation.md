# dokku-compose Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a bash + yq CLI tool that declaratively configures Dokku servers from a YAML config file.

**Architecture:** Single entry point (`bin/dokku-compose`) sources modular lib files, each mapping to a Dokku command namespace. `yq` handles YAML parsing. BATS handles testing with mocked `dokku_cmd`.

**Tech Stack:** Bash >= 4.0, yq >= 4.0, BATS (testing), Dokku CLI

**Design Doc:** `docs/plans/2026-03-03-dokku-compose-design.md`

---

### Task 1: Project Scaffolding + Test Infrastructure

**Files:**
- Create: `lib/core.sh`
- Create: `lib/yaml.sh`
- Create: `tests/test_helper.bash`
- Create: `tests/fixtures/simple.yml`
- Create: `tests/fixtures/full.yml`

**Step 1: Install BATS locally for the project**

Run: `git submodule add https://github.com/bats-core/bats-core.git tests/bats`
Run: `git submodule add https://github.com/bats-core/bats-support.git tests/test_helper/bats-support`
Run: `git submodule add https://github.com/bats-core/bats-assert.git tests/test_helper/bats-assert`

**Step 2: Create lib/core.sh with logging, colors, and dokku_cmd wrapper**

```bash
#!/usr/bin/env bash
# Core utilities for dokku-compose
# Logging, colors, dokku command wrapper

set -euo pipefail

# Colors (disabled if not a terminal)
if [[ -t 1 ]]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[0;33m'
    BLUE='\033[0;34m'
    NC='\033[0m' # No Color
else
    RED='' GREEN='' YELLOW='' BLUE='' NC=''
fi

# Global state
DOKKU_COMPOSE_DRY_RUN="${DOKKU_COMPOSE_DRY_RUN:-false}"
DOKKU_COMPOSE_ERRORS=0

log_action() {
    local context="$1"
    shift
    printf "${BLUE}[%-12s]${NC} %s" "$context" "$*"
}

log_done() {
    printf "... ${GREEN}done${NC}\n"
}

log_skip() {
    printf "... ${YELLOW}already configured${NC}\n"
}

log_error() {
    local context="$1"
    shift
    printf "${RED}[%-12s] ERROR: %s${NC}\n" "$context" "$*" >&2
    DOKKU_COMPOSE_ERRORS=$((DOKKU_COMPOSE_ERRORS + 1))
}

log_warn() {
    local context="$1"
    shift
    printf "${YELLOW}[%-12s] WARN: %s${NC}\n" "$context" "$*" >&2
}

# Execute a dokku command, respecting dry-run and remote modes
# Usage: dokku_cmd <command> [args...]
dokku_cmd() {
    if [[ "$DOKKU_COMPOSE_DRY_RUN" == "true" ]]; then
        echo "[dry-run] dokku $*"
        return 0
    fi

    if [[ -n "${DOKKU_HOST:-}" ]]; then
        ssh "dokku@${DOKKU_HOST}" "$@"
    else
        dokku "$@"
    fi
}

# Check if dokku_cmd succeeds silently (for :exists checks)
# Usage: dokku_cmd_check <command> [args...]
dokku_cmd_check() {
    dokku_cmd "$@" >/dev/null 2>&1
}
```

**Step 3: Create lib/yaml.sh with yq helpers**

```bash
#!/usr/bin/env bash
# YAML helpers wrapping yq
# https://github.com/mikefarah/yq

DOKKU_COMPOSE_FILE="${DOKKU_COMPOSE_FILE:-dokku-compose.yml}"

# Check yq is available, offer to install if not
ensure_yq() {
    if command -v yq &>/dev/null; then
        return 0
    fi

    echo "yq is required but not installed."
    echo "Install it from: https://github.com/mikefarah/yq#install"

    # Auto-install if running as root (typical on Dokku servers)
    if [[ "$(id -u)" == "0" ]]; then
        echo "Attempting auto-install..."
        local arch
        arch=$(uname -m)
        case "$arch" in
            x86_64) arch="amd64" ;;
            aarch64|arm64) arch="arm64" ;;
            *) echo "Unsupported architecture: $arch"; return 1 ;;
        esac
        local os
        os=$(uname -s | tr '[:upper:]' '[:lower:]')
        local url="https://github.com/mikefarah/yq/releases/latest/download/yq_${os}_${arch}"
        curl -sL "$url" -o /usr/local/bin/yq && chmod +x /usr/local/bin/yq
        echo "yq installed to /usr/local/bin/yq"
    else
        return 1
    fi
}

# Read a value from the config file
# Usage: yaml_get ".dokku.version"
yaml_get() {
    local path="$1"
    yq eval "$path // \"\"" "$DOKKU_COMPOSE_FILE"
}

# Read a list from the config file, one item per line
# Usage: yaml_list ".networks[]"
yaml_list() {
    local path="$1"
    yq eval "$path" "$DOKKU_COMPOSE_FILE" 2>/dev/null || true
}

# Get all app names
# Usage: yaml_app_names
yaml_app_names() {
    yq eval '.apps | keys | .[]' "$DOKKU_COMPOSE_FILE"
}

# Get a value for a specific app
# Usage: yaml_app_get "funqtion" ".dockerfile"
yaml_app_get() {
    local app="$1" path="$2"
    yq eval ".apps.${app}${path} // \"\"" "$DOKKU_COMPOSE_FILE"
}

# Get a list for a specific app
# Usage: yaml_app_list "funqtion" ".ports[]"
yaml_app_list() {
    local app="$1" path="$2"
    yq eval ".apps.${app}${path}" "$DOKKU_COMPOSE_FILE" 2>/dev/null || true
}

# Check if an app key exists and is not null
# Usage: yaml_app_has "funqtion" ".postgres"
yaml_app_has() {
    local app="$1" path="$2"
    local val
    val=$(yq eval ".apps.${app}${path}" "$DOKKU_COMPOSE_FILE" 2>/dev/null)
    [[ -n "$val" && "$val" != "null" ]]
}

# Get all keys of a map for an app
# Usage: yaml_app_map_keys "funqtion" ".env"
yaml_app_map_keys() {
    local app="$1" path="$2"
    yq eval ".apps.${app}${path} | keys | .[]" "$DOKKU_COMPOSE_FILE" 2>/dev/null || true
}

# Get a map value for an app
# Usage: yaml_app_map_get "funqtion" ".env" "APP_ENV"
yaml_app_map_get() {
    local app="$1" path="$2" key="$3"
    yq eval ".apps.${app}${path}.${key} // \"\"" "$DOKKU_COMPOSE_FILE"
}

# Resolve ${VAR} references in a string using the current environment
# Usage: resolve_env_vars "some ${VAR} string"
resolve_env_vars() {
    local str="$1"
    eval echo "\"$str\""
}
```

**Step 4: Create test fixtures**

`tests/fixtures/simple.yml`:
```yaml
networks:
  - app-net

apps:
  myapp:
    build_dir: apps/myapp
    ports:
      - "http:5000:5000"
    postgres: true
```

`tests/fixtures/full.yml`:
```yaml
dokku:
  version: "0.35.12"
  plugins:
    postgres:
      url: https://github.com/dokku/dokku-postgres.git
      version: "1.41.0"
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
      image: postgis/postgis
    redis:
      version: "7.2-alpine"
    env:
      APP_ENV: staging
    build_args:
      SENTRY_AUTH_TOKEN: "test-token"

  studio:
    build_dir: apps/studio-api
    ports:
      - "https:4002:4000"
    ssl: certs/strates.io
    postgres: true
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

  qultr-sandbox:
    dockerfile: docker/prod/sandbox/Dockerfile
    build_dir: apps/qultr-sandbox
    ports:
      - "http:4004:4000"
    networks:
      - qultr-net
```

**Step 5: Create test_helper.bash with dokku_cmd mock**

```bash
#!/usr/bin/env bash
# Test helper for BATS tests
# Provides dokku_cmd mock and assertion helpers

# Load BATS libraries
load 'test_helper/bats-support/load'
load 'test_helper/bats-assert/load'

# Project root
PROJECT_ROOT="$(cd "$(dirname "${BATS_TEST_FILENAME}")/.." && pwd)"

# Mock state directory (per-test)
MOCK_DIR=""
DOKKU_CMD_LOG=""

setup_mocks() {
    MOCK_DIR="$(mktemp -d)"
    DOKKU_CMD_LOG="${MOCK_DIR}/dokku_cmd.log"
    touch "$DOKKU_CMD_LOG"

    # Source project files
    source "${PROJECT_ROOT}/lib/core.sh"
    source "${PROJECT_ROOT}/lib/yaml.sh"

    # Override dokku_cmd to record calls and return mock responses
    dokku_cmd() {
        echo "$*" >> "$DOKKU_CMD_LOG"

        # Check for mock response file
        local cmd_key
        cmd_key=$(echo "$*" | tr ' ' '_' | tr ':' '_')
        if [[ -f "${MOCK_DIR}/response_${cmd_key}" ]]; then
            cat "${MOCK_DIR}/response_${cmd_key}"
            return "$(cat "${MOCK_DIR}/exitcode_${cmd_key}" 2>/dev/null || echo 0)"
        fi

        # Check for mock exit code by command prefix
        local prefix
        prefix=$(echo "$1" | tr ':' '_')
        if [[ -f "${MOCK_DIR}/exitcode_${prefix}" ]]; then
            return "$(cat "${MOCK_DIR}/exitcode_${prefix}")"
        fi

        return 0
    }

    # Override dokku_cmd_check similarly
    dokku_cmd_check() {
        dokku_cmd "$@" >/dev/null 2>&1
    }

    export -f dokku_cmd dokku_cmd_check
}

teardown_mocks() {
    [[ -n "$MOCK_DIR" ]] && rm -rf "$MOCK_DIR"
}

# Set mock: dokku_cmd "<command> <args>" exits with given code
# Usage: mock_dokku_exit "apps:exists myapp" 0
mock_dokku_exit() {
    local cmd_key
    cmd_key=$(echo "$1" | tr ' ' '_' | tr ':' '_')
    echo "$2" > "${MOCK_DIR}/exitcode_${cmd_key}"
}

# Set mock: dokku_cmd "<command> <args>" outputs given text
# Usage: mock_dokku_output "apps:list" "myapp\nsecondapp"
mock_dokku_output() {
    local cmd_key
    cmd_key=$(echo "$1" | tr ' ' '_' | tr ':' '_')
    echo -e "$2" > "${MOCK_DIR}/response_${cmd_key}"
}

# Assert that dokku_cmd was called with specific args
# Usage: assert_dokku_called "apps:create myapp"
assert_dokku_called() {
    grep -qF "$1" "$DOKKU_CMD_LOG" || {
        echo "Expected dokku_cmd call: $1"
        echo "Actual calls:"
        cat "$DOKKU_CMD_LOG"
        return 1
    }
}

# Assert that dokku_cmd was NOT called with specific args
# Usage: refute_dokku_called "apps:create myapp"
refute_dokku_called() {
    if grep -qF "$1" "$DOKKU_CMD_LOG"; then
        echo "Did NOT expect dokku_cmd call: $1"
        echo "Actual calls:"
        cat "$DOKKU_CMD_LOG"
        return 1
    fi
}

# Count how many times a command was called
# Usage: assert_dokku_call_count "apps:create" 2
assert_dokku_call_count() {
    local expected="$2"
    local actual
    actual=$(grep -cF "$1" "$DOKKU_CMD_LOG" || echo 0)
    if [[ "$actual" != "$expected" ]]; then
        echo "Expected $expected calls to '$1', got $actual"
        echo "Actual calls:"
        cat "$DOKKU_CMD_LOG"
        return 1
    fi
}
```

**Step 6: Verify test infrastructure works**

Create a smoke test `tests/smoke.bats`:
```bash
#!/usr/bin/env bash

setup() {
    load 'test_helper'
    setup_mocks
}

teardown() {
    teardown_mocks
}

@test "mock dokku_cmd records calls" {
    dokku_cmd apps:list
    assert_dokku_called "apps:list"
}

@test "mock dokku_cmd respects exit codes" {
    mock_dokku_exit "apps:exists myapp" 1
    run dokku_cmd apps:exists myapp
    assert_failure
}

@test "yaml_get reads values from fixture" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/simple.yml"
    run yaml_app_names
    assert_output "myapp"
}
```

Run: `./tests/bats/bin/bats tests/smoke.bats`
Expected: 3 tests pass

**Step 7: Commit**

```bash
git add lib/core.sh lib/yaml.sh tests/ .gitmodules
git commit -m "feat: add core infrastructure, YAML helpers, and test framework"
```

---

### Task 2: Entry Point + Arg Parsing

**Files:**
- Create: `bin/dokku-compose`

**Step 1: Write a test for arg parsing**

Create `tests/cli.bats`:
```bash
#!/usr/bin/env bash

setup() {
    load 'test_helper'
    setup_mocks
    CLI="${PROJECT_ROOT}/bin/dokku-compose"
}

teardown() {
    teardown_mocks
}

@test "shows usage with no arguments" {
    run "$CLI" 2>&1
    assert_output --partial "Usage:"
}

@test "shows usage with --help" {
    run "$CLI" --help
    assert_output --partial "Usage:"
}

@test "shows version with --version" {
    run "$CLI" --version
    assert_output --partial "dokku-compose"
}

@test "errors on unknown command" {
    run "$CLI" foobar
    assert_failure
    assert_output --partial "Unknown command"
}
```

**Step 2: Run test to verify it fails**

Run: `./tests/bats/bin/bats tests/cli.bats`
Expected: FAIL (file doesn't exist)

**Step 3: Write bin/dokku-compose**

```bash
#!/usr/bin/env bash
# dokku-compose - Declarative Dokku deployment orchestrator
# https://github.com/your-org/dokku-compose

set -euo pipefail

DOKKU_COMPOSE_VERSION="0.1.0"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="${SCRIPT_DIR}/../lib"

# Source all library files
source "${LIB_DIR}/core.sh"
source "${LIB_DIR}/yaml.sh"

# Source module files (each maps to a Dokku command namespace)
for module in apps network plugins postgres redis ports certs nginx config builder dokku; do
    if [[ -f "${LIB_DIR}/${module}.sh" ]]; then
        source "${LIB_DIR}/${module}.sh"
    fi
done

usage() {
    cat <<'USAGE'
Usage: dokku-compose <command> [options] [app-name...]

Commands:
  up       Create/update apps and services to match config
  down     Destroy apps and services (requires --force)
  ps       Show status of configured apps
  setup    Install Dokku at declared version

Options:
  --file <path>    Config file (default: dokku-compose.yml)
  --dry-run        Print commands without executing
  --fail-fast      Stop on first error
  --help           Show this help
  --version        Show version

Examples:
  dokku-compose up                    # Configure all apps
  dokku-compose up myapp              # Configure one app
  dokku-compose up --dry-run          # Preview changes
  dokku-compose down --force myapp    # Destroy an app
  dokku-compose ps                    # Show status
USAGE
}

# Parse global options
DOKKU_COMPOSE_FAIL_FAST="${DOKKU_COMPOSE_FAIL_FAST:-false}"
COMMAND=""
APP_FILTER=()
FORCE=false

parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --file)
                DOKKU_COMPOSE_FILE="$2"
                shift 2
                ;;
            --dry-run)
                DOKKU_COMPOSE_DRY_RUN=true
                shift
                ;;
            --fail-fast)
                DOKKU_COMPOSE_FAIL_FAST=true
                shift
                ;;
            --force)
                FORCE=true
                shift
                ;;
            --help|-h)
                usage
                exit 0
                ;;
            --version|-v)
                echo "dokku-compose ${DOKKU_COMPOSE_VERSION}"
                exit 0
                ;;
            up|down|ps|setup)
                COMMAND="$1"
                shift
                ;;
            -*)
                echo "Unknown option: $1" >&2
                usage >&2
                exit 1
                ;;
            *)
                if [[ -z "$COMMAND" ]]; then
                    echo "Unknown command: $1" >&2
                    usage >&2
                    exit 1
                fi
                APP_FILTER+=("$1")
                shift
                ;;
        esac
    done

    if [[ -z "$COMMAND" ]]; then
        usage
        exit 1
    fi
}

# Get list of apps to process (respecting filter)
get_target_apps() {
    if [[ ${#APP_FILTER[@]} -gt 0 ]]; then
        printf '%s\n' "${APP_FILTER[@]}"
    else
        yaml_app_names
    fi
}

# Main commands (stubs for now, implemented by tasks 3-14)
cmd_up() {
    ensure_yq

    if [[ ! -f "$DOKKU_COMPOSE_FILE" ]]; then
        echo "Config file not found: $DOKKU_COMPOSE_FILE" >&2
        exit 1
    fi

    # Phase 1: Dokku version check
    if type ensure_dokku_version &>/dev/null; then
        ensure_dokku_version
    fi

    # Phase 2: Plugins
    if type ensure_plugins &>/dev/null; then
        ensure_plugins
    fi

    # Phase 3: Shared networks
    if type ensure_networks &>/dev/null; then
        ensure_networks
    fi

    # Phase 4: Per-app configuration
    local apps
    apps=$(get_target_apps)
    while IFS= read -r app; do
        [[ -z "$app" ]] && continue
        configure_app "$app" || {
            if [[ "$DOKKU_COMPOSE_FAIL_FAST" == "true" ]]; then
                echo "Failed on app: $app. Stopping (--fail-fast)." >&2
                exit 1
            fi
        }
    done <<< "$apps"

    if [[ "$DOKKU_COMPOSE_ERRORS" -gt 0 ]]; then
        echo ""
        log_error "summary" "${DOKKU_COMPOSE_ERRORS} error(s) occurred"
        exit 1
    fi
}

configure_app() {
    local app="$1"

    # Each ensure_* function is defined in its respective lib/*.sh module
    # They are called in dependency order
    if type ensure_app &>/dev/null; then ensure_app "$app"; fi
    if type ensure_vhosts_disabled &>/dev/null; then ensure_vhosts_disabled "$app"; fi
    if type ensure_app_postgres &>/dev/null; then ensure_app_postgres "$app"; fi
    if type ensure_app_redis &>/dev/null; then ensure_app_redis "$app"; fi
    if type ensure_app_networks &>/dev/null; then ensure_app_networks "$app"; fi
    if type ensure_app_ports &>/dev/null; then ensure_app_ports "$app"; fi
    if type ensure_app_certs &>/dev/null; then ensure_app_certs "$app"; fi
    if type ensure_app_nginx &>/dev/null; then ensure_app_nginx "$app"; fi
    if type ensure_app_config &>/dev/null; then ensure_app_config "$app"; fi
    if type ensure_app_builder &>/dev/null; then ensure_app_builder "$app"; fi
}

cmd_down() {
    if [[ "$FORCE" != "true" ]]; then
        echo "Error: --force flag required to destroy apps" >&2
        exit 1
    fi

    ensure_yq

    local apps
    apps=$(get_target_apps)
    while IFS= read -r app; do
        [[ -z "$app" ]] && continue
        if type destroy_app &>/dev/null; then
            destroy_app "$app"
        fi
    done <<< "$apps"
}

cmd_ps() {
    ensure_yq

    local apps
    apps=$(get_target_apps)
    while IFS= read -r app; do
        [[ -z "$app" ]] && continue
        if type show_app_status &>/dev/null; then
            show_app_status "$app"
        else
            echo "$app: (status check not implemented)"
        fi
    done <<< "$apps"
}

cmd_setup() {
    ensure_yq

    if type install_dokku &>/dev/null; then
        install_dokku
    else
        echo "Setup not yet implemented" >&2
        exit 1
    fi
}

# Main
parse_args "$@"

case "$COMMAND" in
    up)    cmd_up ;;
    down)  cmd_down ;;
    ps)    cmd_ps ;;
    setup) cmd_setup ;;
esac
```

**Step 4: Make executable and run tests**

Run: `chmod +x bin/dokku-compose`
Run: `./tests/bats/bin/bats tests/cli.bats`
Expected: All 4 tests pass

**Step 5: Commit**

```bash
git add bin/dokku-compose tests/cli.bats
git commit -m "feat: add CLI entry point with arg parsing and command dispatch"
```

---

### Task 3: lib/apps.sh — Application Management

**Files:**
- Create: `lib/apps.sh`
- Create: `tests/apps.bats`

**Dokku commands:** `apps:exists`, `apps:create`, `apps:destroy`, `domains:disable`
**Docs:** https://dokku.com/docs/deployment/application-management/

**Step 1: Write failing tests**

`tests/apps.bats`:
```bash
#!/usr/bin/env bash

setup() {
    load 'test_helper'
    setup_mocks
    source "${PROJECT_ROOT}/lib/apps.sh"
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/simple.yml"
}

teardown() {
    teardown_mocks
}

@test "ensure_app creates app when it doesn't exist" {
    mock_dokku_exit "apps:exists myapp" 1
    ensure_app "myapp"
    assert_dokku_called "apps:create myapp"
}

@test "ensure_app skips when app already exists" {
    mock_dokku_exit "apps:exists myapp" 0
    ensure_app "myapp"
    refute_dokku_called "apps:create myapp"
}

@test "ensure_vhosts_disabled calls domains:disable" {
    ensure_vhosts_disabled "myapp"
    assert_dokku_called "domains:disable myapp"
}

@test "destroy_app destroys with force when app exists" {
    mock_dokku_exit "apps:exists myapp" 0
    destroy_app "myapp"
    assert_dokku_called "apps:destroy myapp --force"
}

@test "destroy_app skips when app doesn't exist" {
    mock_dokku_exit "apps:exists myapp" 1
    destroy_app "myapp"
    refute_dokku_called "apps:destroy"
}
```

**Step 2: Run tests to verify they fail**

Run: `./tests/bats/bin/bats tests/apps.bats`
Expected: FAIL

**Step 3: Implement lib/apps.sh**

```bash
#!/usr/bin/env bash
# Dokku application management
# https://dokku.com/docs/deployment/application-management/

ensure_app() {
    local app="$1"

    if dokku_cmd_check apps:exists "$app"; then
        log_action "$app" "Creating app"
        log_skip
        return 0
    fi

    log_action "$app" "Creating app"
    dokku_cmd apps:create "$app"
    log_done
}

ensure_vhosts_disabled() {
    local app="$1"
    dokku_cmd domains:disable "$app" >/dev/null 2>&1 || true
}

destroy_app() {
    local app="$1"

    if ! dokku_cmd_check apps:exists "$app"; then
        log_action "$app" "Destroying app"
        log_skip
        return 0
    fi

    log_action "$app" "Destroying app"

    # Unlink services before destroying
    if type destroy_app_postgres &>/dev/null; then
        destroy_app_postgres "$app"
    fi
    if type destroy_app_redis &>/dev/null; then
        destroy_app_redis "$app"
    fi

    dokku_cmd apps:destroy "$app" --force
    log_done
}

show_app_status() {
    local app="$1"

    if ! dokku_cmd_check apps:exists "$app"; then
        printf "%-20s %s\n" "$app" "not created"
        return 0
    fi

    local status
    status=$(dokku_cmd ps:report "$app" --status-message 2>/dev/null || echo "unknown")
    printf "%-20s %s\n" "$app" "$status"
}
```

**Step 4: Run tests to verify they pass**

Run: `./tests/bats/bin/bats tests/apps.bats`
Expected: All 5 tests pass

**Step 5: Commit**

```bash
git add lib/apps.sh tests/apps.bats
git commit -m "feat: add app creation/destruction with idempotency checks"
```

---

### Task 4: lib/network.sh — Network Management

**Files:**
- Create: `lib/network.sh`
- Create: `tests/network.bats`

**Dokku commands:** `network:exists`, `network:create`, `network:set`
**Docs:** https://dokku.com/docs/networking/network/

**Step 1: Write failing tests**

`tests/network.bats`:
```bash
#!/usr/bin/env bash

setup() {
    load 'test_helper'
    setup_mocks
    source "${PROJECT_ROOT}/lib/network.sh"
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/full.yml"
}

teardown() {
    teardown_mocks
}

@test "ensure_networks creates missing networks" {
    mock_dokku_exit "network:exists studio-net" 1
    mock_dokku_exit "network:exists qultr-net" 1
    ensure_networks
    assert_dokku_called "network:create studio-net"
    assert_dokku_called "network:create qultr-net"
}

@test "ensure_networks skips existing networks" {
    mock_dokku_exit "network:exists studio-net" 0
    mock_dokku_exit "network:exists qultr-net" 0
    ensure_networks
    refute_dokku_called "network:create"
}

@test "ensure_app_networks attaches app to configured networks" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/full.yml"
    ensure_app_networks "studio"
    assert_dokku_called "network:set studio attach-post-deploy studio-net"
}

@test "ensure_app_networks skips when no networks configured" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/full.yml"
    ensure_app_networks "funqtion"
    refute_dokku_called "network:set funqtion"
}
```

**Step 2: Run tests to verify they fail**

Run: `./tests/bats/bin/bats tests/network.bats`
Expected: FAIL

**Step 3: Implement lib/network.sh**

```bash
#!/usr/bin/env bash
# Dokku network management
# https://dokku.com/docs/networking/network/

ensure_networks() {
    local networks
    networks=$(yaml_list '.networks[]')
    [[ -z "$networks" ]] && return 0

    while IFS= read -r net; do
        [[ -z "$net" ]] && continue

        if dokku_cmd_check network:exists "$net"; then
            log_action "networks" "Creating $net"
            log_skip
        else
            log_action "networks" "Creating $net"
            dokku_cmd network:create "$net"
            log_done
        fi
    done <<< "$networks"
}

ensure_app_networks() {
    local app="$1"

    if ! yaml_app_has "$app" ".networks"; then
        return 0
    fi

    local networks
    networks=$(yaml_app_list "$app" ".networks[]")
    [[ -z "$networks" ]] && return 0

    # Build space-separated network list for attach-post-deploy
    local net_list=""
    while IFS= read -r net; do
        [[ -z "$net" ]] && continue
        if [[ -n "$net_list" ]]; then
            net_list="${net_list} ${net}"
        else
            net_list="$net"
        fi
    done <<< "$networks"

    log_action "$app" "Attaching to networks: $net_list"
    dokku_cmd network:set "$app" attach-post-deploy "$net_list"
    log_done
}
```

**Step 4: Run tests to verify they pass**

Run: `./tests/bats/bin/bats tests/network.bats`
Expected: All 4 tests pass

**Step 5: Commit**

```bash
git add lib/network.sh tests/network.bats
git commit -m "feat: add network creation and app network attachment"
```

---

### Task 5: lib/plugins.sh — Plugin Management

**Files:**
- Create: `lib/plugins.sh`
- Create: `tests/plugins.bats`

**Dokku commands:** `plugin:list`, `plugin:install`
**Docs:** https://dokku.com/docs/advanced-usage/plugin-management/

**Step 1: Write failing tests**

`tests/plugins.bats`:
```bash
#!/usr/bin/env bash

setup() {
    load 'test_helper'
    setup_mocks
    source "${PROJECT_ROOT}/lib/plugins.sh"
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/full.yml"
}

teardown() {
    teardown_mocks
}

@test "ensure_plugins installs missing plugins" {
    mock_dokku_output "plugin:list" "  00_dokku-standard    0.35.12 true   dokku core standard plugin"
    ensure_plugins
    assert_dokku_called "plugin:install https://github.com/dokku/dokku-postgres.git --committish 1.41.0"
    assert_dokku_called "plugin:install https://github.com/dokku/dokku-redis.git"
}

@test "ensure_plugins skips already installed plugins" {
    mock_dokku_output "plugin:list" "  postgres    1.41.0 true   dokku postgres plugin\n  redis    7.0.0 true   dokku redis plugin"
    ensure_plugins
    refute_dokku_called "plugin:install"
}

@test "ensure_plugins skips when no plugins declared" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/simple.yml"
    ensure_plugins
    refute_dokku_called "plugin:install"
    refute_dokku_called "plugin:list"
}
```

**Step 2: Run tests, verify failure, implement, verify pass**

**Step 3: Implement lib/plugins.sh**

```bash
#!/usr/bin/env bash
# Dokku plugin management
# https://dokku.com/docs/advanced-usage/plugin-management/

ensure_plugins() {
    local plugins_defined
    plugins_defined=$(yaml_get '.dokku.plugins | keys | .[]' 2>/dev/null)
    [[ -z "$plugins_defined" || "$plugins_defined" == "null" ]] && return 0

    # Get currently installed plugins
    local installed
    installed=$(dokku_cmd plugin:list 2>/dev/null || true)

    while IFS= read -r plugin_name; do
        [[ -z "$plugin_name" ]] && continue

        # Check if already installed (plugin name appears in plugin:list output)
        if echo "$installed" | grep -q "  ${plugin_name} "; then
            log_action "plugins" "Plugin $plugin_name"
            log_skip
            continue
        fi

        local url version
        url=$(yaml_get ".dokku.plugins.${plugin_name}.url")
        version=$(yaml_get ".dokku.plugins.${plugin_name}.version")

        if [[ -z "$url" ]]; then
            log_error "plugins" "No URL specified for plugin: $plugin_name"
            continue
        fi

        log_action "plugins" "Installing $plugin_name"
        if [[ -n "$version" ]]; then
            dokku_cmd plugin:install "$url" --committish "$version"
        else
            dokku_cmd plugin:install "$url"
        fi
        log_done
    done <<< "$plugins_defined"
}
```

**Step 4: Run tests**

Run: `./tests/bats/bin/bats tests/plugins.bats`
Expected: All 3 tests pass

**Step 5: Commit**

```bash
git add lib/plugins.sh tests/plugins.bats
git commit -m "feat: add plugin installation with version pinning"
```

---

### Task 6: lib/postgres.sh — PostgreSQL Service Management

**Files:**
- Create: `lib/postgres.sh`
- Create: `tests/postgres.bats`

**Dokku commands:** `postgres:exists`, `postgres:create`, `postgres:link`, `postgres:linked`
**Docs:** https://github.com/dokku/dokku-postgres

**Step 1: Write failing tests**

`tests/postgres.bats`:
```bash
#!/usr/bin/env bash

setup() {
    load 'test_helper'
    setup_mocks
    source "${PROJECT_ROOT}/lib/postgres.sh"
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/full.yml"
}

teardown() {
    teardown_mocks
}

@test "ensure_app_postgres creates and links when postgres: true" {
    mock_dokku_exit "postgres:exists studio-db" 1
    mock_dokku_exit "postgres:linked studio-db studio" 1
    ensure_app_postgres "studio"
    assert_dokku_called "postgres:create studio-db"
    assert_dokku_called "postgres:link studio-db studio --no-restart"
}

@test "ensure_app_postgres creates with version and image" {
    mock_dokku_exit "postgres:exists funqtion-db" 1
    mock_dokku_exit "postgres:linked funqtion-db funqtion" 1
    ensure_app_postgres "funqtion"
    assert_dokku_called "postgres:create funqtion-db -I 17-3.5 -i postgis/postgis"
    assert_dokku_called "postgres:link funqtion-db funqtion --no-restart"
}

@test "ensure_app_postgres skips when already exists and linked" {
    mock_dokku_exit "postgres:exists studio-db" 0
    mock_dokku_exit "postgres:linked studio-db studio" 0
    ensure_app_postgres "studio"
    refute_dokku_called "postgres:create"
    refute_dokku_called "postgres:link"
}

@test "ensure_app_postgres links existing unlinked service" {
    mock_dokku_exit "postgres:exists studio-db" 0
    mock_dokku_exit "postgres:linked studio-db studio" 1
    ensure_app_postgres "studio"
    refute_dokku_called "postgres:create"
    assert_dokku_called "postgres:link studio-db studio --no-restart"
}

@test "ensure_app_postgres skips when no postgres configured" {
    ensure_app_postgres "qultr-sandbox"
    refute_dokku_called "postgres:create"
    refute_dokku_called "postgres:link"
}
```

**Step 2: Implement lib/postgres.sh**

```bash
#!/usr/bin/env bash
# Dokku PostgreSQL service management (plugin)
# https://github.com/dokku/dokku-postgres

ensure_app_postgres() {
    local app="$1"

    if ! yaml_app_has "$app" ".postgres"; then
        return 0
    fi

    local service="${app}-db"
    local pg_config
    pg_config=$(yaml_app_get "$app" ".postgres")

    # Build create flags
    local create_flags=()
    if [[ "$pg_config" != "true" ]]; then
        local version image
        version=$(yaml_app_get "$app" ".postgres.version")
        image=$(yaml_app_get "$app" ".postgres.image")
        [[ -n "$version" ]] && create_flags+=(-I "$version")
        [[ -n "$image" ]] && create_flags+=(-i "$image")
    fi

    # Create service if needed
    if ! dokku_cmd_check postgres:exists "$service"; then
        log_action "$app" "Creating postgres${create_flags[*]:+ (${create_flags[*]})}"
        dokku_cmd postgres:create "$service" "${create_flags[@]}"
        log_done
    else
        log_action "$app" "Postgres service"
        log_skip
    fi

    # Link if not already linked
    if ! dokku_cmd_check postgres:linked "$service" "$app"; then
        log_action "$app" "Linking postgres"
        dokku_cmd postgres:link "$service" "$app" --no-restart
        log_done
    else
        log_action "$app" "Postgres link"
        log_skip
    fi
}

destroy_app_postgres() {
    local app="$1"
    local service="${app}-db"

    if ! dokku_cmd_check postgres:exists "$service"; then
        return 0
    fi

    # Unlink if linked
    if dokku_cmd_check postgres:linked "$service" "$app"; then
        log_action "$app" "Unlinking postgres"
        dokku_cmd postgres:unlink "$service" "$app" --no-restart
        log_done
    fi

    log_action "$app" "Destroying postgres"
    dokku_cmd postgres:destroy "$service" --force
    log_done
}
```

**Step 3: Run tests**

Run: `./tests/bats/bin/bats tests/postgres.bats`
Expected: All 5 tests pass

**Step 4: Commit**

```bash
git add lib/postgres.sh tests/postgres.bats
git commit -m "feat: add PostgreSQL service creation, linking, and teardown"
```

---

### Task 7: lib/redis.sh — Redis Service Management

**Files:**
- Create: `lib/redis.sh`
- Create: `tests/redis.bats`

**Dokku commands:** `redis:exists`, `redis:create`, `redis:link`, `redis:linked`
**Docs:** https://github.com/dokku/dokku-redis

**Step 1: Write failing tests**

`tests/redis.bats`:
```bash
#!/usr/bin/env bash

setup() {
    load 'test_helper'
    setup_mocks
    source "${PROJECT_ROOT}/lib/redis.sh"
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/full.yml"
}

teardown() {
    teardown_mocks
}

@test "ensure_app_redis creates and links when redis: true" {
    mock_dokku_exit "redis:exists studio-redis" 1
    mock_dokku_exit "redis:linked studio-redis studio" 1
    ensure_app_redis "studio"
    assert_dokku_called "redis:create studio-redis"
    assert_dokku_called "redis:link studio-redis studio --no-restart"
}

@test "ensure_app_redis creates with version" {
    mock_dokku_exit "redis:exists funqtion-redis" 1
    mock_dokku_exit "redis:linked funqtion-redis funqtion" 1
    ensure_app_redis "funqtion"
    assert_dokku_called "redis:create funqtion-redis -I 7.2-alpine"
}

@test "ensure_app_redis skips when already exists and linked" {
    mock_dokku_exit "redis:exists studio-redis" 0
    mock_dokku_exit "redis:linked studio-redis studio" 0
    ensure_app_redis "studio"
    refute_dokku_called "redis:create"
    refute_dokku_called "redis:link"
}

@test "ensure_app_redis skips when no redis configured" {
    ensure_app_redis "qultr-sandbox"
    refute_dokku_called "redis:create"
    refute_dokku_called "redis:link"
}
```

**Step 2: Implement lib/redis.sh**

```bash
#!/usr/bin/env bash
# Dokku Redis service management (plugin)
# https://github.com/dokku/dokku-redis

ensure_app_redis() {
    local app="$1"

    if ! yaml_app_has "$app" ".redis"; then
        return 0
    fi

    local service="${app}-redis"
    local redis_config
    redis_config=$(yaml_app_get "$app" ".redis")

    # Build create flags
    local create_flags=()
    if [[ "$redis_config" != "true" ]]; then
        local version
        version=$(yaml_app_get "$app" ".redis.version")
        [[ -n "$version" ]] && create_flags+=(-I "$version")
    fi

    # Create service if needed
    if ! dokku_cmd_check redis:exists "$service"; then
        log_action "$app" "Creating redis${create_flags[*]:+ (${create_flags[*]})}"
        dokku_cmd redis:create "$service" "${create_flags[@]}"
        log_done
    else
        log_action "$app" "Redis service"
        log_skip
    fi

    # Link if not already linked
    if ! dokku_cmd_check redis:linked "$service" "$app"; then
        log_action "$app" "Linking redis"
        dokku_cmd redis:link "$service" "$app" --no-restart
        log_done
    else
        log_action "$app" "Redis link"
        log_skip
    fi
}

destroy_app_redis() {
    local app="$1"
    local service="${app}-redis"

    if ! dokku_cmd_check redis:exists "$service"; then
        return 0
    fi

    if dokku_cmd_check redis:linked "$service" "$app"; then
        log_action "$app" "Unlinking redis"
        dokku_cmd redis:unlink "$service" "$app" --no-restart
        log_done
    fi

    log_action "$app" "Destroying redis"
    dokku_cmd redis:destroy "$service" --force
    log_done
}
```

**Step 3: Run tests, verify pass, commit**

```bash
git add lib/redis.sh tests/redis.bats
git commit -m "feat: add Redis service creation, linking, and teardown"
```

---

### Task 8: lib/ports.sh — Port Management

**Files:**
- Create: `lib/ports.sh`
- Create: `tests/ports.bats`

**Dokku commands:** `ports:set`, `ports:report`
**Docs:** https://dokku.com/docs/networking/port-management/

**Step 1: Write failing tests**

`tests/ports.bats`:
```bash
#!/usr/bin/env bash

setup() {
    load 'test_helper'
    setup_mocks
    source "${PROJECT_ROOT}/lib/ports.sh"
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/full.yml"
}

teardown() {
    teardown_mocks
}

@test "ensure_app_ports sets configured port mappings" {
    mock_dokku_output "ports:report funqtion --ports-map" ""
    ensure_app_ports "funqtion"
    assert_dokku_called "ports:set funqtion https:4001:4000"
}

@test "ensure_app_ports skips when ports already match" {
    mock_dokku_output "ports:report funqtion --ports-map" "https:4001:4000"
    ensure_app_ports "funqtion"
    refute_dokku_called "ports:set"
}

@test "ensure_app_ports skips when no ports configured" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/simple.yml"
    # simple.yml has myapp with http:5000:5000
    mock_dokku_output "ports:report myapp --ports-map" ""
    ensure_app_ports "myapp"
    assert_dokku_called "ports:set myapp http:5000:5000"
}
```

**Step 2: Implement lib/ports.sh**

```bash
#!/usr/bin/env bash
# Dokku port management
# https://dokku.com/docs/networking/port-management/

ensure_app_ports() {
    local app="$1"

    if ! yaml_app_has "$app" ".ports"; then
        return 0
    fi

    local ports
    ports=$(yaml_app_list "$app" ".ports[]")
    [[ -z "$ports" ]] && return 0

    # Build desired port list (space-separated)
    local port_args=()
    while IFS= read -r port; do
        [[ -z "$port" ]] && continue
        port_args+=("$port")
    done <<< "$ports"

    # Check current state
    local current
    current=$(dokku_cmd ports:report "$app" --ports-map 2>/dev/null || true)

    # Compare (simple string match — ports:set is replace-all)
    local desired="${port_args[*]}"
    if [[ "$current" == "$desired" ]]; then
        log_action "$app" "Port mappings"
        log_skip
        return 0
    fi

    log_action "$app" "Setting ports: ${desired}"
    dokku_cmd ports:set "$app" "${port_args[@]}"
    log_done
}
```

**Step 3: Run tests, verify pass, commit**

```bash
git add lib/ports.sh tests/ports.bats
git commit -m "feat: add port mapping configuration"
```

---

### Task 9: lib/certs.sh — SSL Certificate Management

**Files:**
- Create: `lib/certs.sh`
- Create: `tests/certs.bats`

**Dokku commands:** `certs:add`, `certs:report`
**Docs:** https://dokku.com/docs/configuration/ssl/

**Step 1: Write failing tests**

`tests/certs.bats`:
```bash
#!/usr/bin/env bash

setup() {
    load 'test_helper'
    setup_mocks
    source "${PROJECT_ROOT}/lib/certs.sh"
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/full.yml"
}

teardown() {
    teardown_mocks
}

@test "ensure_app_certs skips when no ssl configured" {
    ensure_app_certs "qultr-sandbox"
    refute_dokku_called "certs:add"
}

@test "ensure_app_certs adds certificate from directory" {
    # Create mock cert directory
    local cert_dir="${MOCK_DIR}/certs/funqtion.co"
    mkdir -p "$cert_dir"
    echo "CERT" > "$cert_dir/cert.crt"
    echo "KEY" > "$cert_dir/cert.key"

    # Override yaml_app_get to return our mock path
    yaml_app_get() {
        if [[ "$2" == ".ssl" ]]; then
            echo "${cert_dir}"
        fi
    }

    ensure_app_certs "funqtion"
    assert_dokku_called "certs:add funqtion"
}

@test "ensure_app_certs errors on missing cert files" {
    yaml_app_get() {
        if [[ "$2" == ".ssl" ]]; then
            echo "/nonexistent/path"
        fi
    }

    ensure_app_certs "funqtion"
    # Should have logged an error, not crashed
    [[ "$DOKKU_COMPOSE_ERRORS" -gt 0 ]]
}
```

**Step 2: Implement lib/certs.sh**

```bash
#!/usr/bin/env bash
# Dokku SSL certificate management
# https://dokku.com/docs/configuration/ssl/

ensure_app_certs() {
    local app="$1"

    local ssl_path
    ssl_path=$(yaml_app_get "$app" ".ssl")
    [[ -z "$ssl_path" ]] && return 0

    local cert_file="${ssl_path}/cert.crt"
    local key_file="${ssl_path}/cert.key"

    if [[ ! -f "$cert_file" || ! -f "$key_file" ]]; then
        log_error "$app" "SSL cert files not found in: $ssl_path (expected cert.crt and cert.key)"
        return 1
    fi

    log_action "$app" "Adding SSL certificate"
    tar cf - -C "$ssl_path" cert.crt cert.key | dokku_cmd certs:add "$app"
    log_done
}
```

**Step 3: Run tests, verify pass, commit**

```bash
git add lib/certs.sh tests/certs.bats
git commit -m "feat: add SSL certificate management"
```

---

### Task 10: lib/nginx.sh — Nginx Proxy Configuration

**Files:**
- Create: `lib/nginx.sh`
- Create: `tests/nginx.bats`

**Dokku commands:** `nginx:set`
**Docs:** https://dokku.com/docs/networking/proxies/nginx/

**Step 1: Write failing tests**

`tests/nginx.bats`:
```bash
#!/usr/bin/env bash

setup() {
    load 'test_helper'
    setup_mocks
    source "${PROJECT_ROOT}/lib/nginx.sh"
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/full.yml"
}

teardown() {
    teardown_mocks
}

@test "ensure_app_nginx sets configured properties" {
    ensure_app_nginx "qultr"
    assert_dokku_called "nginx:set qultr client-max-body-size 15m"
}

@test "ensure_app_nginx skips when no nginx configured" {
    ensure_app_nginx "studio"
    refute_dokku_called "nginx:set"
}
```

**Step 2: Implement lib/nginx.sh**

```bash
#!/usr/bin/env bash
# Dokku nginx proxy configuration
# https://dokku.com/docs/networking/proxies/nginx/

ensure_app_nginx() {
    local app="$1"

    if ! yaml_app_has "$app" ".nginx"; then
        return 0
    fi

    local keys
    keys=$(yaml_app_map_keys "$app" ".nginx")
    [[ -z "$keys" ]] && return 0

    while IFS= read -r key; do
        [[ -z "$key" ]] && continue
        local value
        value=$(yaml_app_map_get "$app" ".nginx" "$key")

        log_action "$app" "Setting nginx $key=$value"
        dokku_cmd nginx:set "$app" "$key" "$value"
        log_done
    done <<< "$keys"
}
```

**Step 3: Run tests, verify pass, commit**

```bash
git add lib/nginx.sh tests/nginx.bats
git commit -m "feat: add nginx proxy property configuration"
```

---

### Task 11: lib/config.sh — Environment Variables

**Files:**
- Create: `lib/config.sh`
- Create: `tests/config.bats`

**Dokku commands:** `config:set`, `config:export`
**Docs:** https://dokku.com/docs/configuration/environment-variables/

**Step 1: Write failing tests**

`tests/config.bats`:
```bash
#!/usr/bin/env bash

setup() {
    load 'test_helper'
    setup_mocks
    source "${PROJECT_ROOT}/lib/config.sh"
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/full.yml"
}

teardown() {
    teardown_mocks
}

@test "ensure_app_config sets env vars with --no-restart" {
    ensure_app_config "funqtion"
    assert_dokku_called "config:set --no-restart funqtion"
    assert_dokku_called "APP_ENV=staging"
}

@test "ensure_app_config skips when no env configured" {
    ensure_app_config "qultr-sandbox"
    refute_dokku_called "config:set"
}
```

**Step 2: Implement lib/config.sh**

```bash
#!/usr/bin/env bash
# Dokku environment variable management
# https://dokku.com/docs/configuration/environment-variables/

ensure_app_config() {
    local app="$1"

    if ! yaml_app_has "$app" ".env"; then
        return 0
    fi

    local keys
    keys=$(yaml_app_map_keys "$app" ".env")
    [[ -z "$keys" ]] && return 0

    # Build KEY=VALUE pairs for a single config:set call
    local env_pairs=()
    while IFS= read -r key; do
        [[ -z "$key" ]] && continue
        local value
        value=$(yaml_app_map_get "$app" ".env" "$key")
        # Resolve ${VAR} references
        value=$(resolve_env_vars "$value")
        env_pairs+=("${key}=${value}")
    done <<< "$keys"

    if [[ ${#env_pairs[@]} -eq 0 ]]; then
        return 0
    fi

    log_action "$app" "Setting ${#env_pairs[@]} env var(s)"
    dokku_cmd config:set --no-restart "$app" "${env_pairs[@]}"
    log_done
}
```

**Step 3: Run tests, verify pass, commit**

```bash
git add lib/config.sh tests/config.bats
git commit -m "feat: add environment variable configuration"
```

---

### Task 12: lib/builder.sh — Dockerfile Builder Configuration

**Files:**
- Create: `lib/builder.sh`
- Create: `tests/builder.bats`

**Dokku commands:** `builder-dockerfile:set`, `app-json:set`, `docker-options:add`
**Docs:** https://dokku.com/docs/builders/dockerfiles/

**Step 1: Write failing tests**

`tests/builder.bats`:
```bash
#!/usr/bin/env bash

setup() {
    load 'test_helper'
    setup_mocks
    source "${PROJECT_ROOT}/lib/builder.sh"
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/full.yml"
}

teardown() {
    teardown_mocks
}

@test "ensure_app_builder sets dockerfile path" {
    ensure_app_builder "funqtion"
    assert_dokku_called "builder-dockerfile:set funqtion dockerfile-path docker/prod/api/Dockerfile"
}

@test "ensure_app_builder sets app_json path" {
    ensure_app_builder "funqtion"
    assert_dokku_called "app-json:set funqtion appjson-path docker/prod/api/app.json"
}

@test "ensure_app_builder sets build args" {
    ensure_app_builder "funqtion"
    assert_dokku_called "docker-options:add funqtion build --build-arg SENTRY_AUTH_TOKEN=test-token"
}

@test "ensure_app_builder sets build_dir as APP_PATH build arg" {
    ensure_app_builder "funqtion"
    assert_dokku_called "docker-options:add funqtion build --build-arg APP_PATH=apps/funqtion-api"
}

@test "ensure_app_builder skips when no builder config" {
    ensure_app_builder "qultr-sandbox"
    # qultr-sandbox has dockerfile but no app_json or build_args
    assert_dokku_called "builder-dockerfile:set qultr-sandbox dockerfile-path docker/prod/sandbox/Dockerfile"
    refute_dokku_called "app-json:set qultr-sandbox"
}
```

**Step 2: Implement lib/builder.sh**

```bash
#!/usr/bin/env bash
# Dokku Dockerfile builder configuration
# https://dokku.com/docs/builders/dockerfiles/

ensure_app_builder() {
    local app="$1"

    # Dockerfile path
    local dockerfile
    dockerfile=$(yaml_app_get "$app" ".dockerfile")
    if [[ -n "$dockerfile" ]]; then
        log_action "$app" "Setting dockerfile path"
        dokku_cmd builder-dockerfile:set "$app" dockerfile-path "$dockerfile"
        log_done
    fi

    # app.json path
    local app_json
    app_json=$(yaml_app_get "$app" ".app_json")
    if [[ -n "$app_json" ]]; then
        log_action "$app" "Setting app.json path"
        dokku_cmd app-json:set "$app" appjson-path "$app_json"
        log_done
    fi

    # Build dir as APP_PATH build arg
    local build_dir
    build_dir=$(yaml_app_get "$app" ".build_dir")
    if [[ -n "$build_dir" ]]; then
        log_action "$app" "Setting build dir (APP_PATH)"
        dokku_cmd docker-options:add "$app" build "--build-arg APP_PATH=${build_dir}"
        log_done

        # Also set APP_NAME
        log_action "$app" "Setting APP_NAME build arg"
        dokku_cmd docker-options:add "$app" build "--build-arg APP_NAME=${app}"
        log_done
    fi

    # Custom build args
    if yaml_app_has "$app" ".build_args"; then
        local keys
        keys=$(yaml_app_map_keys "$app" ".build_args")
        while IFS= read -r key; do
            [[ -z "$key" ]] && continue
            local value
            value=$(yaml_app_map_get "$app" ".build_args" "$key")
            value=$(resolve_env_vars "$value")
            log_action "$app" "Setting build arg $key"
            dokku_cmd docker-options:add "$app" build "--build-arg ${key}=${value}"
            log_done
        done <<< "$keys"
    fi
}
```

**Step 3: Run tests, verify pass, commit**

```bash
git add lib/builder.sh tests/builder.bats
git commit -m "feat: add Dockerfile builder configuration"
```

---

### Task 13: lib/dokku.sh — Dokku Version Check

**Files:**
- Create: `lib/dokku.sh`
- Create: `tests/dokku.bats`

**Dokku commands:** `version`
**Docs:** https://dokku.com/docs/getting-started/installation/

**Step 1: Write failing tests**

`tests/dokku.bats`:
```bash
#!/usr/bin/env bash

setup() {
    load 'test_helper'
    setup_mocks
    source "${PROJECT_ROOT}/lib/dokku.sh"
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/full.yml"
}

teardown() {
    teardown_mocks
}

@test "ensure_dokku_version warns on mismatch" {
    mock_dokku_output "version" "dokku version 0.34.0"
    run ensure_dokku_version
    assert_output --partial "WARN"
}

@test "ensure_dokku_version silent on match" {
    mock_dokku_output "version" "dokku version 0.35.12"
    run ensure_dokku_version
    refute_output --partial "WARN"
}

@test "ensure_dokku_version skips when no version declared" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/simple.yml"
    run ensure_dokku_version
    refute_output --partial "WARN"
}
```

**Step 2: Implement lib/dokku.sh**

```bash
#!/usr/bin/env bash
# Dokku version management
# https://dokku.com/docs/getting-started/installation/

ensure_dokku_version() {
    local desired
    desired=$(yaml_get '.dokku.version')
    [[ -z "$desired" ]] && return 0

    local current
    current=$(dokku_cmd version 2>/dev/null | grep -oP '\d+\.\d+\.\d+' || echo "unknown")

    if [[ "$current" != "$desired" ]]; then
        log_warn "dokku" "Version mismatch: running $current, config expects $desired"
    fi
}

install_dokku() {
    local desired
    desired=$(yaml_get '.dokku.version')

    if [[ -z "$desired" ]]; then
        echo "No dokku.version specified in config" >&2
        return 1
    fi

    if command -v dokku &>/dev/null; then
        local current
        current=$(dokku version 2>/dev/null | grep -oP '\d+\.\d+\.\d+' || echo "unknown")
        if [[ "$current" == "$desired" ]]; then
            echo "Dokku $desired is already installed"
            return 0
        fi
        echo "Dokku $current is installed, config expects $desired"
        echo "Upgrade manually: https://dokku.com/docs/getting-started/upgrading/"
        return 1
    fi

    echo "Installing Dokku $desired..."
    curl -fsSL "https://packagecloud.io/dokku/dokku/gpgkey" | gpg --dearmor -o /usr/share/keyrings/dokku-archive-keyring.gpg
    echo "deb [signed-by=/usr/share/keyrings/dokku-archive-keyring.gpg] https://packagecloud.io/dokku/dokku/ubuntu/ $(lsb_release -cs) main" | tee /etc/apt/sources.list.d/dokku.list
    apt-get update
    apt-get install -y "dokku=${desired}"
    echo "Dokku $desired installed"
}
```

**Step 3: Run tests, verify pass, commit**

```bash
git add lib/dokku.sh tests/dokku.bats
git commit -m "feat: add Dokku version check and install"
```

---

### Task 14: lib/git.sh — Git Deployment (stub)

**Files:**
- Create: `lib/git.sh`

This is out of scope per the design doc (deployment is separate from configuration), but we create the file as a placeholder with documentation.

**Step 1: Create stub**

```bash
#!/usr/bin/env bash
# Dokku git deployment
# https://dokku.com/docs/deployment/methods/git/
#
# NOTE: App deployment (git:sync, git:from-image) is intentionally
# out of scope for dokku-compose. This tool handles infrastructure
# configuration; deployment is a separate concern.
#
# To deploy after running `dokku-compose up`:
#   dokku git:sync <app> <repo-url> <branch> --build
```

**Step 2: Commit**

```bash
git add lib/git.sh
git commit -m "docs: add git deployment stub with usage notes"
```

---

### Task 15: Integration Tests

**Files:**
- Create: `tests/integration.bats`

**Step 1: Write integration tests**

`tests/integration.bats`:
```bash
#!/usr/bin/env bash

setup() {
    load 'test_helper'
    setup_mocks

    # Source all modules
    for module in apps network plugins postgres redis ports certs nginx config builder dokku; do
        source "${PROJECT_ROOT}/lib/${module}.sh"
    done

    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/full.yml"
}

teardown() {
    teardown_mocks
}

@test "full up: creates all networks" {
    mock_dokku_exit "network:exists studio-net" 1
    mock_dokku_exit "network:exists qultr-net" 1
    ensure_networks
    assert_dokku_called "network:create studio-net"
    assert_dokku_called "network:create qultr-net"
}

@test "full up: configures app with all features" {
    local app="funqtion"

    # Mock everything as not existing
    mock_dokku_exit "apps:exists $app" 1
    mock_dokku_exit "postgres:exists ${app}-db" 1
    mock_dokku_exit "postgres:linked ${app}-db $app" 1
    mock_dokku_exit "redis:exists ${app}-redis" 1
    mock_dokku_exit "redis:linked ${app}-redis $app" 1
    mock_dokku_output "ports:report $app --ports-map" ""

    # Run all ensure functions (same order as configure_app)
    ensure_app "$app"
    ensure_vhosts_disabled "$app"
    ensure_app_postgres "$app"
    ensure_app_redis "$app"
    ensure_app_ports "$app"
    ensure_app_config "$app"
    ensure_app_builder "$app"

    # Verify key commands were called
    assert_dokku_called "apps:create funqtion"
    assert_dokku_called "domains:disable funqtion"
    assert_dokku_called "postgres:create funqtion-db -I 17-3.5 -i postgis/postgis"
    assert_dokku_called "postgres:link funqtion-db funqtion --no-restart"
    assert_dokku_called "redis:create funqtion-redis -I 7.2-alpine"
    assert_dokku_called "redis:link funqtion-redis funqtion --no-restart"
    assert_dokku_called "ports:set funqtion https:4001:4000"
    assert_dokku_called "config:set --no-restart funqtion"
    assert_dokku_called "builder-dockerfile:set funqtion dockerfile-path docker/prod/api/Dockerfile"
    assert_dokku_called "app-json:set funqtion appjson-path docker/prod/api/app.json"
}

@test "full up: idempotent when everything exists" {
    local app="studio"

    # Mock everything as already existing/configured
    mock_dokku_exit "apps:exists $app" 0
    mock_dokku_exit "postgres:exists ${app}-db" 0
    mock_dokku_exit "postgres:linked ${app}-db $app" 0
    mock_dokku_exit "redis:exists ${app}-redis" 0
    mock_dokku_exit "redis:linked ${app}-redis $app" 0
    mock_dokku_output "ports:report $app --ports-map" "https:4002:4000"

    ensure_app "$app"
    ensure_app_postgres "$app"
    ensure_app_redis "$app"
    ensure_app_ports "$app"

    # Should NOT have created/linked anything
    refute_dokku_called "apps:create"
    refute_dokku_called "postgres:create"
    refute_dokku_called "postgres:link"
    refute_dokku_called "redis:create"
    refute_dokku_called "redis:link"
    refute_dokku_called "ports:set"
}

@test "simple config: minimal app setup" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/simple.yml"

    mock_dokku_exit "apps:exists myapp" 1
    mock_dokku_exit "postgres:exists myapp-db" 1
    mock_dokku_exit "postgres:linked myapp-db myapp" 1
    mock_dokku_output "ports:report myapp --ports-map" ""

    ensure_app "myapp"
    ensure_app_postgres "myapp"
    ensure_app_ports "myapp"

    assert_dokku_called "apps:create myapp"
    assert_dokku_called "postgres:create myapp-db"
    assert_dokku_called "ports:set myapp http:5000:5000"
}
```

**Step 2: Run all tests**

Run: `./tests/bats/bin/bats tests/`
Expected: All tests pass

**Step 3: Commit**

```bash
git add tests/integration.bats
git commit -m "test: add integration tests for full up/down workflows"
```

---

### Task 16: Example Config + Final Polish

**Files:**
- Create: `dokku-compose.yml.example`
- Create: `tests/fixtures/invalid.yml`

**Step 1: Create example config**

`dokku-compose.yml.example`:
```yaml
# dokku-compose.yml
# Declarative Dokku deployment configuration
# Docs: https://github.com/your-org/dokku-compose

# Optional: Dokku version and plugins
dokku:
  version: "0.35.12"
  plugins:
    postgres:
      url: https://github.com/dokku/dokku-postgres.git
    redis:
      url: https://github.com/dokku/dokku-redis.git

# Shared Docker networks for inter-app communication
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
      image: postgis/postgis        # optional image override
    redis:
      version: "7.2-alpine"
    nginx:
      client-max-body-size: "15m"
      proxy-buffer-size: "8k"
    env:
      APP_ENV: "${APP_ENV}"          # resolved from shell environment
      SECRET_KEY: "${SECRET_KEY}"
    build_args:
      SENTRY_AUTH_TOKEN: "${SENTRY_AUTH_TOKEN}"
    networks:
      - backend-net

  # Minimal example — just an app with a database
  worker:
    build_dir: apps/worker
    ports:
      - "http:5001:5000"
    postgres: true                   # shorthand: default version
    networks:
      - backend-net

  # Web frontend — no database
  web:
    dockerfile: docker/prod/web/Dockerfile
    build_dir: apps/web
    ports:
      - "https:3000:3000"
    ssl: certs/example.com
```

**Step 2: Create invalid fixture for error tests**

`tests/fixtures/invalid.yml`:
```yaml
# Invalid config for error testing
apps:
  broken-app:
    ports: "not-a-list"
```

**Step 3: Commit**

```bash
git add dokku-compose.yml.example tests/fixtures/invalid.yml
git commit -m "docs: add example config and invalid test fixture"
```

---

### Task 17: Run Full Test Suite + Fix Issues

**Step 1: Run all tests**

Run: `./tests/bats/bin/bats tests/`
Expected: All tests pass

**Step 2: Run CLI smoke test with dry-run**

Run: `DOKKU_COMPOSE_FILE=dokku-compose.yml.example bin/dokku-compose up --dry-run`
Expected: See dry-run output listing all commands that would be executed

**Step 3: Fix any issues found**

Address any test failures or runtime errors.

**Step 4: Final commit**

```bash
git add -A
git commit -m "fix: resolve issues found during full test suite run"
```

---

## Summary

| Task | Module | Dokku Namespace | Key Functions |
|------|--------|----------------|---------------|
| 1 | core.sh, yaml.sh | — | `dokku_cmd`, `yaml_get`, `yaml_app_*` |
| 2 | bin/dokku-compose | — | `parse_args`, `cmd_up`, `cmd_down`, `cmd_ps` |
| 3 | apps.sh | `apps:*`, `domains:*` | `ensure_app`, `destroy_app` |
| 4 | network.sh | `network:*` | `ensure_networks`, `ensure_app_networks` |
| 5 | plugins.sh | `plugin:*` | `ensure_plugins` |
| 6 | postgres.sh | `postgres:*` | `ensure_app_postgres`, `destroy_app_postgres` |
| 7 | redis.sh | `redis:*` | `ensure_app_redis`, `destroy_app_redis` |
| 8 | ports.sh | `ports:*` | `ensure_app_ports` |
| 9 | certs.sh | `certs:*` | `ensure_app_certs` |
| 10 | nginx.sh | `nginx:*` | `ensure_app_nginx` |
| 11 | config.sh | `config:*` | `ensure_app_config` |
| 12 | builder.sh | `builder-dockerfile:*` | `ensure_app_builder` |
| 13 | dokku.sh | `version` | `ensure_dokku_version`, `install_dokku` |
| 14 | git.sh | `git:*` | (stub) |
| 15 | integration tests | — | End-to-end test coverage |
| 16 | example + fixtures | — | Documentation, error test cases |
| 17 | full test run | — | Verification + fixes |
