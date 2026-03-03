#!/usr/bin/env bash

setup() {
    load 'test_helper'
    setup_mocks
    source "${PROJECT_ROOT}/lib/domains.sh"
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/full.yml"
}

teardown() {
    teardown_mocks
}

@test "ensure_app_domains sets declared domains" {
    ensure_app_domains "funqtion"
    assert_dokku_called "domains:enable funqtion"
    assert_dokku_called "domains:set funqtion funqtion.example.com api.funqtion.co"
}

@test "ensure_app_domains disables vhosts when no domains declared" {
    ensure_app_domains "studio"
    assert_dokku_called "domains:disable studio"
    refute_dokku_called "domains:set studio"
    refute_dokku_called "domains:enable studio"
}

@test "destroy_app_domains clears domains" {
    destroy_app_domains "funqtion"
    assert_dokku_called "domains:clear funqtion"
}
