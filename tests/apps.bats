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

@test "ensure_vhosts_disabled calls domains:disable" {
    ensure_vhosts_disabled "myapp"
    assert_dokku_called "domains:disable myapp"
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
