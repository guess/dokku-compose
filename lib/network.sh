# lib/network.sh — Docker network creation and app attachment
# Dokku docs: https://dokku.com/docs/networking/network/
# Commands: network:*

#!/usr/bin/env bash
# Dokku network management

ensure_networks() {
    local networks
    networks=$(yaml_list '.networks[]')
    [[ -z "$networks" ]] && return 0

    while IFS= read -r net; do
        [[ -z "$net" ]] && continue

        if dokku_cmd_check network:exists "$net"; then
            log_action "networks" "Creating $net"
            log_skip
        else
            log_action "networks" "Creating $net"
            dokku_cmd network:create "$net"
            log_done
        fi
    done <<< "$networks"
}

ensure_app_networks() {
    local app="$1"

    if ! yaml_app_has "$app" ".networks"; then
        return 0
    fi

    local networks
    networks=$(yaml_app_list "$app" ".networks[]")
    [[ -z "$networks" ]] && return 0

    # Build space-separated network list for attach-post-deploy
    local net_list=""
    while IFS= read -r net; do
        [[ -z "$net" ]] && continue
        if [[ -n "$net_list" ]]; then
            net_list="${net_list} ${net}"
        else
            net_list="$net"
        fi
    done <<< "$networks"

    log_action "$app" "Attaching to networks: $net_list"
    dokku_cmd network:set "$app" attach-post-deploy "$net_list"
    log_done
}
