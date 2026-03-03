# Module Contract & Helpers Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add generic helper functions to `lib/core.sh`, refactor existing modules to use them, rename `ssl` → `certs` and restructure `builder` YAML, then add new simple modules for planned namespaces.

**Architecture:** Helpers go in `core.sh` since every module already sources it. Each new module is a single file in `lib/` with tests in `tests/`. Existing modules are refactored incrementally — one commit per module. Fixture files are updated atomically alongside the code that reads them.

**Tech Stack:** Bash, BATS, yq

**Reference:** Design doc at `docs/plans/2026-03-03-module-contract-design.md`

---

### Task 1: Add helper functions to core.sh

**Files:**
- Modify: `lib/core.sh:72` (append after `dokku_cmd_check`)
- Create: `tests/core_helpers.bats`

**Important:** All `yaml_*` functions use dot-prefixed paths (e.g., `yaml_app_has "$app" ".nginx"`). The helpers must prepend the dot when calling yaml functions.

**Step 1: Write failing tests**

Create `tests/core_helpers.bats`:

```bash
#!/usr/bin/env bash

setup() {
    load 'test_helper'
    setup_mocks
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/full.yml"
}

teardown() {
    teardown_mocks
}

# --- dokku_set_properties ---

@test "dokku_set_properties sets each key-value pair" {
    dokku_set_properties "qultr" "nginx"
    assert_dokku_called "nginx:set qultr client-max-body-size 15m"
}

@test "dokku_set_properties skips when key absent" {
    dokku_set_properties "studio" "nginx"
    refute_dokku_called "nginx:set"
}

# --- dokku_set_list ---

@test "dokku_set_list sets all list items in one call" {
    dokku_set_list "funqtion" "ports"
    assert_dokku_called "ports:set funqtion https:4001:4000"
}

@test "dokku_set_list skips when key absent" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/simple.yml"
    dokku_set_list "myapp" "nginx"
    refute_dokku_called "nginx:set"
}

# --- dokku_set_property ---

@test "dokku_set_property sets a single scalar value" {
    # Need a fixture with scheduler key — use a temp file
    local tmpfile="${MOCK_DIR}/scalar.yml"
    cat > "$tmpfile" <<'EOF'
apps:
  testapp:
    scheduler: docker-local
EOF
    DOKKU_COMPOSE_FILE="$tmpfile"
    dokku_set_property "testapp" "scheduler" "selected"
    assert_dokku_called "scheduler:set testapp selected docker-local"
}

@test "dokku_set_property skips when key absent" {
    dokku_set_property "studio" "scheduler" "selected"
    refute_dokku_called "scheduler:set"
}
```

**Step 2: Run tests to verify they fail**

Run: `./tests/bats/bin/bats tests/core_helpers.bats`
Expected: FAIL — `dokku_set_properties: command not found`

**Step 3: Add helper functions to core.sh**

Append to `lib/core.sh` after the `dokku_cmd_check` function (after line 71):

```bash

# --- Helper functions for common module patterns ---

# Set each key-value pair from a YAML map via <namespace>:set.
# Usage: dokku_set_properties <app> <namespace>
# Example: dokku_set_properties "myapp" "nginx"
#   Reads apps.myapp.nginx: {client-max-body-size: "15m"}
#   Calls: dokku nginx:set myapp client-max-body-size 15m
dokku_set_properties() {
    local app="$1" ns="$2"
    yaml_app_has "$app" ".$ns" || return 0

    local keys
    keys=$(yaml_app_map_keys "$app" ".$ns")
    [[ -z "$keys" ]] && return 0

    while IFS= read -r key; do
        [[ -z "$key" ]] && continue
        local value
        value=$(yaml_app_map_get "$app" ".$ns" "$key")
        log_action "$app" "Setting $ns $key=$value"
        dokku_cmd "$ns:set" "$app" "$key" "$value"
        log_done
    done <<< "$keys"
}

# Replace all list items via <namespace>:set in one call.
# Usage: dokku_set_list <app> <namespace>
# Example: dokku_set_list "myapp" "ports"
#   Reads apps.myapp.ports: ["https:443:4000"]
#   Calls: dokku ports:set myapp https:443:4000
dokku_set_list() {
    local app="$1" ns="$2"
    yaml_app_has "$app" ".$ns" || return 0

    local items=()
    while IFS= read -r item; do
        [[ -z "$item" ]] && continue
        items+=("$item")
    done <<< "$(yaml_app_list "$app" ".${ns}[]")"

    [[ ${#items[@]} -eq 0 ]] && return 0

    log_action "$app" "Setting $ns"
    dokku_cmd "$ns:set" "$app" "${items[@]}"
    log_done
}

# Set a single scalar value via <namespace>:set.
# Usage: dokku_set_property <app> <namespace> <property>
# Example: dokku_set_property "myapp" "scheduler" "selected"
#   Reads apps.myapp.scheduler: "docker-local"
#   Calls: dokku scheduler:set myapp selected docker-local
dokku_set_property() {
    local app="$1" ns="$2" prop="$3"
    yaml_app_has "$app" ".$ns" || return 0

    local value
    value=$(yaml_app_get "$app" ".$ns")
    [[ -z "$value" ]] && return 0

    log_action "$app" "Setting $ns $prop=$value"
    dokku_cmd "$ns:set" "$app" "$prop" "$value"
    log_done
}
```

