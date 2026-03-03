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

@test "ensure_app_builder sets build_dir via builder:set" {
    ensure_app_builder "funqtion"
    assert_dokku_called "builder:set funqtion build-dir apps/funqtion-api"
}

@test "ensure_app_builder sets build args" {
    ensure_app_builder "funqtion"
    assert_dokku_called "docker-options:add funqtion build --build-arg SENTRY_AUTH_TOKEN=test-token"
}

@test "ensure_app_builder handles app with only build_dir" {
    ensure_app_builder "studio"
    assert_dokku_called "builder:set studio build-dir apps/studio-api"
    refute_dokku_called "builder-dockerfile:set studio"
    refute_dokku_called "app-json:set studio"
}

@test "ensure_app_builder skips when no builder config" {
    local tmpfile="${MOCK_DIR}/no_builder.yml"
    cat > "$tmpfile" <<'EOF'
apps:
  bare:
    ports:
      - "http:5000:5000"
EOF
    DOKKU_COMPOSE_FILE="$tmpfile"
    ensure_app_builder "bare"
    refute_dokku_called "builder-dockerfile:set"
    refute_dokku_called "builder:set"
    refute_dokku_called "app-json:set"
    refute_dokku_called "docker-options:add"
}
