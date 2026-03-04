# lib/certs.sh — SSL certificate management
# Dokku docs: https://dokku.com/docs/configuration/ssl/
# Commands: certs:*

#!/usr/bin/env bash
# Dokku SSL certificate management

ensure_app_certs() {
    local app="$1"

    yaml_app_key_exists "$app" "certs" || return 0

    local raw
    raw=$(yq eval ".apps.${app}.certs" "$DOKKU_COMPOSE_FILE")

    # certs: false — remove certificate if currently enabled
    if [[ "$raw" == "false" ]]; then
        local ssl_enabled
        ssl_enabled=$(dokku_cmd certs:report "$app" --ssl-enabled 2>/dev/null || true)
        if [[ "$ssl_enabled" == "true" ]]; then
            log_action "$app" "Removing SSL certificate"
            dokku_cmd certs:remove "$app"
            log_done
        else
            log_action "$app" "SSL certificate"
            log_skip
        fi
        return 0
    fi

    # certs: "path/to/certs" — add certificate if not already enabled
    local cert_path="$raw"

    local ssl_enabled
    ssl_enabled=$(dokku_cmd certs:report "$app" --ssl-enabled 2>/dev/null || true)
    if [[ "$ssl_enabled" == "true" ]]; then
        log_action "$app" "SSL certificate"
        log_skip
        return 0
    fi

    local cert_file="${cert_path}/cert.crt"
    local key_file="${cert_path}/cert.key"

    if [[ ! -f "$cert_file" || ! -f "$key_file" ]]; then
        if [[ "$DOKKU_COMPOSE_DRY_RUN" == "true" ]]; then
            log_action "$app" "Adding SSL certificate from ${cert_path}"
            echo "[dry-run] dokku certs:add $app < ${cert_path}/{cert.crt,cert.key}"
            log_done
            return 0
        fi
        log_error "$app" "SSL cert files not found in: $cert_path (expected cert.crt and cert.key)"
        return 0
    fi

    log_action "$app" "Adding SSL certificate"
    tar cf - -C "$cert_path" cert.crt cert.key | dokku_cmd certs:add "$app"
    log_done
}

destroy_app_certs() {
    local app="$1"
    log_action "$app" "Removing SSL certificate"
    dokku_cmd certs:remove "$app"
    log_done
}
