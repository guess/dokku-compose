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

# --- ensure_networks ---

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

# --- ensure_app_networks (attach-post-deploy, existing) ---

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

# --- ensure_app_network (network: map, new) ---

@test "ensure_app_network sets attach-post-create from list" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/network_map.yml"
    ensure_app_network "myapp"
    assert_dokku_called "network:set myapp attach-post-create init-net"
}

@test "ensure_app_network clears attach-post-create when false" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/network_map_false.yml"
    ensure_app_network "myapp"
    assert_dokku_called "network:set myapp attach-post-create"
}

@test "ensure_app_network sets initial-network when configured" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/network_map.yml"
    ensure_app_network "myapp"
    assert_dokku_called "network:set myapp initial-network custom-bridge"
}

@test "ensure_app_network clears initial-network when false" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/network_map_false.yml"
    ensure_app_network "myapp"
    assert_dokku_called "network:set myapp initial-network"
}

@test "ensure_app_network sets bind-all-interfaces to true" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/network_map.yml"
    ensure_app_network "myapp"
    assert_dokku_called "network:set myapp bind-all-interfaces true"
}

@test "ensure_app_network sets bind-all-interfaces to false" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/network_map_false.yml"
    ensure_app_network "myapp"
    assert_dokku_called "network:set myapp bind-all-interfaces false"
}

@test "ensure_app_network sets tld when configured" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/network_map.yml"
    ensure_app_network "myapp"
    assert_dokku_called "network:set myapp tld internal"
}

@test "ensure_app_network clears tld when false" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/network_map_false.yml"
    ensure_app_network "myapp"
    assert_dokku_called "network:set myapp tld"
}

@test "ensure_app_network skips when no network key" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/full.yml"
    ensure_app_network "funqtion"
    refute_dokku_called "network:set funqtion"
}

# --- destroy_app_network ---

@test "destroy_app_network clears attach-post-deploy when networks list declared" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/network_map.yml"
    destroy_app_network "myapp"
    assert_dokku_called "network:set myapp attach-post-deploy"
}

@test "destroy_app_network clears all network map properties" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/network_map.yml"
    destroy_app_network "myapp"
    assert_dokku_called "network:set myapp attach-post-create"
    assert_dokku_called "network:set myapp initial-network"
    assert_dokku_called "network:set myapp bind-all-interfaces"
    assert_dokku_called "network:set myapp tld"
}

@test "destroy_app_network clears bind-all-interfaces when set to false in yaml" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/network_map_false.yml"
    destroy_app_network "myapp"
    assert_dokku_called "network:set myapp bind-all-interfaces"
}

@test "destroy_app_network clears only attach-post-deploy when only networks list declared" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/full.yml"
    destroy_app_network "studio"
    assert_dokku_called "network:set studio attach-post-deploy"
    refute_dokku_called "network:set studio attach-post-create"
}

@test "destroy_app_network no-op when no network keys declared" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/full.yml"
    destroy_app_network "funqtion"
    refute_dokku_called "network:set funqtion"
}

# --- destroy_networks ---

@test "destroy_networks destroys existing declared networks" {
    mock_dokku_exit "network:exists studio-net" 0
    mock_dokku_exit "network:exists qultr-net" 0
    destroy_networks
    assert_dokku_called "network:destroy studio-net"
    assert_dokku_called "network:destroy qultr-net"
}

@test "destroy_networks skips non-existing networks" {
    mock_dokku_exit "network:exists studio-net" 1
    mock_dokku_exit "network:exists qultr-net" 1
    destroy_networks
    refute_dokku_called "network:destroy"
}
