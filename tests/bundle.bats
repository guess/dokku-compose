#!/usr/bin/env bash

setup() {
    load 'test_helper/bats-support/load'
    load 'test_helper/bats-assert/load'
    PROJECT_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
    BUNDLE_SCRIPT="$PROJECT_ROOT/scripts/bundle.sh"
    if [[ ! -x "$BUNDLE_SCRIPT" ]]; then
        skip "bundle script not yet created"
    fi
}

@test "bundle script outputs valid bash" {
    run bash -n <("$PROJECT_ROOT/scripts/bundle.sh")
    assert_success
}

@test "bundled script shows version" {
    run bash <("$PROJECT_ROOT/scripts/bundle.sh") --version
    assert_success
    assert_output --partial "dokku-compose"
}

@test "bundled script shows help" {
    run bash <("$PROJECT_ROOT/scripts/bundle.sh") --help
    assert_success
    assert_output --partial "Usage:"
}
