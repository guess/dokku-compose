# lib/apps.sh — Application management
# Dokku docs: https://dokku.com/docs/deployment/application-management/
# Commands: apps:*

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

destroy_app() {
    local app="$1"

    if ! dokku_cmd_check apps:exists "$app"; then
        log_action "$app" "Destroying app"
        log_skip
        return 0
    fi

    log_action "$app" "Destroying app"
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
