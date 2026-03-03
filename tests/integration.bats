#!/usr/bin/env bash

setup() {
    load 'test_helper'
    setup_mocks

    # Source all modules
    for module in apps domains network plugins services proxy ports certs storage nginx checks logs registry scheduler config builder docker_options dokku; do
        source "${PROJECT_ROOT}/lib/${module}.sh"
    done

    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/full.yml"
}

teardown() {
    teardown_mocks
}

@test "full up: creates all networks" {
    mock_dokku_exit "network:exists studio-net" 1
    mock_dokku_exit "network:exists qultr-net" 1
    ensure_networks
    assert_dokku_called "network:create studio-net"
    assert_dokku_called "network:create qultr-net"
}

@test "full up: configures app with all features" {
    local app="funqtion"

    # Mock everything as not existing
    mock_dokku_exit "apps:exists $app" 1
    # All services need creating
    mock_dokku_exit "postgres:exists funqtion-postgres" 1
    mock_dokku_exit "redis:exists funqtion-redis" 1
    mock_dokku_exit "postgres:exists studio-postgres" 1
    mock_dokku_exit "redis:exists studio-redis" 1
    mock_dokku_exit "postgres:exists qultr-postgres" 1
    mock_dokku_exit "redis:exists qultr-redis" 1
    # Funqtion's links not yet linked
    mock_dokku_exit "postgres:linked funqtion-postgres $app" 1
    mock_dokku_exit "redis:linked funqtion-redis $app" 1
    # Other services not linked to funqtion (for unlink check)
    mock_dokku_exit "postgres:linked studio-postgres $app" 1
    mock_dokku_exit "redis:linked studio-redis $app" 1
    mock_dokku_exit "postgres:linked qultr-postgres $app" 1
    mock_dokku_exit "redis:linked qultr-redis $app" 1
    mock_dokku_output "ports:report $app --ports-map" ""
    # Storage: no mounts yet
    mock_dokku_output "storage:report funqtion --storage-mounts" ""

    # Run all ensure functions (same order as configure_app in bin/dokku-compose)
    ensure_services
    ensure_app "$app"
    ensure_app_domains "$app"
    ensure_app_links "$app"
    ensure_app_scripts "$app"
    ensure_app_networks "$app"
    ensure_app_proxy "$app"
    ensure_app_ports "$app"
    ensure_app_certs "$app"
    ensure_app_storage "$app"
    ensure_app_nginx "$app"
    ensure_app_checks "$app"
    ensure_app_logs "$app"
    ensure_app_registry "$app"
    ensure_app_scheduler "$app"
    ensure_app_config "$app"
    ensure_app_builder "$app"
    ensure_app_docker_options "$app"

    # Verify key commands were called
    assert_dokku_called "apps:create funqtion"
    assert_dokku_called "domains:enable funqtion"
    assert_dokku_called "domains:set funqtion funqtion.example.com api.funqtion.co"
    assert_dokku_called "postgres:create funqtion-postgres -I 17-3.5 -i postgis/postgis"
    assert_dokku_called "postgres:link funqtion-postgres funqtion --no-restart"
    assert_dokku_called "redis:create funqtion-redis -I 7.2-alpine"
    assert_dokku_called "redis:link funqtion-redis funqtion --no-restart"
    assert_dokku_called "ports:set funqtion https:4001:4000"
    assert_dokku_called "storage:mount funqtion /var/lib/dokku/data/storage/funqtion/uploads:/app/uploads"
    assert_dokku_called "checks:set funqtion wait-to-retire 60"
    assert_dokku_called "checks:set funqtion attempts 5"
    assert_dokku_called "registry:set funqtion push-on-release true"
    assert_dokku_called "registry:set funqtion server registry.example.com"
    assert_dokku_called "config:set --no-restart funqtion"
    assert_dokku_called "builder-dockerfile:set funqtion dockerfile-path docker/prod/api/Dockerfile"
    assert_dokku_called "app-json:set funqtion appjson-path docker/prod/api/app.json"
    assert_dokku_called "builder:set funqtion build-dir apps/funqtion-api"
}

@test "full up: idempotent when everything exists" {
    local app="studio"

    # Mock everything as already existing/configured
    mock_dokku_exit "apps:exists $app" 0
    mock_dokku_exit "postgres:linked ${app}-postgres $app" 0
    mock_dokku_exit "redis:linked ${app}-redis $app" 0
    # Other services not linked to studio (for unlink check)
    mock_dokku_exit "postgres:linked funqtion-postgres $app" 1
    mock_dokku_exit "redis:linked funqtion-redis $app" 1
    mock_dokku_exit "postgres:linked qultr-postgres $app" 1
    mock_dokku_exit "redis:linked qultr-redis $app" 1
    mock_dokku_output "ports:report $app --ports-map" "https:4002:4000"

    ensure_app "$app"
    ensure_app_links "$app"
    ensure_app_ports "$app"

    # Should NOT have created/linked anything
    refute_dokku_called "apps:create"
    refute_dokku_called "postgres:link"
    refute_dokku_called "redis:link"
    refute_dokku_called "ports:set"
}

@test "simple config: minimal app setup" {
    DOKKU_COMPOSE_FILE="${PROJECT_ROOT}/tests/fixtures/simple.yml"

    mock_dokku_exit "apps:exists myapp" 1
    mock_dokku_exit "postgres:exists myapp-postgres" 1
    mock_dokku_exit "postgres:linked myapp-postgres myapp" 1
    mock_dokku_output "ports:report myapp --ports-map" ""

    ensure_services
    ensure_app "myapp"
    ensure_app_links "myapp"
    ensure_app_ports "myapp"

    # Verify services created, app created, linked, ports set

    assert_dokku_called "apps:create myapp"
    assert_dokku_called "postgres:create myapp-postgres"
    assert_dokku_called "postgres:link myapp-postgres myapp --no-restart"
    assert_dokku_called "ports:set myapp http:5000:5000"
}
