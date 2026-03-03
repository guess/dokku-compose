# lib/certs.sh — SSL certificate management
# Dokku docs: https://dokku.com/docs/configuration/ssl/
# Commands: certs:*

#!/usr/bin/env bash
# Dokku SSL certificate management

ensure_app_certs() {
    local app="$1"

    local cert_path
    cert_path=$(yaml_app_get "$app" ".certs")
    [[ -z "$cert_path" ]] && return 0

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
