#!/usr/bin/env bash

setup() {
    load 'test_helper/bats-support/load'
    load 'test_helper/bats-assert/load'

    CLI="${BATS_TEST_DIRNAME}/../bin/dokku-compose"
    TEST_DIR="$(mktemp -d)"
}

teardown() {
    rm -rf "$TEST_DIR"
}

@test "init with no args creates empty apps" {
    run "$CLI" init --file "$TEST_DIR/dokku-compose.yml"
    assert_success
    assert_output --partial "Created $TEST_DIR/dokku-compose.yml"
    assert_equal "$(cat "$TEST_DIR/dokku-compose.yml")" "apps: {}"
}

@test "init with one app" {
    run "$CLI" init --file "$TEST_DIR/dokku-compose.yml" myapp
    assert_success
    run cat "$TEST_DIR/dokku-compose.yml"
    assert_line --index 0 "apps:"
    assert_line --index 1 "  myapp:"
}

@test "init with multiple apps" {
    run "$CLI" init --file "$TEST_DIR/dokku-compose.yml" api worker
    assert_success
    run cat "$TEST_DIR/dokku-compose.yml"
    assert_line --index 0 "apps:"
    assert_line --index 1 "  api:"
    assert_line --index 2 "  worker:"
}

@test "init refuses to overwrite existing file" {
    echo "existing" > "$TEST_DIR/dokku-compose.yml"
    run "$CLI" init --file "$TEST_DIR/dokku-compose.yml"
    assert_failure
    assert_output --partial "already exists"
    assert_equal "$(cat "$TEST_DIR/dokku-compose.yml")" "existing"
}
