#!/usr/bin/env bash
# Dokku PostgreSQL service management (plugin)

ensure_app_postgres() {
    local app="$1"

    if ! yaml_app_has "$app" ".postgres"; then
        return 0
    fi

    local service="${app}-db"
    local pg_config
    pg_config=$(yaml_app_get "$app" ".postgres")

    # Build create flags
    local create_flags=()
    if [[ "$pg_config" != "true" ]]; then
        local version image
        version=$(yaml_app_get "$app" ".postgres.version")
        image=$(yaml_app_get "$app" ".postgres.image")
        [[ -n "$version" ]] && create_flags+=(-I "$version")
        [[ -n "$image" ]] && create_flags+=(-i "$image")
    fi

    # Create service if needed
    if ! dokku_cmd_check postgres:exists "$service"; then
        log_action "$app" "Creating postgres${create_flags[*]:+ (${create_flags[*]})}"
        dokku_cmd postgres:create "$service" "${create_flags[@]}"
        log_done
    else
        log_action "$app" "Postgres service"
        log_skip
    fi

    # Link if not already linked
    if ! dokku_cmd_check postgres:linked "$service" "$app"; then
        log_action "$app" "Linking postgres"
        dokku_cmd postgres:link "$service" "$app" --no-restart
        log_done
    else
        log_action "$app" "Postgres link"
        log_skip
    fi
}

destroy_app_postgres() {
    local app="$1"
    local service="${app}-db"

    if ! dokku_cmd_check postgres:exists "$service"; then
        return 0
    fi

    # Unlink if linked
    if dokku_cmd_check postgres:linked "$service" "$app"; then
        log_action "$app" "Unlinking postgres"
        dokku_cmd postgres:unlink "$service" "$app" --no-restart
        log_done
    fi

    log_action "$app" "Destroying postgres"
    dokku_cmd postgres:destroy "$service" --force
    log_done
}
