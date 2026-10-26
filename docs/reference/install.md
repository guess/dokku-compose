# Installation

## Install

```bash
npm install -g dokku-compose
```

## Install a Specific Version

```bash
npm install -g dokku-compose@<version>   # e.g. dokku-compose@0.14.2
```

## Requirements

| Dependency | Version | Notes |
|------------|---------|-------|
| [Node.js](https://nodejs.org) | >= 20 | Runs dokku-compose |
| [Dokku](https://dokku.com) | >= 0.38.32 | On the server; every server command stops on an older one |
| SSH | | Key access to the Dokku server when `DOKKU_HOST` is set |

dokku-compose never installs or upgrades Dokku. See [dokku](dokku.md).

## Execution Modes

```bash
# Run locally on the Dokku server
dokku-compose up

# Run remotely over SSH
DOKKU_HOST=my-server.example.com dokku-compose up
```

When `DOKKU_HOST` is set, all Dokku commands are sent over SSH as `dokku@<host>`. This is the typical workflow: you keep `dokku-compose.yml` in your project repo and apply it from your local machine. SSH key access to the Dokku server is required.

## Fresh Server

dokku-compose has no command to install Dokku. Install Dokku with its own [installation guide](https://dokku.com/docs/getting-started/installation/), then run `dokku-compose up`.
