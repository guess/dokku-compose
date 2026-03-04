#!/usr/bin/env bash

setup() {
    load 'test_helper'
    setup_mocks
    source "${PROJECT_ROOT}/lib/ports.sh"
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/full.yml"
}

teardown() {
    teardown_mocks
}

@test "ensure_app_ports sets configured port mappings" {
    mock_dokku_output "ports:report funqtion --ports-map" ""
    ensure_app_ports "funqtion"
    assert_dokku_called "ports:set funqtion https:4001:4000"
}

@test "ensure_app_ports skips when ports already match" {
    mock_dokku_output "ports:report funqtion --ports-map" "https:4001:4000"
    ensure_app_ports "funqtion"
    refute_dokku_called "ports:set"
}

@test "ensure_app_ports skips when no ports configured" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/simple.yml"
    # simple.yml has myapp with http:5000:5000
    mock_dokku_output "ports:report myapp --ports-map" ""
    ensure_app_ports "myapp"
    assert_dokku_called "ports:set myapp http:5000:5000"
}

@test "ensure_app_ports skips when multi-port mappings match in different order" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/multi-port.yml"
    mock_dokku_output "ports:report portapp --ports-map" "http:80:5000 https:443:4000"
    ensure_app_ports "portapp"
    refute_dokku_called "ports:set"
}

@test "destroy_app_ports clears port mappings" {
    destroy_app_ports "funqtion"
    assert_dokku_called "ports:clear funqtion"
}
