#!/usr/bin/env bash

setup() {
    load 'test_helper'
    setup_mocks
    source "${PROJECT_ROOT}/lib/config.sh"
}

teardown() {
    teardown_mocks
}

# --- App-scoped env: map ---

@test "ensure_app_config sets env vars with --no-restart" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/config_env.yml"
    mock_dokku_output "config:keys myapp" ""
    ensure_app_config "myapp"
    assert_dokku_called "config:set --no-restart myapp"
    assert_dokku_called "APP_ENV=production"
    assert_dokku_called "APP_SECRET=mysecret"
}

@test "ensure_app_config skips when no env configured" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/full.yml"
    ensure_app_config "qultr-sandbox"
    refute_dokku_called "config:set"
    refute_dokku_called "config:unset"
}

# --- App-scoped env: false ---

@test "ensure_app_config unsets all prefixed vars when env: false" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/config_env_false.yml"
    mock_dokku_output "config:keys myapp" "APP_ENV\nAPP_SECRET\nDATABASE_URL"
    ensure_app_config "myapp"
    assert_dokku_called "config:unset --no-restart myapp"
    assert_dokku_called "APP_ENV"
    assert_dokku_called "APP_SECRET"
    refute_dokku_called "config:clear"
    refute_dokku_called "config:set"
    refute_dokku_called "DATABASE_URL"
}

@test "ensure_app_config does nothing when env: false and no prefixed vars exist" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/config_env_false.yml"
    mock_dokku_output "config:keys myapp" "DATABASE_URL"
    ensure_app_config "myapp"
    refute_dokku_called "config:unset"
    refute_dokku_called "config:clear"
    refute_dokku_called "config:set"
}

# --- Prefix convergence: default APP_ ---

@test "ensure_app_config unsets orphaned prefixed vars with default prefix" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/config_env.yml"
    mock_dokku_output "config:keys myapp" "APP_ENV\nAPP_SECRET\nAPP_OLD\nDATABASE_URL"
    ensure_app_config "myapp"
    assert_dokku_called "config:set --no-restart myapp"
    assert_dokku_called "config:unset --no-restart myapp APP_OLD"
    refute_dokku_called "DATABASE_URL"
}

@test "ensure_app_config skips unset when no orphaned vars" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/config_env.yml"
    mock_dokku_output "config:keys myapp" "APP_ENV\nAPP_SECRET\nDATABASE_URL"
    ensure_app_config "myapp"
    assert_dokku_called "config:set --no-restart myapp"
    refute_dokku_called "config:unset"
}

# --- Prefix convergence: custom prefix ---

@test "ensure_app_config uses custom global prefix" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/config_env_prefix_custom.yml"
    mock_dokku_output "config:keys myapp" "MYCO_ENV\nMYCO_OLD\nDATABASE_URL"
    ensure_app_config "myapp"
    assert_dokku_called "config:set --no-restart myapp"
    assert_dokku_called "config:unset --no-restart myapp MYCO_OLD"
    refute_dokku_called "DATABASE_URL"
}

# --- Prefix validation ---

@test "ensure_app_config warns and skips non-prefixed vars" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/config_env_bad_prefix.yml"
    mock_dokku_output "config:keys myapp" ""
    ensure_app_config "myapp"
    assert_dokku_called "config:set --no-restart myapp"
    assert_dokku_called "APP_ENV=production"
    refute_dokku_called "DATABASE_URL"
}

# --- Global env: map ---

@test "ensure_global_config sets global env vars" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/config_global_env.yml"
    mock_dokku_output "config:keys --global" ""
    ensure_global_config
    assert_dokku_called "config:set --no-restart --global"
    assert_dokku_called "APP_GLOBAL_KEY=globalvalue"
    assert_dokku_called "APP_OTHER=other"
}

# --- Global env: false ---

@test "ensure_global_config unsets all global prefixed vars when false" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/config_global_env_false.yml"
    mock_dokku_output "config:keys --global" "APP_GLOBAL_KEY\nAPP_OTHER\nDATABASE_URL"
    ensure_global_config
    assert_dokku_called "config:unset --no-restart --global"
    assert_dokku_called "APP_GLOBAL_KEY"
    assert_dokku_called "APP_OTHER"
    refute_dokku_called "config:clear"
    refute_dokku_called "config:set"
    refute_dokku_called "DATABASE_URL"
}

# --- Global env: absent ---

@test "ensure_global_config does nothing when key absent" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/full.yml"
    ensure_global_config
    refute_dokku_called "config:set"
    refute_dokku_called "config:clear"
    refute_dokku_called "config:unset"
}

# --- Global env: convergence ---

@test "ensure_global_config unsets orphaned prefixed vars" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/config_global_env.yml"
    mock_dokku_output "config:keys --global" "APP_GLOBAL_KEY\nAPP_OTHER\nAPP_STALE\nSOME_OTHER"
    ensure_global_config
    assert_dokku_called "config:set --no-restart --global"
    assert_dokku_called "config:unset --no-restart --global APP_STALE"
    refute_dokku_called "SOME_OTHER"
}
