# lib/certs.sh — SSL certificate management
# Dokku docs: https://dokku.com/docs/configuration/ssl/
# Commands: certs:*

#!/usr/bin/env bash
# Dokku SSL certificate management

ensure_app_certs() {
    local app="$1"

    yaml_app_key_exists "$app" "ssl" || return 0

    local raw
    raw=$(yq eval ".apps.${app}.ssl" "$DOKKU_COMPOSE_FILE")

    # ssl: false — remove certificate if currently enabled
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

    # ssl: {certfile: ..., keyfile: ...} — add certificate if not already enabled
    local ssl_enabled
    ssl_enabled=$(dokku_cmd certs:report "$app" --ssl-enabled 2>/dev/null || true)
    if [[ "$ssl_enabled" == "true" ]]; then
        log_action "$app" "SSL certificate"
        log_skip
        return 0
    fi

    local cert_file key_file
    cert_file=$(yq eval ".apps.${app}.ssl.certfile" "$DOKKU_COMPOSE_FILE")
    key_file=$(yq eval ".apps.${app}.ssl.keyfile" "$DOKKU_COMPOSE_FILE")

    if [[ "$cert_file" == "null" || "$key_file" == "null" ]]; then
        log_error "$app" "SSL config requires both certfile and keyfile"
        return 0
    fi

    if [[ ! -f "$cert_file" || ! -f "$key_file" ]]; then
        if [[ "$DOKKU_COMPOSE_DRY_RUN" == "true" ]]; then
            log_action "$app" "Adding SSL certificate"
            echo "[dry-run] dokku certs:add $app < tar($cert_file, $key_file)"
            log_done
            return 0
        fi
        log_error "$app" "SSL cert files not found: certfile=$cert_file keyfile=$key_file"
        return 0
    fi

    local tmpdir
    tmpdir=$(mktemp -d)
    cp "$cert_file" "$tmpdir/server.crt"
    cp "$key_file" "$tmpdir/server.key"

    log_action "$app" "Adding SSL certificate"
    tar cf - -C "$tmpdir" server.crt server.key | dokku_cmd certs:add "$app"
    log_done

    rm -rf "$tmpdir"
}

destroy_app_certs() {
    local app="$1"
    log_action "$app" "Removing SSL certificate"
    dokku_cmd certs:remove "$app"
    log_done
}
