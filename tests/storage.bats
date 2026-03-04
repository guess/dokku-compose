#!/usr/bin/env bash

setup() {
    load 'test_helper'
    setup_mocks
    source "${PROJECT_ROOT}/lib/storage.sh"
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/full.yml"
}

teardown() {
    teardown_mocks
}

@test "ensure_app_storage mounts declared volumes" {
    mock_dokku_output "storage:report funqtion --storage-mounts" ""
    ensure_app_storage "funqtion"
    assert_dokku_called "storage:mount funqtion /var/lib/dokku/data/storage/funqtion/uploads:/app/uploads"
    refute_dokku_called "storage:unmount"
}

@test "ensure_app_storage skips already mounted volumes" {
    mock_dokku_output "storage:report funqtion --storage-mounts" "/var/lib/dokku/data/storage/funqtion/uploads:/app/uploads"
    ensure_app_storage "funqtion"
    refute_dokku_called "storage:mount"
    refute_dokku_called "storage:unmount"
}

@test "ensure_app_storage unmounts stale mounts and mounts new" {
    mock_dokku_output "storage:report funqtion --storage-mounts" "/var/lib/dokku/data/storage/funqtion/old:/app/old"
    ensure_app_storage "funqtion"
    assert_dokku_called "storage:unmount funqtion /var/lib/dokku/data/storage/funqtion/old:/app/old"
    assert_dokku_called "storage:mount funqtion /var/lib/dokku/data/storage/funqtion/uploads:/app/uploads"
}

@test "ensure_app_storage unmounts stale while keeping existing" {
    mock_dokku_output "storage:report funqtion --storage-mounts" "/var/lib/dokku/data/storage/funqtion/uploads:/app/uploads\n/var/lib/dokku/data/storage/funqtion/old:/app/old"
    ensure_app_storage "funqtion"
    assert_dokku_called "storage:unmount funqtion /var/lib/dokku/data/storage/funqtion/old:/app/old"
    refute_dokku_called "storage:mount"
}

@test "ensure_app_storage skips when no storage configured" {
    ensure_app_storage "studio"
    refute_dokku_called "storage:mount"
    refute_dokku_called "storage:unmount"
}

@test "destroy_app_storage unmounts all declared volumes" {
    destroy_app_storage "funqtion"
    assert_dokku_called "storage:unmount funqtion /var/lib/dokku/data/storage/funqtion/uploads:/app/uploads"
}