**Step 4: Run tests to verify they pass**

Run: `./tests/bats/bin/bats tests/core_helpers.bats`
Expected: All 6 tests pass.

**Step 5: Run full test suite to check for regressions**

Run: `./tests/bats/bin/bats tests/`
Expected: All tests pass.

**Step 6: Commit**

```bash
git add lib/core.sh tests/core_helpers.bats
git commit -m "feat: add dokku_set_properties, dokku_set_list, dokku_set_property helpers"
```

---

### Task 2: Refactor nginx.sh to use helpers

**Files:**
- Modify: `lib/nginx.sh`
- Test: `tests/nginx.bats` (existing — should pass unchanged)

**Step 1: Replace nginx.sh with helper call**

Replace the entire `ensure_app_nginx` function body in `lib/nginx.sh`:

```bash
# lib/nginx.sh — Nginx proxy configuration
# Dokku docs: https://dokku.com/docs/networking/proxies/nginx/
# Commands: nginx:*

#!/usr/bin/env bash
# Dokku nginx proxy configuration

ensure_app_nginx() {
    dokku_set_properties "$1" "nginx"
}
```

**Step 2: Run existing nginx tests**

Run: `./tests/bats/bin/bats tests/nginx.bats`
Expected: Both tests pass (behavior unchanged).

**Step 3: Run full test suite**

Run: `./tests/bats/bin/bats tests/`
Expected: All tests pass.

**Step 4: Commit**

```bash
git add lib/nginx.sh
git commit -m "refactor: nginx.sh uses dokku_set_properties helper"
```

---

### Task 3: Rename ssl → certs in YAML

This is a breaking change. Update the YAML key from `ssl:` to `certs:`, the code that reads it, the fixture, and the tests — all atomically.

**Files:**
- Modify: `lib/certs.sh` (change `.ssl` → `.certs`)
- Modify: `tests/fixtures/full.yml` (rename `ssl:` keys to `certs:`)
- Modify: `tests/certs.bats` (update mock yaml_app_get path)

**Step 1: Update fixture — rename ssl to certs**

In `tests/fixtures/full.yml`, rename all `ssl:` keys to `certs:`:

```
ssl: certs/funqtion.co   →   certs: certs/funqtion.co
ssl: certs/strates.io    →   certs: certs/strates.io
ssl: certs/qultr.dev     →   certs: certs/qultr.dev
```

**Step 2: Update certs.sh to read .certs instead of .ssl**

Replace `lib/certs.sh`:

```bash
# lib/certs.sh — SSL certificate management
# Dokku docs: https://dokku.com/docs/configuration/ssl/
# Commands: certs:*

#!/usr/bin/env bash
# Dokku SSL certificate management

ensure_app_certs() {
    local app="$1"

    local cert_path
    cert_path=$(yaml_app_get "$app" ".certs")
    [[ -z "$cert_path" ]] && return 0

    local cert_file="${cert_path}/cert.crt"
    local key_file="${cert_path}/cert.key"

    if [[ ! -f "$cert_file" || ! -f "$key_file" ]]; then
        if [[ "$DOKKU_COMPOSE_DRY_RUN" == "true" ]]; then
            log_action "$app" "Adding SSL certificate from ${cert_path}"
            echo "[dry-run] dokku certs:add $app < ${cert_path}/{cert.crt,cert.key}"
            log_done
            return 0
        fi
        log_error "$app" "SSL cert files not found in: $cert_path (expected cert.crt and cert.key)"
        return 0
    fi

    log_action "$app" "Adding SSL certificate"
    tar cf - -C "$cert_path" cert.crt cert.key | dokku_cmd certs:add "$app"
    log_done
}
```

**Step 3: Update certs.bats — change mock path from .ssl to .certs**

In `tests/certs.bats`, update the two `yaml_app_get` overrides:
- Line 28: change `"$2" == ".ssl"` → `"$2" == ".certs"`
- Line 39: change `"$2" == ".ssl"` → `"$2" == ".certs"`

**Step 4: Run certs tests**

Run: `./tests/bats/bin/bats tests/certs.bats`
Expected: All 3 tests pass.

**Step 5: Run full test suite**

Run: `./tests/bats/bin/bats tests/`
Expected: All tests pass.

**Step 6: Commit**

```bash
git add lib/certs.sh tests/certs.bats tests/fixtures/full.yml
git commit -m "refactor: rename ssl → certs YAML key to match Dokku namespace"
```

---

### Task 4: Restructure builder YAML

Move flat keys (`dockerfile`, `app_json`, `build_dir`, `build_args`) under a `builder:` map. This is a breaking change.

**Files:**
- Modify: `lib/builder.sh`
- Modify: `tests/fixtures/full.yml`
- Modify: `tests/builder.bats`

**Step 1: Update full.yml fixture — nest keys under builder**

Change the `funqtion` app from:

```yaml
  funqtion:
    dockerfile: docker/prod/api/Dockerfile
    app_json: docker/prod/api/app.json
    build_dir: apps/funqtion-api
    ...
    build_args:
      SENTRY_AUTH_TOKEN: "test-token"
```

To:

```yaml
  funqtion:
    builder:
      dockerfile: docker/prod/api/Dockerfile
      app_json: docker/prod/api/app.json
      build_dir: apps/funqtion-api
      build_args:
        SENTRY_AUTH_TOKEN: "test-token"
    ...
```

