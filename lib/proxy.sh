# lib/proxy.sh — Proxy management
# Dokku docs: https://dokku.com/docs/networking/proxy-management/
# Commands: proxy:*

#!/usr/bin/env bash
# Dokku proxy management

ensure_app_proxy() {
    local app="$1"

    yaml_app_key_exists "$app" "proxy" || return 0

    local raw
    raw=$(yq eval ".apps.${app}.proxy" "$DOKKU_COMPOSE_FILE")

    # Shorthand: proxy: false → disable
    if [[ "$raw" == "false" ]]; then
        _ensure_proxy_enabled "$app" "false"
        return 0
    fi

    # Shorthand: proxy: true → enable
    if [[ "$raw" == "true" ]]; then
        _ensure_proxy_enabled "$app" "true"
        return 0
    fi

    # Map form: process enabled and type sub-keys
    local enabled_raw
    enabled_raw=$(yq eval ".apps.${app}.proxy.enabled" "$DOKKU_COMPOSE_FILE" 2>/dev/null)

    if [[ "$enabled_raw" == "true" || "$enabled_raw" == "false" ]]; then
        _ensure_proxy_enabled "$app" "$enabled_raw"
    fi

    local type_raw
    type_raw=$(yq eval ".apps.${app}.proxy.type" "$DOKKU_COMPOSE_FILE" 2>/dev/null)

    if [[ -n "$type_raw" && "$type_raw" != "null" ]]; then
        _ensure_proxy_type "$app" "$type_raw"
    fi
}

_ensure_proxy_enabled() {
    local app="$1" desired="$2"

    local current
    current=$(dokku_cmd proxy:report "$app" --proxy-enabled 2>/dev/null || true)

    if [[ "$desired" == "true" ]]; then
        if [[ "$current" == "true" ]]; then
            log_action "$app" "Proxy enabled"
            log_skip
        else
            log_action "$app" "Enabling proxy"
            dokku_cmd proxy:enable "$app"
            log_done
        fi
    elif [[ "$desired" == "false" ]]; then
        if [[ "$current" == "false" ]]; then
            log_action "$app" "Proxy disabled"
            log_skip
        else
            log_action "$app" "Disabling proxy"
            dokku_cmd proxy:disable "$app"
            log_done
        fi
    fi
}

_ensure_proxy_type() {
    local app="$1" desired="$2"

    local current
    current=$(dokku_cmd proxy:report "$app" --proxy-type 2>/dev/null || true)

    if [[ "$current" == "$desired" ]]; then
        log_action "$app" "Proxy type: $desired"
        log_skip
    else
        log_action "$app" "Setting proxy type: $desired"
        dokku_cmd proxy:set "$app" "$desired"
        log_done
    fi
}
