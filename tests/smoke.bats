#!/usr/bin/env bash

setup() {
    load 'test_helper'
    setup_mocks
}

teardown() {
    teardown_mocks
}

@test "mock dokku_cmd records calls" {
    dokku_cmd apps:list
    assert_dokku_called "apps:list"
}

@test "mock dokku_cmd respects exit codes" {
    mock_dokku_exit "apps:exists myapp" 1
    run dokku_cmd apps:exists myapp
    assert_failure
}

@test "yaml_app_names reads app names from fixture" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/simple.yml"
    run yaml_app_names
    assert_output "myapp"
}