Do the same for `qultr-sandbox`:

```yaml
  qultr-sandbox:
    builder:
      dockerfile: docker/prod/sandbox/Dockerfile
      build_dir: apps/qultr-sandbox
    ...
```

And for `studio` and `qultr` which only have `build_dir`:

```yaml
  studio:
    builder:
      build_dir: apps/studio-api
    ...
  qultr:
    builder:
      build_dir: apps/qultr-api
    ...
```

Also update `simple.yml` — `myapp` has `build_dir`:

```yaml
  myapp:
    builder:
      build_dir: apps/myapp
    ...
```

**Step 2: Rewrite builder.sh to read from .builder sub-keys**

```bash
# lib/builder.sh — Dockerfile builder and build argument configuration
# Dokku docs: https://dokku.com/docs/deployment/builders/builder-management/
#              https://dokku.com/docs/advanced-usage/docker-options/
#              https://dokku.com/docs/appendices/file-formats/app-json/
# Commands: builder-dockerfile:*, docker-options:*, app-json:*

#!/usr/bin/env bash
# Dokku Dockerfile builder configuration

ensure_app_builder() {
    local app="$1"

    yaml_app_has "$app" ".builder" || return 0

    # Dockerfile path
    local dockerfile
    dockerfile=$(yaml_app_get "$app" ".builder.dockerfile")
    if [[ -n "$dockerfile" ]]; then
        log_action "$app" "Setting dockerfile path"
        dokku_cmd builder-dockerfile:set "$app" dockerfile-path "$dockerfile"
        log_done
    fi

    # app.json path
    local app_json
    app_json=$(yaml_app_get "$app" ".builder.app_json")
    if [[ -n "$app_json" ]]; then
        log_action "$app" "Setting app.json path"
        dokku_cmd app-json:set "$app" appjson-path "$app_json"
        log_done
    fi

    # Build dir
    local build_dir
    build_dir=$(yaml_app_get "$app" ".builder.build_dir")
    if [[ -n "$build_dir" ]]; then
        log_action "$app" "Setting build dir"
        dokku_cmd builder:set "$app" build-dir "$build_dir"
        log_done
    fi

    # Custom build args
    if yaml_app_has "$app" ".builder.build_args"; then
        local keys
        keys=$(yaml_app_map_keys "$app" ".builder.build_args")
        while IFS= read -r key; do
            [[ -z "$key" ]] && continue
            local value
            value=$(yaml_app_map_get "$app" ".builder.build_args" "$key")
            value=$(resolve_env_vars "$value")
            log_action "$app" "Setting build arg $key"
            dokku_cmd docker-options:add "$app" build "--build-arg ${key}=${value}"
            log_done
        done <<< "$keys"
    fi
}
```

**Step 3: Rewrite builder.bats for new YAML structure**

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

@test "ensure_app_builder sets build_dir via builder:set" {
    ensure_app_builder "funqtion"
    assert_dokku_called "builder:set funqtion build-dir apps/funqtion-api"
}

@test "ensure_app_builder sets build args" {
    ensure_app_builder "funqtion"
    assert_dokku_called "docker-options:add funqtion build --build-arg SENTRY_AUTH_TOKEN=test-token"
}

@test "ensure_app_builder handles app with only build_dir" {
    ensure_app_builder "studio"
    assert_dokku_called "builder:set studio build-dir apps/studio-api"
    refute_dokku_called "builder-dockerfile:set studio"
    refute_dokku_called "app-json:set studio"
}

@test "ensure_app_builder skips when no builder config" {
    # Create a temp fixture with no builder key
    local tmpfile="${MOCK_DIR}/no_builder.yml"
    cat > "$tmpfile" <<'EOF'
apps:
  bare:
    ports:
      - "http:5000:5000"
EOF
    DOKKU_COMPOSE_FILE="$tmpfile"
    ensure_app_builder "bare"
    refute_dokku_called "builder-dockerfile:set"
    refute_dokku_called "builder:set"
    refute_dokku_called "app-json:set"
    refute_dokku_called "docker-options:add"
}
```

**Step 4: Run builder tests**

Run: `./tests/bats/bin/bats tests/builder.bats`
Expected: All 6 tests pass.

**Step 5: Run full test suite (including integration)**

Run: `./tests/bats/bin/bats tests/`
Expected: Some integration tests will need updating since they reference old fixture structure. Fix the integration test:

In `tests/integration.bats`, line 67-68 — the builder assertions change:
- Keep: `assert_dokku_called "builder-dockerfile:set funqtion dockerfile-path docker/prod/api/Dockerfile"`
- Keep: `assert_dokku_called "app-json:set funqtion appjson-path docker/prod/api/app.json"`
- The `docker-options:add` for APP_PATH is gone — replaced by `builder:set funqtion build-dir apps/funqtion-api`
- Add: `assert_dokku_called "builder:set funqtion build-dir apps/funqtion-api"`

Fix any other failures from the old flat keys no longer being read.

**Step 6: Run full test suite again**

Run: `./tests/bats/bin/bats tests/`
Expected: All tests pass.

**Step 7: Commit**

```bash
git add lib/builder.sh tests/builder.bats tests/fixtures/full.yml tests/fixtures/simple.yml tests/integration.bats
git commit -m "refactor: nest builder config under builder: key, use native build-dir"
```

---

### Task 5: New module — checks.sh

Simple map module using `dokku_set_properties`.

**Files:**
- Create: `tests/checks.bats`
- Create: `lib/checks.sh`
- Modify: `tests/fixtures/full.yml` (add `checks:` to an app)
- Modify: `bin/dokku-compose:14` (add to module list)
- Modify: `bin/dokku-compose` `configure_app()` (add call)

**Step 1: Add checks config to fixture**

In `tests/fixtures/full.yml`, add to the `funqtion` app:

```yaml
    checks:
      wait-to-retire: 60
      attempts: 5
