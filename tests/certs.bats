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

@test "ensure_app_certs skips when no certs key configured" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/simple.yml"
    ensure_app_certs "myapp"
    refute_dokku_called "certs:add"
    refute_dokku_called "certs:remove"
}

@test "ensure_app_certs adds certificate when not already enabled" {
    # Create mock cert files
    local cert_dir="${MOCK_DIR}/certs/example.com"
    mkdir -p "$cert_dir"
    echo "CERT" > "$cert_dir/cert.crt"
    echo "KEY" > "$cert_dir/cert.key"

    # Create fixture pointing to mock cert dir
    local tmpfile="${MOCK_DIR}/certs_test.yml"
    cat > "$tmpfile" <<EOF
apps:
  myapp:
    certs: ${cert_dir}
EOF
    DOKKU_COMPOSE_FILE="$tmpfile"

    # SSL not currently enabled
    mock_dokku_output "certs:report myapp --ssl-enabled" "false"

    ensure_app_certs "myapp"
    assert_dokku_called "certs:add myapp"
}

@test "ensure_app_certs skips when cert already enabled" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/certs_path.yml"

    # SSL already enabled
    mock_dokku_output "certs:report myapp --ssl-enabled" "true"

    ensure_app_certs "myapp"
    refute_dokku_called "certs:add"
}

@test "ensure_app_certs removes certificate when certs: false" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/certs_false.yml"

    # SSL currently enabled
    mock_dokku_output "certs:report myapp --ssl-enabled" "true"

    ensure_app_certs "myapp"
    assert_dokku_called "certs:remove myapp"
    refute_dokku_called "certs:add"
}

@test "ensure_app_certs skips remove when certs: false and ssl already disabled" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/certs_false.yml"

    # SSL not currently enabled
    mock_dokku_output "certs:report myapp --ssl-enabled" "false"

    ensure_app_certs "myapp"
    refute_dokku_called "certs:remove"
    refute_dokku_called "certs:add"
}

@test "ensure_app_certs errors on missing cert files" {
    local tmpfile="${MOCK_DIR}/certs_missing.yml"
    cat > "$tmpfile" <<EOF
apps:
  myapp:
    certs: /nonexistent/path
EOF
    DOKKU_COMPOSE_FILE="$tmpfile"

    # SSL not currently enabled
    mock_dokku_output "certs:report myapp --ssl-enabled" "false"

    ensure_app_certs "myapp"
    refute_dokku_called "certs:add"
    [[ "$DOKKU_COMPOSE_ERRORS" -gt 0 ]]
}

# --- destroy_app_certs ---

@test "destroy_app_certs removes certificate" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/certs_path.yml"
    destroy_app_certs "myapp"
    assert_dokku_called "certs:remove myapp"
}
