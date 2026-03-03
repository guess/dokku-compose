#!/usr/bin/env bash

setup() {
    load 'test_helper'
    setup_mocks
    source "${PROJECT_ROOT}/lib/builder.sh"
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/full.yml"
}

teardown() {
    teardown_mocks
}

@test "ensure_app_builder sets dockerfile path" {
    ensure_app_builder "funqtion"
    assert_dokku_called "builder-dockerfile:set funqtion dockerfile-path docker/prod/api/Dockerfile"
}

@test "ensure_app_builder sets app_json path" {
    ensure_app_builder "funqtion"
    assert_dokku_called "app-json:set funqtion appjson-path docker/prod/api/app.json"
}

@test "ensure_app_builder sets build args" {
    ensure_app_builder "funqtion"
    assert_dokku_called "docker-options:add funqtion build --build-arg SENTRY_AUTH_TOKEN=test-token"
}

@test "ensure_app_builder sets build_dir as APP_PATH build arg" {
    ensure_app_builder "funqtion"
    assert_dokku_called "docker-options:add funqtion build --build-arg APP_PATH=apps/funqtion-api"
}

@test "ensure_app_builder skips when no builder config" {
    ensure_app_builder "qultr-sandbox"
    # qultr-sandbox has dockerfile but no app_json or build_args
    assert_dokku_called "builder-dockerfile:set qultr-sandbox dockerfile-path docker/prod/sandbox/Dockerfile"
    refute_dokku_called "app-json:set qultr-sandbox"
}