```

**Step 2: Write failing test**

Create `tests/checks.bats`:

```bash
#!/usr/bin/env bash

setup() {
    load 'test_helper'
    setup_mocks
    source "${PROJECT_ROOT}/lib/checks.sh"
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/full.yml"
}

teardown() {
    teardown_mocks
}

@test "ensure_app_checks sets configured properties" {
    ensure_app_checks "funqtion"
    assert_dokku_called "checks:set funqtion wait-to-retire 60"
    assert_dokku_called "checks:set funqtion attempts 5"
}

@test "ensure_app_checks skips when no checks configured" {
    ensure_app_checks "studio"
    refute_dokku_called "checks:set"
}
```

**Step 3: Run test to verify it fails**

Run: `./tests/bats/bin/bats tests/checks.bats`
Expected: FAIL — cannot source `lib/checks.sh`

**Step 4: Create lib/checks.sh**

```bash
# lib/checks.sh — Zero-downtime deploy checks
# Dokku docs: https://dokku.com/docs/deployment/zero-downtime-deploys/
# Commands: checks:*

#!/usr/bin/env bash
# Dokku zero-downtime deploy checks

ensure_app_checks() {
    dokku_set_properties "$1" "checks"
}
```

**Step 5: Run test to verify it passes**

Run: `./tests/bats/bin/bats tests/checks.bats`
Expected: Both tests pass.

**Step 6: Wire up in bin/dokku-compose**

In `bin/dokku-compose` line 14, add `checks` to the module list:

```bash
    for module in apps network plugins services ports certs nginx config builder checks dokku git; do
```

In `configure_app()`, add the call after `ensure_app_nginx` and before `ensure_app_config`:

```bash
    if type ensure_app_checks &>/dev/null; then ensure_app_checks "$app"; fi
```

**Step 7: Run full test suite**

Run: `./tests/bats/bin/bats tests/`
Expected: All tests pass.

**Step 8: Commit**

```bash
git add lib/checks.sh tests/checks.bats tests/fixtures/full.yml bin/dokku-compose
git commit -m "feat: add checks module for zero-downtime deploy settings"
```

---

### Task 6: New module — logs.sh

Simple map module using `dokku_set_properties`.

**Files:**
- Create: `tests/logs.bats`
- Create: `lib/logs.sh`
- Modify: `tests/fixtures/full.yml` (add `logs:` to an app)
- Modify: `bin/dokku-compose:14` (add to module list)
- Modify: `bin/dokku-compose` `configure_app()`

**Step 1: Add logs config to fixture**

In `tests/fixtures/full.yml`, add to the `studio` app:

```yaml
    logs:
      max-size: "10m"
```

**Step 2: Write failing test**

Create `tests/logs.bats`:

```bash
#!/usr/bin/env bash

setup() {
    load 'test_helper'
    setup_mocks
    source "${PROJECT_ROOT}/lib/logs.sh"
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/full.yml"
}

teardown() {
    teardown_mocks
}

@test "ensure_app_logs sets configured properties" {
    ensure_app_logs "studio"
    assert_dokku_called "logs:set studio max-size 10m"
}

@test "ensure_app_logs skips when no logs configured" {
    ensure_app_logs "funqtion"
    refute_dokku_called "logs:set"
}
```

**Step 3: Run test to verify it fails**

Run: `./tests/bats/bin/bats tests/logs.bats`
Expected: FAIL

**Step 4: Create lib/logs.sh**

```bash
# lib/logs.sh — Log management
# Dokku docs: https://dokku.com/docs/deployment/logs/
# Commands: logs:*

#!/usr/bin/env bash
# Dokku log management

ensure_app_logs() {
    dokku_set_properties "$1" "logs"
}
```

**Step 5: Wire up in bin/dokku-compose**

Add `logs` to module list on line 14. Add call in `configure_app()` after `ensure_app_checks`:

```bash
    if type ensure_app_logs &>/dev/null; then ensure_app_logs "$app"; fi
```

**Step 6: Run full test suite**

Run: `./tests/bats/bin/bats tests/`
Expected: All tests pass.

**Step 7: Commit**

```bash
git add lib/logs.sh tests/logs.bats tests/fixtures/full.yml bin/dokku-compose
git commit -m "feat: add logs module for log management settings"
```

---

### Task 7: New module — registry.sh

Simple map module using `dokku_set_properties`.

**Files:**
- Create: `tests/registry.bats`
- Create: `lib/registry.sh`
- Modify: `tests/fixtures/full.yml` (add `registry:` to an app)
- Modify: `bin/dokku-compose:14` (add to module list)
- Modify: `bin/dokku-compose` `configure_app()`

**Step 1: Add registry config to fixture**

In `tests/fixtures/full.yml`, add to the `funqtion` app:

```yaml
    registry:
      push-on-release: true
      server: registry.example.com
