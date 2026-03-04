#!/usr/bin/env bash

setup() {
    load 'test_helper'
    setup_mocks
    source "${PROJECT_ROOT}/lib/certs.sh"
}

teardown() {
    teardown_mocks
}

# --- ensure_app_certs ---

@test "ensure_app_certs skips when no ssl key configured" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/simple.yml"
    ensure_app_certs "myapp"
    refute_dokku_called "certs:add"
    refute_dokku_called "certs:remove"
}

@test "ensure_app_certs adds certificate when not already enabled" {
    # Create mock cert files
    local cert_dir="${MOCK_DIR}/certs"
    mkdir -p "$cert_dir"
    echo "CERT" > "$cert_dir/fullchain.pem"
    echo "KEY" > "$cert_dir/privkey.pem"

    # Create fixture pointing to mock files
    local tmpfile="${MOCK_DIR}/ssl_test.yml"
    cat > "$tmpfile" <<EOF
apps:
  myapp:
    ssl:
      certfile: ${cert_dir}/fullchain.pem
      keyfile: ${cert_dir}/privkey.pem
EOF
    DOKKU_COMPOSE_FILE="$tmpfile"

    # SSL not currently enabled
    mock_dokku_output "certs:report myapp --ssl-enabled" "false"

    ensure_app_certs "myapp"
    assert_dokku_called "certs:add myapp"
}

@test "ensure_app_certs skips when cert already enabled" {
    local tmpfile="${MOCK_DIR}/ssl_skip.yml"
    cat > "$tmpfile" <<'EOF'
apps:
  myapp:
    ssl:
      certfile: certs/cert.pem
      keyfile: certs/key.pem
EOF
    DOKKU_COMPOSE_FILE="$tmpfile"

    # SSL already enabled
    mock_dokku_output "certs:report myapp --ssl-enabled" "true"

    ensure_app_certs "myapp"
    refute_dokku_called "certs:add"
}

@test "ensure_app_certs removes certificate when ssl: false" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/certs_false.yml"

    # SSL currently enabled
    mock_dokku_output "certs:report myapp --ssl-enabled" "true"

    ensure_app_certs "myapp"
    assert_dokku_called "certs:remove myapp"
    refute_dokku_called "certs:add"
}

@test "ensure_app_certs skips remove when ssl: false and ssl already disabled" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/certs_false.yml"

    # SSL not currently enabled
    mock_dokku_output "certs:report myapp --ssl-enabled" "false"

    ensure_app_certs "myapp"
    refute_dokku_called "certs:remove"
    refute_dokku_called "certs:add"
}

@test "ensure_app_certs errors on missing cert files" {
    local tmpfile="${MOCK_DIR}/ssl_missing.yml"
    cat > "$tmpfile" <<EOF
apps:
  myapp:
    ssl:
      certfile: /nonexistent/cert.pem
      keyfile: /nonexistent/key.pem
EOF
    DOKKU_COMPOSE_FILE="$tmpfile"

    # SSL not currently enabled
    mock_dokku_output "certs:report myapp --ssl-enabled" "false"

    ensure_app_certs "myapp"
    refute_dokku_called "certs:add"
    [[ "$DOKKU_COMPOSE_ERRORS" -gt 0 ]]
}

@test "ensure_app_certs errors when certfile or keyfile missing from yaml" {
    local tmpfile="${MOCK_DIR}/ssl_incomplete.yml"
    cat > "$tmpfile" <<'EOF'
apps:
  myapp:
    ssl:
      certfile: certs/cert.pem
EOF
    DOKKU_COMPOSE_FILE="$tmpfile"

    mock_dokku_output "certs:report myapp --ssl-enabled" "false"

    ensure_app_certs "myapp"
    refute_dokku_called "certs:add"
    [[ "$DOKKU_COMPOSE_ERRORS" -gt 0 ]]
}

# --- destroy_app_certs ---

@test "destroy_app_certs removes certificate" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/certs_false.yml"
    destroy_app_certs "myapp"
    assert_dokku_called "certs:remove myapp"
}
