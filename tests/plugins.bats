#!/usr/bin/env bash

setup() {
    load 'test_helper'
    setup_mocks
    source "${PROJECT_ROOT}/lib/plugins.sh"
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/full.yml"
}

teardown() {
    teardown_mocks
}

@test "ensure_plugins installs missing plugins" {
    mock_dokku_output "plugin:list" "  00_dokku-standard    0.35.12 true   dokku core standard plugin"
    ensure_plugins
    assert_dokku_called "plugin:install https://github.com/dokku/dokku-postgres.git --committish 1.41.0"
    assert_dokku_called "plugin:install https://github.com/dokku/dokku-redis.git"
}

@test "ensure_plugins skips already installed plugins" {
    mock_dokku_output "plugin:list" "  postgres    1.41.0 true   dokku postgres plugin\n  redis    7.0.0 true   dokku redis plugin"
    ensure_plugins
    refute_dokku_called "plugin:install"
}

@test "ensure_plugins skips when no plugins declared" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/simple.yml"
    ensure_plugins
    refute_dokku_called "plugin:install"
    refute_dokku_called "plugin:list"
}