```

**Step 2: Write failing test**

Create `tests/registry.bats`:

```bash
#!/usr/bin/env bash

setup() {
    load 'test_helper'
    setup_mocks
    source "${PROJECT_ROOT}/lib/registry.sh"
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/full.yml"
}

teardown() {
    teardown_mocks
}

@test "ensure_app_registry sets configured properties" {
    ensure_app_registry "funqtion"
    assert_dokku_called "registry:set funqtion push-on-release true"
    assert_dokku_called "registry:set funqtion server registry.example.com"
}

@test "ensure_app_registry skips when no registry configured" {
    ensure_app_registry "studio"
    refute_dokku_called "registry:set"
}
```

**Step 3: Run test to verify it fails**

Run: `./tests/bats/bin/bats tests/registry.bats`
Expected: FAIL

**Step 4: Create lib/registry.sh**

```bash
# lib/registry.sh — Registry management
# Dokku docs: https://dokku.com/docs/advanced-usage/registry-management/
# Commands: registry:*

#!/usr/bin/env bash
# Dokku registry management

ensure_app_registry() {
    dokku_set_properties "$1" "registry"
}
```

**Step 5: Wire up in bin/dokku-compose**

Add `registry` to module list. Add call in `configure_app()` after `ensure_app_logs`:

```bash
    if type ensure_app_registry &>/dev/null; then ensure_app_registry "$app"; fi
```

**Step 6: Run full test suite**

Run: `./tests/bats/bin/bats tests/`
Expected: All tests pass.

**Step 7: Commit**

```bash
git add lib/registry.sh tests/registry.bats tests/fixtures/full.yml bin/dokku-compose
git commit -m "feat: add registry module for registry management settings"
```

---

### Task 8: New module — scheduler.sh

Scalar module using `dokku_set_property`.

**Files:**
- Create: `tests/scheduler.bats`
- Create: `lib/scheduler.sh`
- Modify: `tests/fixtures/full.yml` (add `scheduler:` to an app)
- Modify: `bin/dokku-compose:14` (add to module list)
- Modify: `bin/dokku-compose` `configure_app()`

**Step 1: Add scheduler config to fixture**

In `tests/fixtures/full.yml`, add to the `qultr` app:

```yaml
    scheduler: docker-local
```

**Step 2: Write failing test**

Create `tests/scheduler.bats`:

```bash
#!/usr/bin/env bash

setup() {
    load 'test_helper'
    setup_mocks
    source "${PROJECT_ROOT}/lib/scheduler.sh"
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/full.yml"
}

teardown() {
    teardown_mocks
}

@test "ensure_app_scheduler sets the selected scheduler" {
    ensure_app_scheduler "qultr"
    assert_dokku_called "scheduler:set qultr selected docker-local"
}

@test "ensure_app_scheduler skips when no scheduler configured" {
    ensure_app_scheduler "studio"
    refute_dokku_called "scheduler:set"
}
```

**Step 3: Run test to verify it fails**

Run: `./tests/bats/bin/bats tests/scheduler.bats`
Expected: FAIL

**Step 4: Create lib/scheduler.sh**

```bash
# lib/scheduler.sh — Scheduler selection
# Dokku docs: https://dokku.com/docs/deployment/schedulers/scheduler-management/
# Commands: scheduler:*

#!/usr/bin/env bash
# Dokku scheduler selection

ensure_app_scheduler() {
    dokku_set_property "$1" "scheduler" "selected"
}
```

**Step 5: Wire up in bin/dokku-compose**

Add `scheduler` to module list. Add call in `configure_app()` after `ensure_app_registry`:

```bash
    if type ensure_app_scheduler &>/dev/null; then ensure_app_scheduler "$app"; fi
```

**Step 6: Run full test suite**

Run: `./tests/bats/bin/bats tests/`
Expected: All tests pass.

**Step 7: Commit**

```bash
git add lib/scheduler.sh tests/scheduler.bats tests/fixtures/full.yml bin/dokku-compose
git commit -m "feat: add scheduler module for scheduler selection"
```

---

### Task 9: New module — proxy.sh

Map module with enable/disable logic. `proxy:` is a map with an `enabled` key that controls `proxy:enable`/`proxy:disable`.

**Files:**
- Create: `tests/proxy.bats`
- Create: `lib/proxy.sh`
- Modify: `tests/fixtures/full.yml` (add `proxy:` config)
- Modify: `bin/dokku-compose:14` (add to module list)
- Modify: `bin/dokku-compose` `configure_app()`

**Step 1: Add proxy config to fixture**

In `tests/fixtures/full.yml`, add to `qultr-sandbox`:

```yaml
    proxy:
      enabled: false
```

**Step 2: Write failing test**

Create `tests/proxy.bats`:

```bash
#!/usr/bin/env bash

setup() {
    load 'test_helper'
    setup_mocks
    source "${PROJECT_ROOT}/lib/proxy.sh"
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/full.yml"
}

teardown() {
    teardown_mocks
}

@test "ensure_app_proxy disables proxy when enabled: false" {
    ensure_app_proxy "qultr-sandbox"
    assert_dokku_called "proxy:disable qultr-sandbox"
    refute_dokku_called "proxy:enable"
}

