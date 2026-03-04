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

# ---------------------------------------------------------------------------
# proxy: false shorthand
# ---------------------------------------------------------------------------

@test "ensure_app_proxy disables proxy when proxy: false (shorthand)" {
    local tmpfile="${MOCK_DIR}/proxy_false.yml"
    cat > "$tmpfile" <<'EOF'
apps:
  worker:
    proxy: false
EOF
    DOKKU_COMPOSE_FILE="$tmpfile"
    mock_dokku_output "proxy:report worker --proxy-enabled" "true"
    ensure_app_proxy "worker"
    assert_dokku_called "proxy:disable worker"
    refute_dokku_called "proxy:enable"
}

@test "ensure_app_proxy skips disable when proxy: false and already disabled" {
    local tmpfile="${MOCK_DIR}/proxy_false.yml"
    cat > "$tmpfile" <<'EOF'
apps:
  worker:
    proxy: false
EOF
    DOKKU_COMPOSE_FILE="$tmpfile"
    mock_dokku_output "proxy:report worker --proxy-enabled" "false"
    ensure_app_proxy "worker"
    refute_dokku_called "proxy:disable"
    refute_dokku_called "proxy:enable"
}

# ---------------------------------------------------------------------------
# proxy: true shorthand
# ---------------------------------------------------------------------------

@test "ensure_app_proxy enables proxy when proxy: true (shorthand)" {
    local tmpfile="${MOCK_DIR}/proxy_true.yml"
    cat > "$tmpfile" <<'EOF'
apps:
  worker:
    proxy: true
EOF
    DOKKU_COMPOSE_FILE="$tmpfile"
    mock_dokku_output "proxy:report worker --proxy-enabled" "false"
    ensure_app_proxy "worker"
    assert_dokku_called "proxy:enable worker"
    refute_dokku_called "proxy:disable"
}

@test "ensure_app_proxy skips enable when proxy: true and already enabled" {
    local tmpfile="${MOCK_DIR}/proxy_true.yml"
    cat > "$tmpfile" <<'EOF'
apps:
  worker:
    proxy: true
EOF
    DOKKU_COMPOSE_FILE="$tmpfile"
    mock_dokku_output "proxy:report worker --proxy-enabled" "true"
    ensure_app_proxy "worker"
    refute_dokku_called "proxy:enable"
    refute_dokku_called "proxy:disable"
}

# ---------------------------------------------------------------------------
# proxy.enabled map form (idempotency)
# ---------------------------------------------------------------------------

@test "ensure_app_proxy disables proxy when enabled: false" {
    mock_dokku_output "proxy:report qultr-sandbox --proxy-enabled" "true"
    ensure_app_proxy "qultr-sandbox"
    assert_dokku_called "proxy:disable qultr-sandbox"
    refute_dokku_called "proxy:enable"
}

@test "ensure_app_proxy skips when enabled: false and already disabled" {
    mock_dokku_output "proxy:report qultr-sandbox --proxy-enabled" "false"
    ensure_app_proxy "qultr-sandbox"
    refute_dokku_called "proxy:disable"
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
    mock_dokku_output "proxy:report worker --proxy-enabled" "false"
    ensure_app_proxy "worker"
    assert_dokku_called "proxy:enable worker"
    refute_dokku_called "proxy:disable"
}

@test "ensure_app_proxy skips when enabled: true and already enabled" {
    local tmpfile="${MOCK_DIR}/proxy_on.yml"
    cat > "$tmpfile" <<'EOF'
apps:
  worker:
    proxy:
      enabled: true
EOF
    DOKKU_COMPOSE_FILE="$tmpfile"
    mock_dokku_output "proxy:report worker --proxy-enabled" "true"
    ensure_app_proxy "worker"
    refute_dokku_called "proxy:enable"
    refute_dokku_called "proxy:disable"
}

# ---------------------------------------------------------------------------
# proxy.type
# ---------------------------------------------------------------------------

@test "ensure_app_proxy sets proxy type when type specified" {
    local tmpfile="${MOCK_DIR}/proxy_type.yml"
    cat > "$tmpfile" <<'EOF'
apps:
  myapp:
    proxy:
      type: caddy
EOF
    DOKKU_COMPOSE_FILE="$tmpfile"
    mock_dokku_output "proxy:report myapp --proxy-type" "nginx"
    ensure_app_proxy "myapp"
    assert_dokku_called "proxy:set myapp caddy"
}

@test "ensure_app_proxy skips proxy:set when type already matches" {
    local tmpfile="${MOCK_DIR}/proxy_type.yml"
    cat > "$tmpfile" <<'EOF'
apps:
  myapp:
    proxy:
      type: caddy
EOF
    DOKKU_COMPOSE_FILE="$tmpfile"
    mock_dokku_output "proxy:report myapp --proxy-type" "caddy"
    ensure_app_proxy "myapp"
    refute_dokku_called "proxy:set"
}

@test "ensure_app_proxy sets both enabled and type when both specified" {
    local tmpfile="${MOCK_DIR}/proxy_full.yml"
    cat > "$tmpfile" <<'EOF'
apps:
  myapp:
    proxy:
      enabled: true
      type: caddy
EOF
    DOKKU_COMPOSE_FILE="$tmpfile"
    mock_dokku_output "proxy:report myapp --proxy-enabled" "false"
    mock_dokku_output "proxy:report myapp --proxy-type" "nginx"
    ensure_app_proxy "myapp"
    assert_dokku_called "proxy:enable myapp"
    assert_dokku_called "proxy:set myapp caddy"
}

# ---------------------------------------------------------------------------
# Absent key = no action
# ---------------------------------------------------------------------------

@test "ensure_app_proxy skips when no proxy configured" {
    ensure_app_proxy "funqtion"
    refute_dokku_called "proxy:enable"
    refute_dokku_called "proxy:disable"
    refute_dokku_called "proxy:set"
}
