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

@test "ensure_app_logs sets configured properties" {
    ensure_app_logs "studio"
    assert_dokku_called "logs:set studio max-size 10m"
}

@test "ensure_app_logs skips when no logs configured" {
    ensure_app_logs "funqtion"
    refute_dokku_called "logs:set"
}
