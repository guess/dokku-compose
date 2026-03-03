#!/usr/bin/env bash

setup() {
    load 'test_helper'
    setup_mocks
    source "${PROJECT_ROOT}/lib/apps.sh"
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/simple.yml"
}

teardown() {
    teardown_mocks
}

@test "ensure_app creates app when it doesn't exist" {
    mock_dokku_exit "apps:exists myapp" 1
    ensure_app "myapp"
    assert_dokku_called "apps:create myapp"
}

@test "ensure_app skips when app already exists" {
    mock_dokku_exit "apps:exists myapp" 0
    ensure_app "myapp"
    refute_dokku_called "apps:create myapp"
}

@test "destroy_app destroys with force when app exists" {
    mock_dokku_exit "apps:exists myapp" 0
    destroy_app "myapp"
    assert_dokku_called "apps:destroy myapp --force"
}

@test "destroy_app skips when app doesn't exist" {
    mock_dokku_exit "apps:exists myapp" 1
    destroy_app "myapp"
    refute_dokku_called "apps:destroy"
}

# --- ensure_app_locked ---

@test "ensure_app_locked locks app when locked: true" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/locked_true.yml"
    ensure_app_locked "myapp"
    assert_dokku_called "apps:lock myapp"
}

@test "ensure_app_locked unlocks app when locked: false" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/locked_false.yml"
    ensure_app_locked "myapp"
    assert_dokku_called "apps:unlock myapp"
}

@test "ensure_app_locked does nothing when locked key absent" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/simple.yml"
    ensure_app_locked "myapp"
    refute_dokku_called "apps:lock"
    refute_dokku_called "apps:unlock"
}
