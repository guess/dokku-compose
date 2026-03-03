#!/usr/bin/env bash
# Dokku application management

ensure_app() {
    local app="$1"

    if dokku_cmd_check apps:exists "$app"; then
        log_action "$app" "Creating app"
        log_skip
        return 0
    fi

    log_action "$app" "Creating app"
    dokku_cmd apps:create "$app"
    log_done
}

ensure_vhosts_disabled() {
    local app="$1"
    dokku_cmd domains:disable "$app" >/dev/null 2>&1 || true
}

destroy_app() {
    local app="$1"

    if ! dokku_cmd_check apps:exists "$app"; then
        log_action "$app" "Destroying app"
        log_skip
        return 0
    fi

    log_action "$app" "Destroying app"

    # Unlink services before destroying
    if type destroy_app_postgres &>/dev/null; then
        destroy_app_postgres "$app"
    fi
    if type destroy_app_redis &>/dev/null; then
        destroy_app_redis "$app"
    fi

    dokku_cmd apps:destroy "$app" --force
    log_done
}

show_app_status() {
    local app="$1"

    if ! dokku_cmd_check apps:exists "$app"; then
        printf "%-20s %s\n" "$app" "not created"
        return 0
    fi

    local status
    status=$(dokku_cmd ps:report "$app" --status-message 2>/dev/null || echo "unknown")
    printf "%-20s %s\n" "$app" "$status"
}
