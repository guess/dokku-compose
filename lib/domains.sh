# lib/domains.sh — Domain configuration
# Dokku docs: https://dokku.com/docs/configuration/domains/
# Commands: domains:*

#!/usr/bin/env bash
# Dokku domain configuration

ensure_app_domains() {
    local app="$1"

    yaml_app_key_exists "$app" "domains" || return 0

    local raw
    raw=$(yq eval ".apps.${app}.domains" "$DOKKU_COMPOSE_FILE")

    if [[ "$raw" == "false" ]]; then
        log_action "$app" "Disabling vhosts"
        dokku_cmd domains:disable "$app"
        dokku_cmd domains:clear "$app"
        log_done
        return 0
    fi

    local items=()
    while IFS= read -r domain; do
        [[ -z "$domain" ]] && continue
        items+=("$domain")
    done <<< "$(yaml_app_list "$app" ".domains[]")"

    [[ ${#items[@]} -eq 0 ]] && return 0

    log_action "$app" "Setting domains: ${items[*]}"
    dokku_cmd domains:enable "$app"
    dokku_cmd domains:set "$app" "${items[@]}"
    log_done
}

destroy_app_domains() {
    local app="$1"
    log_action "$app" "Clearing domains"
    dokku_cmd domains:clear "$app"
    log_done
}

ensure_global_domains() {
    yaml_has ".domains" || return 0

    local raw
    raw=$(yq eval ".domains" "$DOKKU_COMPOSE_FILE")

    if [[ "$raw" == "false" ]]; then
        log_action "global" "Disabling global domains"
        dokku_cmd domains:disable --all
        dokku_cmd domains:clear-global
        log_done
        return 0
    fi

    local items=()
    while IFS= read -r domain; do
        [[ -z "$domain" ]] && continue
        items+=("$domain")
    done <<< "$(yaml_list ".domains[]")"

    [[ ${#items[@]} -eq 0 ]] && return 0

    log_action "global" "Setting global domains: ${items[*]}"
    dokku_cmd domains:enable --all
    dokku_cmd domains:set-global "${items[@]}"
    log_done
}
