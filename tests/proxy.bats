#!/usr/bin/env bash

setup() {
    load 'test_helper'
    setup_mocks
    source "${PROJECT_ROOT}/lib/proxy.sh"
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/full.yml"
}

teardown() {
    teardown_mocks
}

@test "ensure_app_proxy disables proxy when enabled: false" {
    ensure_app_proxy "qultr-sandbox"
    assert_dokku_called "proxy:disable qultr-sandbox"
    refute_dokku_called "proxy:enable"
}

@test "ensure_app_proxy enables proxy when enabled: true" {
    local tmpfile="${MOCK_DIR}/proxy_on.yml"
    cat > "$tmpfile" <<'EOF'
apps:
  worker:
    proxy:
      enabled: true
EOF
    DOKKU_COMPOSE_FILE="$tmpfile"
    ensure_app_proxy "worker"
    assert_dokku_called "proxy:enable worker"
    refute_dokku_called "proxy:disable"
}

@test "ensure_app_proxy skips when no proxy configured" {
    ensure_app_proxy "funqtion"
    refute_dokku_called "proxy:enable"
    refute_dokku_called "proxy:disable"
}
