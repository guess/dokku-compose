#!/usr/bin/env bash

setup() {
    load 'test_helper'
    setup_mocks
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/full.yml"
}

teardown() {
    teardown_mocks
}

# --- dokku_set_properties ---

@test "dokku_set_properties sets each key-value pair" {
    dokku_set_properties "qultr" "nginx"
    assert_dokku_called "nginx:set qultr client-max-body-size 15m"
}

@test "dokku_set_properties skips when key absent" {
    dokku_set_properties "studio" "nginx"
    refute_dokku_called "nginx:set"
}

# --- dokku_set_list ---

@test "dokku_set_list sets all list items in one call" {
    dokku_set_list "funqtion" "ports"
    assert_dokku_called "ports:set funqtion https:4001:4000"
}

@test "dokku_set_list skips when key absent" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/simple.yml"
    dokku_set_list "myapp" "nginx"
    refute_dokku_called "nginx:set"
}

# --- dokku_set_property ---

@test "dokku_set_property sets a single scalar value" {
    local tmpfile="${MOCK_DIR}/scalar.yml"
    cat > "$tmpfile" <<'EOF'
apps:
  testapp:
    scheduler: docker-local
EOF
    DOKKU_COMPOSE_FILE="$tmpfile"
    dokku_set_property "testapp" "scheduler" "selected"
    assert_dokku_called "scheduler:set testapp selected docker-local"
}

@test "dokku_set_property skips when key absent" {
    dokku_set_property "studio" "scheduler" "selected"
    refute_dokku_called "scheduler:set"
}
