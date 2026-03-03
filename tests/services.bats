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

# --- ensure_services (create instances) ---

@test "ensure_services creates services that don't exist" {
    mock_dokku_exit "postgres:exists funqtion-postgres" 1
    mock_dokku_exit "redis:exists funqtion-redis" 1
    mock_dokku_exit "postgres:exists studio-postgres" 1
    mock_dokku_exit "redis:exists studio-redis" 1
    mock_dokku_exit "postgres:exists qultr-postgres" 1
    mock_dokku_exit "redis:exists qultr-redis" 1
    ensure_services
    assert_dokku_called "postgres:create funqtion-postgres -I 17-3.5 -i postgis/postgis"
    assert_dokku_called "redis:create funqtion-redis -I 7.2-alpine"
    assert_dokku_called "postgres:create studio-postgres"
    assert_dokku_called "redis:create studio-redis"
    assert_dokku_called "postgres:create qultr-postgres"
    assert_dokku_called "redis:create qultr-redis"
}

@test "ensure_services skips services that already exist" {
    mock_dokku_exit "postgres:exists funqtion-postgres" 0
    mock_dokku_exit "redis:exists funqtion-redis" 0
    mock_dokku_exit "postgres:exists studio-postgres" 0
    mock_dokku_exit "redis:exists studio-redis" 0
    mock_dokku_exit "postgres:exists qultr-postgres" 0
    mock_dokku_exit "redis:exists qultr-redis" 0
    ensure_services
    refute_dokku_called "postgres:create"
    refute_dokku_called "redis:create"
}

@test "ensure_services creates with version and image flags" {
    mock_dokku_exit "postgres:exists funqtion-postgres" 1
    mock_dokku_exit "redis:exists funqtion-redis" 1
    mock_dokku_exit "postgres:exists studio-postgres" 0
    mock_dokku_exit "redis:exists studio-redis" 0
    mock_dokku_exit "postgres:exists qultr-postgres" 0
    mock_dokku_exit "redis:exists qultr-redis" 0
    ensure_services
    assert_dokku_called "postgres:create funqtion-postgres -I 17-3.5 -i postgis/postgis"
    assert_dokku_called "redis:create funqtion-redis -I 7.2-alpine"
}

@test "ensure_services skips when no services section" {
    DOKKU_COMPOSE_FILE="${MOCK_DIR}/no_services.yml"
    cat > "$DOKKU_COMPOSE_FILE" <<'YAML'
apps:
  myapp:
    build_dir: apps/myapp
YAML
    ensure_services
    [[ ! -s "$DOKKU_CMD_LOG" ]]
}

# --- ensure_app_links (link/unlink) ---

@test "ensure_app_links links declared services" {
    mock_dokku_exit "postgres:linked funqtion-postgres funqtion" 1
    mock_dokku_exit "redis:linked funqtion-redis funqtion" 1
    ensure_app_links "funqtion"
    assert_dokku_called "postgres:link funqtion-postgres funqtion --no-restart"
    assert_dokku_called "redis:link funqtion-redis funqtion --no-restart"
}

@test "ensure_app_links skips already linked services" {
    mock_dokku_exit "postgres:linked funqtion-postgres funqtion" 0
    mock_dokku_exit "redis:linked funqtion-redis funqtion" 0
    ensure_app_links "funqtion"
    refute_dokku_called "postgres:link"
    refute_dokku_called "redis:link"
}

