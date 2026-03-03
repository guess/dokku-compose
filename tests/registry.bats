#!/usr/bin/env bash

setup() {
    load 'test_helper'
    setup_mocks
    source "${PROJECT_ROOT}/lib/registry.sh"
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/full.yml"
}

teardown() {
    teardown_mocks
}

@test "ensure_app_registry sets configured properties" {
    ensure_app_registry "funqtion"
    assert_dokku_called "registry:set funqtion push-on-release true"
    assert_dokku_called "registry:set funqtion server registry.example.com"
}

@test "ensure_app_registry skips when no registry configured" {
    ensure_app_registry "studio"
    refute_dokku_called "registry:set"
}
