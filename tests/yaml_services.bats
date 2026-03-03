#!/usr/bin/env bash

setup() {
    load 'test_helper'
    setup_mocks
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/full.yml"
}

teardown() {
    teardown_mocks
}

# --- yaml_has ---

@test "yaml_has returns true for existing top-level key" {
    yaml_has ".services"
}

@test "yaml_has returns false for missing top-level key" {
    DOKKU_COMPOSE_FILE="${MOCK_DIR}/no_services.yml"
    cat > "$DOKKU_COMPOSE_FILE" <<'YAML'
apps:
  myapp:
    build_dir: apps/myapp
YAML
    ! yaml_has ".services"
}

# --- yaml_service_names ---

@test "yaml_service_names lists all service names" {
    run yaml_service_names
    assert_output --partial "funqtion-postgres"
    assert_output --partial "funqtion-redis"
    assert_output --partial "studio-postgres"
}

@test "yaml_service_names returns empty when no services" {
    DOKKU_COMPOSE_FILE="${MOCK_DIR}/no_services.yml"
    cat > "$DOKKU_COMPOSE_FILE" <<'YAML'
apps:
  myapp:
    build_dir: apps/myapp
YAML
    run yaml_service_names
    assert_output ""
}

# --- yaml_service_get ---

@test "yaml_service_get returns plugin name" {
    run yaml_service_get "funqtion-postgres" ".plugin"
    assert_output "postgres"
}

@test "yaml_service_get returns version" {
    run yaml_service_get "funqtion-postgres" ".version"
    assert_output "17-3.5"
}

@test "yaml_service_get returns image" {
    run yaml_service_get "funqtion-postgres" ".image"
    assert_output "postgis/postgis"
}

@test "yaml_service_get returns empty for unset property" {
    run yaml_service_get "studio-postgres" ".version"
    assert_output ""
}

# --- yaml_app_key_exists ---

@test "yaml_app_key_exists returns true for present key with values" {
    yaml_app_key_exists "funqtion" "links"
}

@test "yaml_app_key_exists returns false for absent key" {
    yaml_app_key_exists "qultr-sandbox" "links" && return 1 || return 0
}

@test "yaml_app_key_exists returns true for present but empty key" {
    DOKKU_COMPOSE_FILE="${MOCK_DIR}/empty_links.yml"
    cat > "$DOKKU_COMPOSE_FILE" <<'YAML'
apps:
  myapp:
    build_dir: apps/myapp
    links:
YAML
    yaml_app_key_exists "myapp" "links"
}
