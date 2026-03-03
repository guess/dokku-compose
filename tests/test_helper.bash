#!/usr/bin/env bash
# Test helper for BATS tests
# Provides dokku_cmd mock and assertion helpers

# Load BATS libraries
load 'test_helper/bats-support/load'
load 'test_helper/bats-assert/load'

# Project root
PROJECT_ROOT="$(cd "$(dirname "${BATS_TEST_FILENAME}")/.." && pwd)"

# Mock state directory (per-test)
MOCK_DIR=""
DOKKU_CMD_LOG=""

setup_mocks() {
    MOCK_DIR="$(mktemp -d)"
    DOKKU_CMD_LOG="${MOCK_DIR}/dokku_cmd.log"
    touch "$DOKKU_CMD_LOG"

    # Source project files
    source "${PROJECT_ROOT}/lib/core.sh"
    source "${PROJECT_ROOT}/lib/yaml.sh"

    # Override dokku_cmd to record calls and return mock responses
    dokku_cmd() {
        echo "$*" >> "$DOKKU_CMD_LOG"

        # Check for mock response file
        local cmd_key
        cmd_key=$(echo "$*" | tr ' ' '_' | tr ':' '_')
        if [[ -f "${MOCK_DIR}/response_${cmd_key}" ]]; then
            cat "${MOCK_DIR}/response_${cmd_key}"
            return "$(cat "${MOCK_DIR}/exitcode_${cmd_key}" 2>/dev/null || echo 0)"
        fi

        # Check for mock exit code by full command key
        if [[ -f "${MOCK_DIR}/exitcode_${cmd_key}" ]]; then
            return "$(cat "${MOCK_DIR}/exitcode_${cmd_key}")"
        fi

        # Check for mock exit code by command prefix
        local prefix
        prefix=$(echo "$1" | tr ':' '_')
        if [[ -f "${MOCK_DIR}/exitcode_${prefix}" ]]; then
            return "$(cat "${MOCK_DIR}/exitcode_${prefix}")"
        fi

        return 0
    }

    # Override dokku_cmd_check similarly
    dokku_cmd_check() {
        dokku_cmd "$@" >/dev/null 2>&1
    }

    export -f dokku_cmd dokku_cmd_check
}

teardown_mocks() {
    [[ -n "$MOCK_DIR" ]] && rm -rf "$MOCK_DIR"
}

# Set mock: dokku_cmd "<command> <args>" exits with given code
# Usage: mock_dokku_exit "apps:exists myapp" 0
mock_dokku_exit() {
    local cmd_key
    cmd_key=$(echo "$1" | tr ' ' '_' | tr ':' '_')
    echo "$2" > "${MOCK_DIR}/exitcode_${cmd_key}"
}

# Set mock: dokku_cmd "<command> <args>" outputs given text
# Usage: mock_dokku_output "apps:list" "myapp\nsecondapp"
mock_dokku_output() {
    local cmd_key
    cmd_key=$(echo "$1" | tr ' ' '_' | tr ':' '_')
    echo -e "$2" > "${MOCK_DIR}/response_${cmd_key}"
}

# Assert that dokku_cmd was called with specific args
# Usage: assert_dokku_called "apps:create myapp"
assert_dokku_called() {
    grep -qF "$1" "$DOKKU_CMD_LOG" || {
        echo "Expected dokku_cmd call: $1"
        echo "Actual calls:"
        cat "$DOKKU_CMD_LOG"
        return 1
    }
}

# Assert that dokku_cmd was NOT called with specific args
# Usage: refute_dokku_called "apps:create myapp"
refute_dokku_called() {
    if grep -qF "$1" "$DOKKU_CMD_LOG"; then
        echo "Did NOT expect dokku_cmd call: $1"
        echo "Actual calls:"
        cat "$DOKKU_CMD_LOG"
        return 1
    fi
}

# Count how many times a command was called
# Usage: assert_dokku_call_count "apps:create" 2
assert_dokku_call_count() {
    local expected="$2"
    local actual
    actual=$(grep -cF "$1" "$DOKKU_CMD_LOG" || echo 0)
    if [[ "$actual" != "$expected" ]]; then
        echo "Expected $expected calls to '$1', got $actual"
        echo "Actual calls:"
        cat "$DOKKU_CMD_LOG"
        return 1
    fi
}
