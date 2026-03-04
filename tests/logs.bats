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

# --- Per-app logs ---

@test "ensure_app_logs sets configured properties" {
    ensure_app_logs "studio"
    assert_dokku_called "logs:set studio max-size 10m"
}

@test "ensure_app_logs skips when no logs configured" {
    ensure_app_logs "funqtion"
    refute_dokku_called "logs:set"
}

@test "ensure_app_logs sets multiple properties" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/global_logs.yml"
    ensure_app_logs "myapp"
    assert_dokku_called "logs:set myapp max-size 10m"
    assert_dokku_called "logs:set myapp vector-sink file://?path=/tmp/app.log"
}

# --- Global logs ---

@test "ensure_global_logs sets global properties" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/global_logs.yml"
    ensure_global_logs
    assert_dokku_called "logs:set --global max-size 50m"
    assert_dokku_called "logs:set --global vector-image timberio/vector:0.36.0-alpine"
}

@test "ensure_global_logs does nothing when key absent" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/full.yml"
    ensure_global_logs
    refute_dokku_called "logs:set --global"
}
