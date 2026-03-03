#!/usr/bin/env bash
# Dokku Redis service management (plugin)

ensure_app_redis() {
    local app="$1"

    if ! yaml_app_has "$app" ".redis"; then
        return 0
    fi

    local service="${app}-redis"
    local redis_config
    redis_config=$(yaml_app_get "$app" ".redis")

    # Build create flags
    local create_flags=()
    if [[ "$redis_config" != "true" ]]; then
        local version
        version=$(yaml_app_get "$app" ".redis.version")
        [[ -n "$version" ]] && create_flags+=(-I "$version")
    fi

    # Create service if needed
    if ! dokku_cmd_check redis:exists "$service"; then
        log_action "$app" "Creating redis${create_flags[*]:+ (${create_flags[*]})}"
        dokku_cmd redis:create "$service" "${create_flags[@]}"
        log_done
    else
        log_action "$app" "Redis service"
        log_skip
    fi

    # Link if not already linked
    if ! dokku_cmd_check redis:linked "$service" "$app"; then
        log_action "$app" "Linking redis"
        dokku_cmd redis:link "$service" "$app" --no-restart
        log_done
    else
        log_action "$app" "Redis link"
        log_skip
    fi
}

destroy_app_redis() {
    local app="$1"
    local service="${app}-redis"

    if ! dokku_cmd_check redis:exists "$service"; then
        return 0
    fi

    if dokku_cmd_check redis:linked "$service" "$app"; then
        log_action "$app" "Unlinking redis"
        dokku_cmd redis:unlink "$service" "$app" --no-restart
        log_done
    fi

    log_action "$app" "Destroying redis"
    dokku_cmd redis:destroy "$service" --force
    log_done
}
