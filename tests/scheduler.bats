#!/usr/bin/env bash

setup() {
    load 'test_helper'
    setup_mocks
    source "${PROJECT_ROOT}/lib/scheduler.sh"
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/full.yml"
}

teardown() {
    teardown_mocks
}

@test "ensure_app_scheduler sets the selected scheduler" {
    ensure_app_scheduler "qultr"
    assert_dokku_called "scheduler:set qultr selected docker-local"
}

@test "ensure_app_scheduler skips when no scheduler configured" {
    ensure_app_scheduler "studio"
    refute_dokku_called "scheduler:set"
}
