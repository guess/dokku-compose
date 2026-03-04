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

ensure_app_network() {
    local app="$1"

    yaml_app_has "$app" ".network" || return 0

    local val

    # attach_post_create: list = set; false = clear; absent = no action
    val=$(yq eval ".apps.${app}.network.attach_post_create" "$DOKKU_COMPOSE_FILE" 2>/dev/null)
    if [[ "$val" == "false" ]]; then
        log_action "$app" "Clearing attach-post-create"
        dokku_cmd network:set "$app" attach-post-create
        log_done
    elif [[ -n "$val" && "$val" != "null" ]]; then
        local net_list=""
        while IFS= read -r net; do
            [[ -z "$net" ]] && continue
            net_list="${net_list:+$net_list }$net"
        done <<< "$(yq eval ".apps.${app}.network.attach_post_create[]" "$DOKKU_COMPOSE_FILE" 2>/dev/null)"
        log_action "$app" "Setting attach-post-create: $net_list"
        dokku_cmd network:set "$app" attach-post-create "$net_list"
        log_done
    fi

    # initial_network: string = set; false = clear; absent = no action
    val=$(yq eval ".apps.${app}.network.initial_network" "$DOKKU_COMPOSE_FILE" 2>/dev/null)
    if [[ "$val" == "false" ]]; then
        log_action "$app" "Clearing initial-network"
        dokku_cmd network:set "$app" initial-network
        log_done
    elif [[ -n "$val" && "$val" != "null" ]]; then
        log_action "$app" "Setting initial-network: $val"
        dokku_cmd network:set "$app" initial-network "$val"
        log_done
    fi

    # bind_all_interfaces: true/false = set; absent = no action
    val=$(yq eval ".apps.${app}.network.bind_all_interfaces" "$DOKKU_COMPOSE_FILE" 2>/dev/null)
    if [[ "$val" == "true" ]]; then
        log_action "$app" "Setting bind-all-interfaces: true"
        dokku_cmd network:set "$app" bind-all-interfaces true
        log_done
    elif [[ "$val" == "false" ]]; then
        log_action "$app" "Setting bind-all-interfaces: false"
        dokku_cmd network:set "$app" bind-all-interfaces false
        log_done
    fi

    # tld: string = set; false = clear; absent = no action
    val=$(yq eval ".apps.${app}.network.tld" "$DOKKU_COMPOSE_FILE" 2>/dev/null)
    if [[ "$val" == "false" ]]; then
        log_action "$app" "Clearing tld"
        dokku_cmd network:set "$app" tld
        log_done
    elif [[ -n "$val" && "$val" != "null" ]]; then
        log_action "$app" "Setting tld: $val"
        dokku_cmd network:set "$app" tld "$val"
        log_done
    fi
}

destroy_app_network() {
    local app="$1"

    # Clear attach-post-deploy if networks: list was declared
    if yaml_app_has "$app" ".networks"; then
        log_action "$app" "Clearing attach-post-deploy"
        dokku_cmd network:set "$app" attach-post-deploy
        log_done
    fi

    yaml_app_has "$app" ".network" || return 0

    local val

    val=$(yq eval ".apps.${app}.network.attach_post_create" "$DOKKU_COMPOSE_FILE" 2>/dev/null)
    if [[ -n "$val" && "$val" != "null" ]]; then
        log_action "$app" "Clearing attach-post-create"
        dokku_cmd network:set "$app" attach-post-create
        log_done
    fi

    val=$(yq eval ".apps.${app}.network.initial_network" "$DOKKU_COMPOSE_FILE" 2>/dev/null)
    if [[ -n "$val" && "$val" != "null" ]]; then
        log_action "$app" "Clearing initial-network"
        dokku_cmd network:set "$app" initial-network
        log_done
    fi

    val=$(yq eval ".apps.${app}.network.bind_all_interfaces" "$DOKKU_COMPOSE_FILE" 2>/dev/null)
    if [[ "$val" == "true" || "$val" == "false" ]]; then
        log_action "$app" "Clearing bind-all-interfaces"
        dokku_cmd network:set "$app" bind-all-interfaces
        log_done
    fi

    val=$(yq eval ".apps.${app}.network.tld" "$DOKKU_COMPOSE_FILE" 2>/dev/null)
    if [[ -n "$val" && "$val" != "null" ]]; then
        log_action "$app" "Clearing tld"
        dokku_cmd network:set "$app" tld
        log_done
    fi
}

destroy_networks() {
    local networks
    networks=$(yaml_list '.networks[]')
    [[ -z "$networks" ]] && return 0

    while IFS= read -r net; do
        [[ -z "$net" ]] && continue

        if dokku_cmd_check network:exists "$net"; then
            log_action "networks" "Destroying $net"
            dokku_cmd network:destroy "$net"
            log_done
        else
            log_action "networks" "Destroying $net"
            log_skip
        fi
    done <<< "$networks"
}