@test "ensure_app_links unlinks services not in links list" {
    # studio has links: [studio-postgres, studio-redis]
    # Mock studio-postgres as linked, studio-redis as linked
    # But also mock funqtion-postgres as linked to studio (shouldn't be)
    mock_dokku_exit "postgres:linked studio-postgres studio" 0
    mock_dokku_exit "redis:linked studio-redis studio" 0
    mock_dokku_exit "postgres:linked funqtion-postgres studio" 0
    mock_dokku_exit "redis:linked funqtion-redis studio" 1
    mock_dokku_exit "postgres:linked qultr-postgres studio" 1
    mock_dokku_exit "redis:linked qultr-redis studio" 1
    ensure_app_links "studio"
    # Should unlink funqtion-postgres from studio (linked but not in studio's links)
    assert_dokku_called "postgres:unlink funqtion-postgres studio --no-restart"
    # Should NOT unlink studio-postgres or studio-redis (they're in the links list)
    refute_dokku_called "postgres:unlink studio-postgres"
    refute_dokku_called "redis:unlink studio-redis"
}

@test "ensure_app_links skips when links key absent" {
    # qultr-sandbox has no links key
    ensure_app_links "qultr-sandbox"
    refute_dokku_called "link"
    refute_dokku_called "unlink"
}

@test "ensure_app_links unlinks all when links key is empty" {
    DOKKU_COMPOSE_FILE="${MOCK_DIR}/empty_links.yml"
    cat > "$DOKKU_COMPOSE_FILE" <<'YAML'
services:
  mydb:
    plugin: postgres

apps:
  myapp:
    build_dir: apps/myapp
    links:
YAML
    mock_dokku_exit "postgres:linked mydb myapp" 0
    ensure_app_links "myapp"
    assert_dokku_called "postgres:unlink mydb myapp --no-restart"
}

@test "ensure_app_links works with shared services" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/shared_service.yml"
    mock_dokku_exit "postgres:linked shared-db api" 1
    mock_dokku_exit "redis:linked shared-cache api" 1
    ensure_app_links "api"
    assert_dokku_called "postgres:link shared-db api --no-restart"
    assert_dokku_called "redis:link shared-cache api --no-restart"
}

# --- ensure_app_scripts (custom script plugins) ---

@test "ensure_app_scripts runs custom script for script plugins" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/script_plugin.yml"

    local script_dir
    script_dir=$(dirname "$DOKKU_COMPOSE_FILE")
    mkdir -p "${script_dir}/scripts"
    cat > "${script_dir}/scripts/letsencrypt.sh" <<'SCRIPT'
echo "script:${SERVICE_ACTION}:${SERVICE_APP}:${SERVICE_CONFIG}" >> "$DOKKU_CMD_LOG"
SCRIPT

    ensure_app_scripts "api"
    assert_dokku_called "script:up:api:"

    rm -rf "${script_dir}/scripts"
}

@test "ensure_app_scripts skips script plugins not configured on app" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/script_plugin.yml"

    local script_dir
    script_dir=$(dirname "$DOKKU_COMPOSE_FILE")
    mkdir -p "${script_dir}/scripts"
    cat > "${script_dir}/scripts/letsencrypt.sh" <<'SCRIPT'
echo "script:${SERVICE_ACTION}:${SERVICE_APP}:${SERVICE_CONFIG}" >> "$DOKKU_CMD_LOG"
SCRIPT

    ensure_app_scripts "nonexistent"
    [[ ! -s "$DOKKU_CMD_LOG" ]]

    rm -rf "${script_dir}/scripts"
}

@test "ensure_app_scripts skips non-script plugins" {
    ensure_app_scripts "funqtion"
    [[ ! -s "$DOKKU_CMD_LOG" ]]
}

# --- destroy_app_scripts ---

@test "destroy_app_scripts runs custom script with down action" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/script_plugin.yml"

    local script_dir
    script_dir=$(dirname "$DOKKU_COMPOSE_FILE")
    mkdir -p "${script_dir}/scripts"
    cat > "${script_dir}/scripts/letsencrypt.sh" <<'SCRIPT'
echo "script:${SERVICE_ACTION}:${SERVICE_APP}:${SERVICE_CONFIG}" >> "$DOKKU_CMD_LOG"
SCRIPT

    destroy_app_scripts "api"
    assert_dokku_called "script:down:api:"

    rm -rf "${script_dir}/scripts"
}