@test "ensure_app_proxy enables proxy when enabled: true" {
    local tmpfile="${MOCK_DIR}/proxy_on.yml"
    cat > "$tmpfile" <<'EOF'
apps:
  worker:
    proxy:
      enabled: true
EOF
    DOKKU_COMPOSE_FILE="$tmpfile"
    ensure_app_proxy "worker"
    assert_dokku_called "proxy:enable worker"
    refute_dokku_called "proxy:disable"
}

@test "ensure_app_proxy skips when no proxy configured" {
    ensure_app_proxy "funqtion"
    refute_dokku_called "proxy:enable"
    refute_dokku_called "proxy:disable"
}
```

**Step 3: Run test to verify it fails**

Run: `./tests/bats/bin/bats tests/proxy.bats`
Expected: FAIL

**Step 4: Create lib/proxy.sh**

```bash
# lib/proxy.sh — Proxy management
# Dokku docs: https://dokku.com/docs/networking/proxy-management/
# Commands: proxy:*

#!/usr/bin/env bash
# Dokku proxy management

ensure_app_proxy() {
    local app="$1"

    yaml_app_has "$app" ".proxy" || return 0

    local enabled
    enabled=$(yaml_app_get "$app" ".proxy.enabled")

    if [[ "$enabled" == "true" ]]; then
        log_action "$app" "Enabling proxy"
        dokku_cmd proxy:enable "$app"
        log_done
    elif [[ "$enabled" == "false" ]]; then
        log_action "$app" "Disabling proxy"
        dokku_cmd proxy:disable "$app"
        log_done
    fi
}
```

**Step 5: Wire up in bin/dokku-compose**

Add `proxy` to module list. Add call in `configure_app()` before `ensure_app_ports` (proxy must be configured before ports/nginx):

```bash
    if type ensure_app_proxy &>/dev/null; then ensure_app_proxy "$app"; fi
```

**Step 6: Run full test suite**

Run: `./tests/bats/bin/bats tests/`
Expected: All tests pass.

**Step 7: Commit**

```bash
git add lib/proxy.sh tests/proxy.bats tests/fixtures/full.yml bin/dokku-compose
git commit -m "feat: add proxy module for proxy enable/disable"
```

---

### Task 10: New module — storage.sh

List reconcile module. `storage:` is a list of `host:container` mount strings. Uses `storage:mount` to add and `storage:unmount` to remove.

**Files:**
- Create: `tests/storage.bats`
- Create: `lib/storage.sh`
- Modify: `tests/fixtures/full.yml` (add `storage:` to an app)
- Modify: `bin/dokku-compose:14` (add to module list)
- Modify: `bin/dokku-compose` `configure_app()` and `cmd_down()`

**Step 1: Add storage config to fixture**

In `tests/fixtures/full.yml`, add to `funqtion`:

```yaml
    storage:
      - "/var/lib/dokku/data/storage/funqtion/uploads:/app/uploads"
```

**Step 2: Write failing test**

Create `tests/storage.bats`:

```bash
#!/usr/bin/env bash

setup() {
    load 'test_helper'
    setup_mocks
    source "${PROJECT_ROOT}/lib/storage.sh"
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/full.yml"
}

teardown() {
    teardown_mocks
}

@test "ensure_app_storage mounts declared volumes" {
    mock_dokku_output "storage:report funqtion --storage-mounts" ""
    ensure_app_storage "funqtion"
    assert_dokku_called "storage:mount funqtion /var/lib/dokku/data/storage/funqtion/uploads:/app/uploads"
}

@test "ensure_app_storage skips already mounted volumes" {
    mock_dokku_output "storage:report funqtion --storage-mounts" "/var/lib/dokku/data/storage/funqtion/uploads:/app/uploads"
    ensure_app_storage "funqtion"
    refute_dokku_called "storage:mount"
}

@test "ensure_app_storage skips when no storage configured" {
    ensure_app_storage "studio"
    refute_dokku_called "storage:mount"
}

@test "destroy_app_storage unmounts all declared volumes" {
    destroy_app_storage "funqtion"
    assert_dokku_called "storage:unmount funqtion /var/lib/dokku/data/storage/funqtion/uploads:/app/uploads"
}
```

**Step 3: Run test to verify it fails**

Run: `./tests/bats/bin/bats tests/storage.bats`
Expected: FAIL

**Step 4: Create lib/storage.sh**

```bash
# lib/storage.sh — Persistent storage management
# Dokku docs: https://dokku.com/docs/advanced-usage/persistent-storage/
# Commands: storage:*

#!/usr/bin/env bash
# Dokku persistent storage management

ensure_app_storage() {
    local app="$1"

    yaml_app_has "$app" ".storage" || return 0

    local current
    current=$(dokku_cmd storage:report "$app" --storage-mounts 2>/dev/null || true)

    while IFS= read -r mount; do
        [[ -z "$mount" ]] && continue

        if echo "$current" | grep -qF "$mount"; then
            log_action "$app" "Storage $mount"
            log_skip
            continue
        fi

        log_action "$app" "Mounting $mount"
        dokku_cmd storage:mount "$app" "$mount"
        log_done
    done <<< "$(yaml_app_list "$app" ".storage[]")"
}

