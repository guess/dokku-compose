#!/usr/bin/env bash

setup() {
    load 'test_helper'
    setup_mocks
    source "${PROJECT_ROOT}/lib/postgres.sh"
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/full.yml"
}

teardown() {
    teardown_mocks
}

@test "ensure_app_postgres creates and links when postgres: true" {
    mock_dokku_exit "postgres:exists studio-db" 1
    mock_dokku_exit "postgres:linked studio-db studio" 1
    ensure_app_postgres "studio"
    assert_dokku_called "postgres:create studio-db"
    assert_dokku_called "postgres:link studio-db studio --no-restart"
}

@test "ensure_app_postgres creates with version and image" {
    mock_dokku_exit "postgres:exists funqtion-db" 1
    mock_dokku_exit "postgres:linked funqtion-db funqtion" 1
    ensure_app_postgres "funqtion"
    assert_dokku_called "postgres:create funqtion-db -I 17-3.5 -i postgis/postgis"
    assert_dokku_called "postgres:link funqtion-db funqtion --no-restart"
}

@test "ensure_app_postgres skips when already exists and linked" {
    mock_dokku_exit "postgres:exists studio-db" 0
    mock_dokku_exit "postgres:linked studio-db studio" 0
    ensure_app_postgres "studio"
    refute_dokku_called "postgres:create"
    refute_dokku_called "postgres:link"
}

@test "ensure_app_postgres links existing unlinked service" {
    mock_dokku_exit "postgres:exists studio-db" 0
    mock_dokku_exit "postgres:linked studio-db studio" 1
    ensure_app_postgres "studio"
    refute_dokku_called "postgres:create"
    assert_dokku_called "postgres:link studio-db studio --no-restart"
}

@test "ensure_app_postgres skips when no postgres configured" {
    ensure_app_postgres "qultr-sandbox"
    refute_dokku_called "postgres:create"
    refute_dokku_called "postgres:link"
}
