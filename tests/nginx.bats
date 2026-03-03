#!/usr/bin/env bash

setup() {
    load 'test_helper'
    setup_mocks
    source "${PROJECT_ROOT}/lib/nginx.sh"
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/full.yml"
}

teardown() {
    teardown_mocks
}

@test "ensure_app_nginx sets configured properties" {
    ensure_app_nginx "qultr"
    assert_dokku_called "nginx:set qultr client-max-body-size 15m"
}

@test "ensure_app_nginx skips when no nginx configured" {
    ensure_app_nginx "studio"
    refute_dokku_called "nginx:set"
}
