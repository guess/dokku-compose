#!/usr/bin/env bash

setup() {
    load 'test_helper'
    setup_mocks
    source "${PROJECT_ROOT}/lib/redis.sh"
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/full.yml"
}

teardown() {
    teardown_mocks
}

@test "ensure_app_redis creates and links when redis: true" {
    mock_dokku_exit "redis:exists studio-redis" 1
    mock_dokku_exit "redis:linked studio-redis studio" 1
    ensure_app_redis "studio"
    assert_dokku_called "redis:create studio-redis"
    assert_dokku_called "redis:link studio-redis studio --no-restart"
}

@test "ensure_app_redis creates with version" {
    mock_dokku_exit "redis:exists funqtion-redis" 1
    mock_dokku_exit "redis:linked funqtion-redis funqtion" 1
    ensure_app_redis "funqtion"
    assert_dokku_called "redis:create funqtion-redis -I 7.2-alpine"
}

@test "ensure_app_redis skips when already exists and linked" {
    mock_dokku_exit "redis:exists studio-redis" 0
    mock_dokku_exit "redis:linked studio-redis studio" 0
    ensure_app_redis "studio"
    refute_dokku_called "redis:create"
    refute_dokku_called "redis:link"
}

@test "ensure_app_redis skips when no redis configured" {
    ensure_app_redis "qultr-sandbox"
    refute_dokku_called "redis:create"
    refute_dokku_called "redis:link"
}
