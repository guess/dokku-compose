#!/usr/bin/env bash

setup() {
    load 'test_helper'
    setup_mocks
    source "${PROJECT_ROOT}/lib/dokku.sh"
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/full.yml"
}

teardown() {
    teardown_mocks
}

@test "ensure_dokku_version warns on mismatch" {
    mock_dokku_output "version" "dokku version 0.34.0"
    run ensure_dokku_version
    assert_output --partial "WARN"
}

@test "ensure_dokku_version silent on match" {
    mock_dokku_output "version" "dokku version 0.35.12"
    run ensure_dokku_version
    refute_output --partial "WARN"
}

@test "ensure_dokku_version skips when no version declared" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/simple.yml"
    run ensure_dokku_version
    refute_output --partial "WARN"
}
