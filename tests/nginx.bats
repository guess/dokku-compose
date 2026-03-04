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

# --- Per-app nginx ---

@test "ensure_app_nginx sets configured properties" {
    ensure_app_nginx "qultr"
    assert_dokku_called "nginx:set qultr client-max-body-size 15m"
}

@test "ensure_app_nginx skips when no nginx configured" {
    ensure_app_nginx "studio"
    refute_dokku_called "nginx:set"
}

# --- Global nginx ---

@test "ensure_global_nginx sets global properties" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/global_nginx.yml"
    ensure_global_nginx
    assert_dokku_called "nginx:set --global client-max-body-size 50m"
    assert_dokku_called "nginx:set --global hsts true"
}

@test "ensure_global_nginx does nothing when key absent" {
    ensure_global_nginx
    refute_dokku_called "nginx:set --global"
}

# --- Teardown ---

@test "destroy_app_nginx clears each configured property" {
    destroy_app_nginx "qultr"
    assert_dokku_called "nginx:set qultr client-max-body-size"
}

@test "destroy_app_nginx does nothing when nginx key absent" {
    destroy_app_nginx "studio"
    refute_dokku_called "nginx:set"
}