destroy_app_storage() {
    local app="$1"

    yaml_app_has "$app" ".storage" || return 0

    while IFS= read -r mount; do
        [[ -z "$mount" ]] && continue
        log_action "$app" "Unmounting $mount"
        dokku_cmd storage:unmount "$app" "$mount"
        log_done
    done <<< "$(yaml_app_list "$app" ".storage[]")"
}
```

**Step 5: Wire up in bin/dokku-compose**

Add `storage` to module list. Add `ensure_app_storage` call in `configure_app()` after `ensure_app_certs`. Add `destroy_app_storage` call in `cmd_down()` before `destroy_app`:

```bash
        if type destroy_app_storage &>/dev/null; then
            destroy_app_storage "$app"
        fi
```

**Step 6: Run full test suite**

Run: `./tests/bats/bin/bats tests/`
Expected: All tests pass.

**Step 7: Commit**

```bash
git add lib/storage.sh tests/storage.bats tests/fixtures/full.yml bin/dokku-compose
git commit -m "feat: add storage module for persistent volume mounts"
```

---

### Task 11: New module — docker_options.sh

Phased list module. `docker_options:` is a map of phases (`build`, `deploy`, `run`), each containing a list of option strings.

**Files:**
- Create: `tests/docker_options.bats`
- Create: `lib/docker_options.sh`
- Modify: `tests/fixtures/full.yml` (add `docker_options:` to an app)
- Modify: `bin/dokku-compose:14` (add to module list)
- Modify: `bin/dokku-compose` `configure_app()`

**Step 1: Add docker_options config to fixture**

In `tests/fixtures/full.yml`, add to `qultr`:

```yaml
    docker_options:
      deploy:
        - "--shm-size 256m"
```

**Step 2: Write failing test**

Create `tests/docker_options.bats`:

```bash
#!/usr/bin/env bash

setup() {
    load 'test_helper'
    setup_mocks
    source "${PROJECT_ROOT}/lib/docker_options.sh"
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/full.yml"
}

teardown() {
    teardown_mocks
}

@test "ensure_app_docker_options adds options for each phase" {
    ensure_app_docker_options "qultr"
    assert_dokku_called "docker-options:add qultr deploy --shm-size 256m"
}

@test "ensure_app_docker_options handles multiple phases" {
    local tmpfile="${MOCK_DIR}/multi_phase.yml"
    cat > "$tmpfile" <<'EOF'
apps:
  worker:
    docker_options:
      build:
        - "--no-cache"
      deploy:
        - "--shm-size 256m"
        - "-v /data:/data"
      run:
        - "--ulimit nofile=12"
EOF
    DOKKU_COMPOSE_FILE="$tmpfile"
    ensure_app_docker_options "worker"
    assert_dokku_called "docker-options:add worker build --no-cache"
    assert_dokku_called "docker-options:add worker deploy --shm-size 256m"
    assert_dokku_called "docker-options:add worker deploy -v /data:/data"
    assert_dokku_called "docker-options:add worker run --ulimit nofile=12"
}

@test "ensure_app_docker_options skips when no docker_options configured" {
    ensure_app_docker_options "studio"
    refute_dokku_called "docker-options:add"
}
```

**Step 3: Run test to verify it fails**

Run: `./tests/bats/bin/bats tests/docker_options.bats`
Expected: FAIL

**Step 4: Create lib/docker_options.sh**

```bash
# lib/docker_options.sh — Docker container options
# Dokku docs: https://dokku.com/docs/advanced-usage/docker-options/
# Commands: docker-options:*

#!/usr/bin/env bash
# Dokku docker container options

ensure_app_docker_options() {
    local app="$1"

    yaml_app_has "$app" ".docker_options" || return 0

    local phase
    for phase in build deploy run; do
        yaml_app_has "$app" ".docker_options.$phase" || continue

        while IFS= read -r option; do
            [[ -z "$option" ]] && continue
            log_action "$app" "Adding docker option ($phase): $option"
            dokku_cmd docker-options:add "$app" "$phase" "$option"
            log_done
        done <<< "$(yaml_app_list "$app" ".docker_options.${phase}[]")"
    done
}
```

**Step 5: Wire up in bin/dokku-compose**

Add `docker_options` to module list. Add call in `configure_app()` after `ensure_app_builder`:

```bash
    if type ensure_app_docker_options &>/dev/null; then ensure_app_docker_options "$app"; fi
```

**Step 6: Run full test suite**

Run: `./tests/bats/bin/bats tests/`
Expected: All tests pass.

**Step 7: Commit**

```bash
git add lib/docker_options.sh tests/docker_options.bats tests/fixtures/full.yml bin/dokku-compose
git commit -m "feat: add docker_options module for per-phase container options"
```

---

### Task 12: New module — domains.sh (split from apps.sh)

Split domain management out of `apps.sh` into its own module. Replace the blanket `ensure_vhosts_disabled` with proper domain handling: if `domains:` is declared, set them; if absent, disable vhosts.

**Files:**
- Create: `tests/domains.bats`
- Create: `lib/domains.sh`
- Modify: `lib/apps.sh` (remove `ensure_vhosts_disabled`)
- Modify: `bin/dokku-compose:14` (add `domains` to module list)
- Modify: `bin/dokku-compose` `configure_app()` (replace `ensure_vhosts_disabled` with `ensure_app_domains`)
- Modify: `tests/fixtures/full.yml` (add `domains:` to an app)

**Step 1: Add domains config to fixture**

In `tests/fixtures/full.yml`, add to `funqtion`:

```yaml
    domains:
      - funqtion.example.com
      - api.funqtion.co
```

**Step 2: Write failing test**

Create `tests/domains.bats`:

```bash
#!/usr/bin/env bash

