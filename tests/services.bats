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
