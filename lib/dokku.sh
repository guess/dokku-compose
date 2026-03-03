#!/usr/bin/env bash
# Dokku version management

ensure_dokku_version() {
    local desired
    desired=$(yaml_get '.dokku.version')
    [[ -z "$desired" ]] && return 0

    local current
    current=$(dokku_cmd version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || echo "unknown")

    if [[ "$current" != "$desired" ]]; then
        log_warn "dokku" "Version mismatch: running $current, config expects $desired"
    fi
}

install_dokku() {
    local desired
    desired=$(yaml_get '.dokku.version')

    if [[ -z "$desired" ]]; then
        echo "No dokku.version specified in config" >&2
        return 1
    fi

    if command -v dokku &>/dev/null; then
        local current
        current=$(dokku version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || echo "unknown")
        if [[ "$current" == "$desired" ]]; then
            echo "Dokku $desired is already installed"
            return 0
        fi
        echo "Dokku $current is installed, config expects $desired"
        echo "Upgrade manually: https://dokku.com/docs/getting-started/upgrading/"
        return 1
    fi

    echo "Installing Dokku $desired..."
    curl -fsSL "https://packagecloud.io/dokku/dokku/gpgkey" | gpg --dearmor -o /usr/share/keyrings/dokku-archive-keyring.gpg
    echo "deb [signed-by=/usr/share/keyrings/dokku-archive-keyring.gpg] https://packagecloud.io/dokku/dokku/ubuntu/ $(lsb_release -cs) main" | tee /etc/apt/sources.list.d/dokku.list
    apt-get update
    apt-get install -y "dokku=${desired}"
    echo "Dokku $desired installed"
}
