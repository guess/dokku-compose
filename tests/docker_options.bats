#!/usr/bin/env bash

setup() {
    load 'test_helper'
    setup_mocks
    source "${PROJECT_ROOT}/lib/docker_options.sh"
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/full.yml"
}

teardown() {
    teardown_mocks
}

@test "ensure_app_docker_options clears phase before adding options" {
    ensure_app_docker_options "qultr"
    assert_dokku_called "docker-options:clear qultr deploy"
    assert_dokku_called "docker-options:add qultr deploy --shm-size 256m"
}

@test "ensure_app_docker_options handles multiple phases" {
    local tmpfile="${MOCK_DIR}/multi_phase.yml"
    cat > "$tmpfile" <<'EOF'
apps:
  worker:
    docker_options:
      build:
        - "--no-cache"
      deploy:
        - "--shm-size 256m"
        - "-v /data:/data"
      run:
        - "--ulimit nofile=12"
EOF
    DOKKU_COMPOSE_FILE="$tmpfile"
    ensure_app_docker_options "worker"
    assert_dokku_called "docker-options:clear worker build"
    assert_dokku_called "docker-options:add worker build --no-cache"
    assert_dokku_called "docker-options:clear worker deploy"
    assert_dokku_called "docker-options:add worker deploy --shm-size 256m"
    assert_dokku_called "docker-options:add worker deploy -v /data:/data"
    assert_dokku_called "docker-options:clear worker run"
    assert_dokku_called "docker-options:add worker run --ulimit nofile=12"
}

@test "ensure_app_docker_options skips when no docker_options configured" {
    ensure_app_docker_options "studio"
    refute_dokku_called "docker-options:add"
    refute_dokku_called "docker-options:clear"
}

@test "ensure_app_docker_options only clears declared phases" {
    local tmpfile="${MOCK_DIR}/single_phase.yml"
    cat > "$tmpfile" <<'EOF'
apps:
  myapp:
    docker_options:
      deploy:
        - "--shm-size 128m"
EOF
    DOKKU_COMPOSE_FILE="$tmpfile"
    ensure_app_docker_options "myapp"
    assert_dokku_called "docker-options:clear myapp deploy"
    refute_dokku_called "docker-options:clear myapp build"
    refute_dokku_called "docker-options:clear myapp run"
}
