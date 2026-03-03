#!/usr/bin/env bash

setup() {
    load 'test_helper'
    setup_mocks
    source "${PROJECT_ROOT}/lib/services.sh"
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/full.yml"
}

teardown() {
    teardown_mocks
}

# --- ensure_app_services ---

@test "ensure_app_services creates and links postgres when postgres: true" {
    mock_dokku_exit "postgres:exists studio-postgres" 1
    mock_dokku_exit "postgres:linked studio-postgres studio" 1
    mock_dokku_exit "redis:exists studio-redis" 1
    mock_dokku_exit "redis:linked studio-redis studio" 1
    ensure_app_services "studio"
    assert_dokku_called "postgres:create studio-postgres"
    assert_dokku_called "postgres:link studio-postgres studio --no-restart"
}

@test "ensure_app_services creates and links redis when redis: true" {
    mock_dokku_exit "postgres:exists studio-postgres" 1
    mock_dokku_exit "postgres:linked studio-postgres studio" 1
    mock_dokku_exit "redis:exists studio-redis" 1
    mock_dokku_exit "redis:linked studio-redis studio" 1
    ensure_app_services "studio"
    assert_dokku_called "redis:create studio-redis"
    assert_dokku_called "redis:link studio-redis studio --no-restart"
}

@test "ensure_app_services creates with version and image flags" {
    mock_dokku_exit "postgres:exists funqtion-postgres" 1
    mock_dokku_exit "postgres:linked funqtion-postgres funqtion" 1
    mock_dokku_exit "redis:exists funqtion-redis" 1
    mock_dokku_exit "redis:linked funqtion-redis funqtion" 1
    ensure_app_services "funqtion"
    assert_dokku_called "postgres:create funqtion-postgres -I 17-3.5 -i postgis/postgis"
    assert_dokku_called "redis:create funqtion-redis -I 7.2-alpine"
}

@test "ensure_app_services skips when already exists and linked" {
    mock_dokku_exit "postgres:exists studio-postgres" 0
    mock_dokku_exit "postgres:linked studio-postgres studio" 0
    mock_dokku_exit "redis:exists studio-redis" 0
    mock_dokku_exit "redis:linked studio-redis studio" 0
    ensure_app_services "studio"
    refute_dokku_called "postgres:create"
    refute_dokku_called "postgres:link"
    refute_dokku_called "redis:create"
    refute_dokku_called "redis:link"
}

@test "ensure_app_services links existing unlinked service" {
    mock_dokku_exit "postgres:exists studio-postgres" 0
    mock_dokku_exit "postgres:linked studio-postgres studio" 1
    mock_dokku_exit "redis:exists studio-redis" 0
    mock_dokku_exit "redis:linked studio-redis studio" 0
    ensure_app_services "studio"
    refute_dokku_called "postgres:create"
    assert_dokku_called "postgres:link studio-postgres studio --no-restart"
    refute_dokku_called "redis:create"
    refute_dokku_called "redis:link"
}

@test "ensure_app_services skips plugins not configured on app" {
    ensure_app_services "qultr-sandbox"
    refute_dokku_called "postgres:create"
    refute_dokku_called "postgres:link"
    refute_dokku_called "redis:create"
    refute_dokku_called "redis:link"
}

@test "ensure_app_services runs custom script for script plugins" {
    # Use a fixture with a script plugin
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/script_plugin.yml"

    # Create a temporary script
    local script_dir
    script_dir=$(dirname "$DOKKU_COMPOSE_FILE")
    mkdir -p "${script_dir}/scripts"
    cat > "${script_dir}/scripts/letsencrypt.sh" <<'SCRIPT'
# Record that script was called with correct vars
echo "script:${SERVICE_ACTION}:${SERVICE_APP}:${SERVICE_CONFIG}" >> "$DOKKU_CMD_LOG"
SCRIPT

    ensure_app_services "api"

    # Verify the script was sourced with correct variables
    assert_dokku_called "script:up:api:"

    # Clean up
    rm -rf "${script_dir}/scripts"
}

@test "ensure_app_services skips everything when no plugins declared" {
    DOKKU_COMPOSE_FILE="${MOCK_DIR}/no_plugins.yml"
    cat > "$DOKKU_COMPOSE_FILE" <<'YAML'
apps:
  myapp:
    build_dir: apps/myapp
YAML
    ensure_app_services "myapp"
    # No calls should have been made
    [[ ! -s "$DOKKU_CMD_LOG" ]]
}

# --- destroy_app_services ---

@test "destroy_app_services unlinks and destroys services" {
    mock_dokku_exit "postgres:exists studio-postgres" 0
    mock_dokku_exit "postgres:linked studio-postgres studio" 0
    mock_dokku_exit "redis:exists studio-redis" 0
    mock_dokku_exit "redis:linked studio-redis studio" 0
    destroy_app_services "studio"
    assert_dokku_called "postgres:unlink studio-postgres studio --no-restart"
    assert_dokku_called "postgres:destroy studio-postgres --force"
    assert_dokku_called "redis:unlink studio-redis studio --no-restart"
    assert_dokku_called "redis:destroy studio-redis --force"
}

@test "destroy_app_services skips unlink when not linked" {
    mock_dokku_exit "postgres:exists studio-postgres" 0
    mock_dokku_exit "postgres:linked studio-postgres studio" 1
    mock_dokku_exit "redis:exists studio-redis" 0
    mock_dokku_exit "redis:linked studio-redis studio" 1
    destroy_app_services "studio"
    refute_dokku_called "postgres:unlink"
    assert_dokku_called "postgres:destroy studio-postgres --force"
    refute_dokku_called "redis:unlink"
    assert_dokku_called "redis:destroy studio-redis --force"
}

@test "destroy_app_services skips when service does not exist" {
    mock_dokku_exit "postgres:exists studio-postgres" 1
    mock_dokku_exit "redis:exists studio-redis" 1
    destroy_app_services "studio"
    refute_dokku_called "postgres:unlink"
    refute_dokku_called "postgres:destroy"
    refute_dokku_called "redis:unlink"
    refute_dokku_called "redis:destroy"
}

@test "destroy_app_services runs custom script with down action" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/script_plugin.yml"

    local script_dir
    script_dir=$(dirname "$DOKKU_COMPOSE_FILE")
    mkdir -p "${script_dir}/scripts"
    cat > "${script_dir}/scripts/letsencrypt.sh" <<'SCRIPT'
echo "script:${SERVICE_ACTION}:${SERVICE_APP}:${SERVICE_CONFIG}" >> "$DOKKU_CMD_LOG"
SCRIPT

    destroy_app_services "api"

    assert_dokku_called "script:down:api:"

    rm -rf "${script_dir}/scripts"
}
