#!/usr/bin/env bash

setup() {
    load 'test_helper'
    setup_mocks
    CLI="${PROJECT_ROOT}/bin/dokku-compose"
}

teardown() {
    teardown_mocks
}

@test "shows usage with no arguments" {
    run "$CLI" 2>&1
    assert_output --partial "Usage:"
}

@test "shows usage with --help" {
    run "$CLI" --help
    assert_output --partial "Usage:"
}

@test "shows version with --version" {
    run "$CLI" --version
    assert_output --partial "dokku-compose"
}

@test "errors on unknown command" {
    run "$CLI" foobar
    assert_failure
    assert_output --partial "Unknown command"
}
