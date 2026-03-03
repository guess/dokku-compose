# lib/nginx.sh — Nginx proxy configuration
# Dokku docs: https://dokku.com/docs/networking/proxies/nginx/
# Commands: nginx:*

#!/usr/bin/env bash
# Dokku nginx proxy configuration

ensure_app_nginx() {
    dokku_set_properties "$1" "nginx"
}
