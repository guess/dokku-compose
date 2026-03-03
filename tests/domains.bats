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

# --- App-scoped domains ---

@test "ensure_app_domains sets declared domains" {
    ensure_app_domains "funqtion"
    assert_dokku_called "domains:enable funqtion"
    assert_dokku_called "domains:set funqtion funqtion.example.com api.funqtion.co"
}

@test "ensure_app_domains disables and clears when domains: false" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/domains_false.yml"
    ensure_app_domains "myapp"
    assert_dokku_called "domains:disable myapp"
    assert_dokku_called "domains:clear myapp"
    refute_dokku_called "domains:enable"
    refute_dokku_called "domains:set"
}

@test "ensure_app_domains does nothing when domains key absent" {
    ensure_app_domains "studio"
    refute_dokku_called "domains:disable"
    refute_dokku_called "domains:enable"
    refute_dokku_called "domains:set"
    refute_dokku_called "domains:clear"
}

@test "destroy_app_domains clears domains" {
    destroy_app_domains "funqtion"
    assert_dokku_called "domains:clear funqtion"
}

# --- Global domains ---

@test "ensure_global_domains enables and sets declared global domains" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/global_domains.yml"
    ensure_global_domains
    assert_dokku_called "domains:enable --all"
    assert_dokku_called "domains:set-global example.com example.org"
}

@test "ensure_global_domains disables and clears when domains: false" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/global_domains_false.yml"
    ensure_global_domains
    assert_dokku_called "domains:disable --all"
    assert_dokku_called "domains:clear-global"
    refute_dokku_called "domains:set-global"
}

@test "ensure_global_domains does nothing when key absent" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/full.yml"
    ensure_global_domains
    refute_dokku_called "domains:set-global"
    refute_dokku_called "domains:clear-global"
}
