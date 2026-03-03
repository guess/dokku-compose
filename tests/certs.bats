#!/usr/bin/env bash

setup() {
    load 'test_helper'
    setup_mocks
    source "${PROJECT_ROOT}/lib/certs.sh"
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/full.yml"
}

teardown() {
    teardown_mocks
}

@test "ensure_app_certs skips when no ssl configured" {
    ensure_app_certs "qultr-sandbox"
    refute_dokku_called "certs:add"
}

@test "ensure_app_certs adds certificate from directory" {
    # Create mock cert directory
    local cert_dir="${MOCK_DIR}/certs/funqtion.co"
    mkdir -p "$cert_dir"
    echo "CERT" > "$cert_dir/cert.crt"
    echo "KEY" > "$cert_dir/cert.key"

    # Override yaml_app_get to return our mock path
    yaml_app_get() {
        if [[ "$2" == ".certs" ]]; then
            echo "${cert_dir}"
        fi
    }

    ensure_app_certs "funqtion"
    assert_dokku_called "certs:add funqtion"
}

@test "ensure_app_certs errors on missing cert files" {
    yaml_app_get() {
        if [[ "$2" == ".certs" ]]; then
            echo "/nonexistent/path"
        fi
    }

    ensure_app_certs "funqtion"
    # Should have logged an error, not crashed
    [[ "$DOKKU_COMPOSE_ERRORS" -gt 0 ]]
}
