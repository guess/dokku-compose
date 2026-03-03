# lib/proxy.sh — Proxy management
# Dokku docs: https://dokku.com/docs/networking/proxy-management/
# Commands: proxy:*

#!/usr/bin/env bash
# Dokku proxy management

ensure_app_proxy() {
    local app="$1"

    yaml_app_has "$app" ".proxy" || return 0

    local enabled
    enabled=$(yq eval ".apps.${app}.proxy.enabled" "$DOKKU_COMPOSE_FILE")

    if [[ "$enabled" == "true" ]]; then
        log_action "$app" "Enabling proxy"
        dokku_cmd proxy:enable "$app"
        log_done
    elif [[ "$enabled" == "false" ]]; then
        log_action "$app" "Disabling proxy"
        dokku_cmd proxy:disable "$app"
        log_done
    fi
}
