#!/usr/bin/env bash

setup() {
    load 'test_helper'
    setup_mocks
    source "${PROJECT_ROOT}/lib/config.sh"
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/full.yml"
}

teardown() {
    teardown_mocks
}

@test "ensure_app_config sets env vars with --no-restart" {
    ensure_app_config "funqtion"
    assert_dokku_called "config:set --no-restart funqtion"
    assert_dokku_called "APP_ENV=staging"
}

@test "ensure_app_config skips when no env configured" {
    ensure_app_config "qultr-sandbox"
    refute_dokku_called "config:set"
}
