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

ensure_app_locked() {
    local app="$1"

    yaml_app_key_exists "$app" "locked" || return 0

    local locked
    locked=$(yq eval ".apps.${app}.locked" "$DOKKU_COMPOSE_FILE")

    if [[ "$locked" == "true" ]]; then
        log_action "$app" "Locking app"
        dokku_cmd apps:lock "$app"
        log_done
    elif [[ "$locked" == "false" ]]; then
        log_action "$app" "Unlocking app"
        dokku_cmd apps:unlock "$app"
        log_done
    fi
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
