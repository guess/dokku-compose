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

# --- ensure_app_checks: properties with idempotency ---

@test "ensure_app_checks sets properties that differ from current" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/checks_process_types.yml"
    mock_dokku_output "checks:report myapp --checks-wait-to-retire" "0"
    mock_dokku_output "checks:report myapp --checks-attempts" "0"
    mock_dokku_output "checks:report myapp --checks-disabled-list" "none"
    mock_dokku_output "checks:report myapp --checks-skipped-list" "none"

    ensure_app_checks "myapp"
    assert_dokku_called "checks:set myapp wait-to-retire 60"
    assert_dokku_called "checks:set myapp attempts 5"
}

@test "ensure_app_checks skips properties that already match" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/checks_process_types.yml"
    mock_dokku_output "checks:report myapp --checks-wait-to-retire" "60"
    mock_dokku_output "checks:report myapp --checks-attempts" "5"
    mock_dokku_output "checks:report myapp --checks-disabled-list" "none"
    mock_dokku_output "checks:report myapp --checks-skipped-list" "none"

    ensure_app_checks "myapp"
    refute_dokku_called "checks:set"
}

@test "ensure_app_checks sets only changed properties" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/checks_process_types.yml"
    mock_dokku_output "checks:report myapp --checks-wait-to-retire" "60"
    mock_dokku_output "checks:report myapp --checks-attempts" "3"
    mock_dokku_output "checks:report myapp --checks-disabled-list" "none"
    mock_dokku_output "checks:report myapp --checks-skipped-list" "none"

    ensure_app_checks "myapp"
    refute_dokku_called "checks:set myapp wait-to-retire"
    assert_dokku_called "checks:set myapp attempts 5"
}

# --- ensure_app_checks: checks: false ---

@test "ensure_app_checks disables all when checks: false" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/checks_false.yml"
    mock_dokku_output "checks:report myapp --checks-disabled-list" "none"

    ensure_app_checks "myapp"
    assert_dokku_called "checks:disable myapp"
    refute_dokku_called "checks:set"
}

@test "ensure_app_checks skips disable when already disabled for all" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/checks_false.yml"
    mock_dokku_output "checks:report myapp --checks-disabled-list" "_all_"

    ensure_app_checks "myapp"
    refute_dokku_called "checks:disable"
}

# --- ensure_app_checks: disabled list ---

@test "ensure_app_checks disables specified process types" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/checks_process_types.yml"
    mock_dokku_output "checks:report myapp --checks-wait-to-retire" "60"
    mock_dokku_output "checks:report myapp --checks-attempts" "5"
    mock_dokku_output "checks:report myapp --checks-disabled-list" "none"
    mock_dokku_output "checks:report myapp --checks-skipped-list" "none"

    ensure_app_checks "myapp"
    assert_dokku_called "checks:disable myapp worker"
}

@test "ensure_app_checks skips disable when process types already disabled" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/checks_process_types.yml"
    mock_dokku_output "checks:report myapp --checks-wait-to-retire" "60"
    mock_dokku_output "checks:report myapp --checks-attempts" "5"
    mock_dokku_output "checks:report myapp --checks-disabled-list" "worker"
    mock_dokku_output "checks:report myapp --checks-skipped-list" "none"

    ensure_app_checks "myapp"
    refute_dokku_called "checks:disable"
}

# --- ensure_app_checks: skipped list ---

@test "ensure_app_checks skips specified process types" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/checks_process_types.yml"
    mock_dokku_output "checks:report myapp --checks-wait-to-retire" "60"
    mock_dokku_output "checks:report myapp --checks-attempts" "5"
    mock_dokku_output "checks:report myapp --checks-disabled-list" "none"
    mock_dokku_output "checks:report myapp --checks-skipped-list" "none"

    ensure_app_checks "myapp"
    assert_dokku_called "checks:skip myapp cron"
}

@test "ensure_app_checks skips skip when process types already skipped" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/checks_process_types.yml"
    mock_dokku_output "checks:report myapp --checks-wait-to-retire" "60"
    mock_dokku_output "checks:report myapp --checks-attempts" "5"
    mock_dokku_output "checks:report myapp --checks-disabled-list" "none"
    mock_dokku_output "checks:report myapp --checks-skipped-list" "cron"

    ensure_app_checks "myapp"
    refute_dokku_called "checks:skip"
}

# --- ensure_app_checks: disabled: false (re-enable all) ---

@test "ensure_app_checks re-enables all when disabled: false" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/checks_disabled_false.yml"
    mock_dokku_output "checks:report myapp --checks-disabled-list" "worker,cron"

    ensure_app_checks "myapp"
    assert_dokku_called "checks:enable myapp"
}

@test "ensure_app_checks skips re-enable when disabled: false and nothing disabled" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/checks_disabled_false.yml"
    mock_dokku_output "checks:report myapp --checks-disabled-list" "none"

    ensure_app_checks "myapp"
    refute_dokku_called "checks:enable"
}

# --- ensure_app_checks: skipped: false (re-enable all) ---

@test "ensure_app_checks re-enables all when skipped: false" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/checks_skipped_false.yml"
    mock_dokku_output "checks:report myapp --checks-skipped-list" "web,worker"

    ensure_app_checks "myapp"
    assert_dokku_called "checks:enable myapp"
}

@test "ensure_app_checks skips re-enable when skipped: false and nothing skipped" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/checks_skipped_false.yml"
    mock_dokku_output "checks:report myapp --checks-skipped-list" "none"

    ensure_app_checks "myapp"
    refute_dokku_called "checks:enable"
}

# --- ensure_app_checks: absent key ---

@test "ensure_app_checks skips when no checks configured" {
    ensure_app_checks "studio"
    refute_dokku_called "checks:set"
    refute_dokku_called "checks:disable"
    refute_dokku_called "checks:enable"
    refute_dokku_called "checks:skip"
}

# --- ensure_app_checks: properties from full.yml (backward compat) ---

@test "ensure_app_checks sets properties from full.yml" {
    mock_dokku_output "checks:report funqtion --checks-wait-to-retire" "0"
    mock_dokku_output "checks:report funqtion --checks-attempts" "0"

    ensure_app_checks "funqtion"
    assert_dokku_called "checks:set funqtion wait-to-retire 60"
    assert_dokku_called "checks:set funqtion attempts 5"
}
