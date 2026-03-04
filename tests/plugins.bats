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
    mock_dokku_exit "plugin:installed postgres" 1
    mock_dokku_exit "plugin:installed redis" 1
    ensure_plugins
    assert_dokku_called "plugin:install https://github.com/dokku/dokku-postgres.git --committish 1.41.0 --name postgres"
    assert_dokku_called "plugin:install https://github.com/dokku/dokku-redis.git --name redis"
}

@test "ensure_plugins skips already installed plugins with matching version" {
    mock_dokku_exit "plugin:installed postgres" 0
    mock_dokku_exit "plugin:installed redis" 0
    mock_dokku_output "plugin:list" "  postgres    1.41.0 true   dokku postgres plugin\n  redis    7.0.0 true   dokku redis plugin"
    ensure_plugins
    refute_dokku_called "plugin:install"
    refute_dokku_called "plugin:update"
}

@test "ensure_plugins updates plugin when installed version differs" {
    mock_dokku_exit "plugin:installed postgres" 0
    mock_dokku_exit "plugin:installed redis" 0
    mock_dokku_output "plugin:list" "  postgres    1.40.0 true   dokku postgres plugin\n  redis    7.0.0 true   dokku redis plugin"
    ensure_plugins
    assert_dokku_called "plugin:update postgres 1.41.0"
    refute_dokku_called "plugin:install"
}

@test "ensure_plugins does not update plugin with no version pinned" {
    mock_dokku_exit "plugin:installed postgres" 0
    mock_dokku_exit "plugin:installed redis" 0
    mock_dokku_output "plugin:list" "  postgres    1.41.0 true   dokku postgres plugin\n  redis    7.0.0 true   dokku redis plugin"
    ensure_plugins
    refute_dokku_called "plugin:update redis"
    refute_dokku_called "plugin:install"
}

@test "ensure_plugins skips when no plugins declared" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/no_plugins.yml"
    ensure_plugins
    refute_dokku_called "plugin:install"
    refute_dokku_called "plugin:list"
}
