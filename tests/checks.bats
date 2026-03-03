#!/usr/bin/env bash

setup() {
    load 'test_helper'
    setup_mocks
    source "${PROJECT_ROOT}/lib/checks.sh"
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/full.yml"
}

teardown() {
    teardown_mocks
}

@test "ensure_app_checks sets configured properties" {
    ensure_app_checks "funqtion"
    assert_dokku_called "checks:set funqtion wait-to-retire 60"
    assert_dokku_called "checks:set funqtion attempts 5"
}

@test "ensure_app_checks skips when no checks configured" {
    ensure_app_checks "studio"
    refute_dokku_called "checks:set"
}
