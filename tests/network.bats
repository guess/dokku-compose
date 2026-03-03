#!/usr/bin/env bash

setup() {
    load 'test_helper'
    setup_mocks
    source "${PROJECT_ROOT}/lib/network.sh"
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/full.yml"
}

teardown() {
    teardown_mocks
}

@test "ensure_networks creates missing networks" {
    mock_dokku_exit "network:exists studio-net" 1
    mock_dokku_exit "network:exists qultr-net" 1
    ensure_networks
    assert_dokku_called "network:create studio-net"
    assert_dokku_called "network:create qultr-net"
}

@test "ensure_networks skips existing networks" {
    mock_dokku_exit "network:exists studio-net" 0
    mock_dokku_exit "network:exists qultr-net" 0
    ensure_networks
    refute_dokku_called "network:create"
}

@test "ensure_app_networks attaches app to configured networks" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/full.yml"
    ensure_app_networks "studio"
    assert_dokku_called "network:set studio attach-post-deploy studio-net"
}

@test "ensure_app_networks skips when no networks configured" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/full.yml"
    ensure_app_networks "funqtion"
    refute_dokku_called "network:set funqtion"
}