setup() {
    load 'test_helper'
    setup_mocks
    source "${PROJECT_ROOT}/lib/domains.sh"
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/full.yml"
}

teardown() {
    teardown_mocks
}

@test "ensure_app_domains sets declared domains" {
    ensure_app_domains "funqtion"
    assert_dokku_called "domains:enable funqtion"
    assert_dokku_called "domains:set funqtion funqtion.example.com api.funqtion.co"
}

@test "ensure_app_domains disables vhosts when no domains declared" {
    ensure_app_domains "studio"
    assert_dokku_called "domains:disable studio"
    refute_dokku_called "domains:set studio"
    refute_dokku_called "domains:enable studio"
}

@test "destroy_app_domains clears domains" {
    destroy_app_domains "funqtion"
    assert_dokku_called "domains:clear funqtion"
}
```

**Step 3: Run test to verify it fails**

Run: `./tests/bats/bin/bats tests/domains.bats`
Expected: FAIL

**Step 4: Create lib/domains.sh**

```bash
# lib/domains.sh — Domain configuration
# Dokku docs: https://dokku.com/docs/configuration/domains/
# Commands: domains:*

#!/usr/bin/env bash
# Dokku domain configuration

ensure_app_domains() {
    local app="$1"

    if ! yaml_app_has "$app" ".domains"; then
        log_action "$app" "Disabling vhosts"
        dokku_cmd domains:disable "$app"
        log_done
        return 0
    fi

    local items=()
    while IFS= read -r domain; do
        [[ -z "$domain" ]] && continue
        items+=("$domain")
    done <<< "$(yaml_app_list "$app" ".domains[]")"

    [[ ${#items[@]} -eq 0 ]] && return 0

    log_action "$app" "Setting domains: ${items[*]}"
    dokku_cmd domains:enable "$app"
    dokku_cmd domains:set "$app" "${items[@]}"
    log_done
}

destroy_app_domains() {
    local app="$1"
    log_action "$app" "Clearing domains"
    dokku_cmd domains:clear "$app"
    log_done
}
```

**Step 5: Remove ensure_vhosts_disabled from apps.sh**

Delete the `ensure_vhosts_disabled` function from `lib/apps.sh` (lines 23-25).

**Step 6: Update bin/dokku-compose**

Add `domains` to module list on line 14. In `configure_app()`:
- Remove: `if type ensure_vhosts_disabled &>/dev/null; then ensure_vhosts_disabled "$app"; fi`
- Add (same position, after ensure_app): `if type ensure_app_domains &>/dev/null; then ensure_app_domains "$app"; fi`

In `cmd_down()`, add before `destroy_app`:
```bash
        if type destroy_app_domains &>/dev/null; then
            destroy_app_domains "$app"
        fi
```

**Step 7: Update existing tests**

In `tests/apps.bats`, remove any test referencing `ensure_vhosts_disabled`.

In `tests/integration.bats`:
- Replace `ensure_vhosts_disabled "$app"` with `ensure_app_domains "$app"` (requires sourcing domains.sh)
- Add `domains` to the module source loop
- `assert_dokku_called "domains:disable funqtion"` should still pass (domains module disables vhosts when no domains key — but now funqtion HAS domains, so update this assertion to `domains:enable funqtion`)

**Step 8: Run full test suite**

Run: `./tests/bats/bin/bats tests/`
Expected: All tests pass.

**Step 9: Commit**

```bash
git add lib/domains.sh lib/apps.sh tests/domains.bats tests/apps.bats tests/integration.bats tests/fixtures/full.yml bin/dokku-compose
git commit -m "feat: add domains module, split from apps.sh"
```

---

### Task 13: Final integration test update

Update the integration test to exercise the new modules and verify the full `configure_app` flow still works.

**Files:**
- Modify: `tests/integration.bats`

**Step 1: Update integration test module sourcing**

Update the module source loop to include all new modules:

```bash
    for module in apps domains network plugins services ports certs nginx config builder checks logs registry scheduler proxy storage docker_options dokku; do
        source "${PROJECT_ROOT}/lib/${module}.sh"
    done
```

**Step 2: Update "full up: configures app with all features" test**

Add assertions for new modules that funqtion now exercises:
- `assert_dokku_called "domains:enable funqtion"` (funqtion has domains now)
- `assert_dokku_called "checks:set funqtion wait-to-retire 60"`
- `assert_dokku_called "storage:mount funqtion"`
- `assert_dokku_called "registry:set funqtion push-on-release true"`

Add mock for storage: `mock_dokku_output "storage:report funqtion --storage-mounts" ""`

Update the `ensure_*` call sequence to match new `configure_app()` order.

**Step 3: Run full test suite**

Run: `./tests/bats/bin/bats tests/`
Expected: All tests pass.

**Step 4: Commit**

```bash
git add tests/integration.bats
git commit -m "test: update integration tests for new modules"
```

---

### Task 14: Update design doc and commit

**Files:**
- Modify: `docs/plans/2026-03-03-module-contract-design.md`

**Step 1: Run full test suite one final time**

Run: `./tests/bats/bin/bats tests/`
Expected: All tests pass.

**Step 2: Commit all pending design doc changes**

```bash
git add docs/plans/2026-03-03-module-contract-design.md docs/dokku-audit.md
git commit -m "docs: update design docs with final YAML structure decisions"
```
