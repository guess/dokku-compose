# Installation

## Install Latest

```bash
curl -fsSL https://github.com/guess/dokku-compose/releases/latest/download/dokku-compose \
  | sudo install /dev/stdin /usr/local/bin/dokku-compose
```

## Install a Specific Version

```bash
VERSION=0.2.0
curl -fsSL "https://github.com/guess/dokku-compose/releases/download/v${VERSION}/dokku-compose" \
  | sudo install /dev/stdin /usr/local/bin/dokku-compose
```

## Requirements

| Dependency | Version | Notes |
|------------|---------|-------|
| Bash | >= 4.0 | Ships with most Linux distros |
| [yq](https://github.com/mikefarah/yq) | >= 4.0 | Auto-installed on servers if running as root |
| [Dokku](https://dokku.com) | any | Local or remote via `DOKKU_HOST` |

## Execution Modes

```bash
# Run locally on the Dokku server
dokku-compose up

# Run remotely over SSH
DOKKU_HOST=my-server.example.com dokku-compose up
```

When `DOKKU_HOST` is set, all Dokku commands are sent over SSH. This is the typical workflow — you keep `dokku-compose.yml` in your project repo and apply it from your local machine. SSH key access to the Dokku server is required.

## Fresh Server Setup

Use `dokku-compose setup` to install Dokku at the declared version on a fresh Ubuntu/Debian server. It only handles fresh installs — if Dokku is already installed at a different version, it will print an upgrade link and exit. Requires root.
