# SSH Connection Multiplexing Design

## Problem

Every `runner.check/query/run` call opens a fresh SSH connection via `execa('ssh', ...)`. A typical `up` run makes 40–60 sequential SSH connections, each paying the full handshake cost (~200–500ms). This makes commands feel very slow.

## Solution

Use SSH ControlMaster multiplexing. The first connection opens a master socket; all subsequent connections reuse it with near-zero overhead.

## Changes

### `src/core/dokku.ts`

When `opts.host` is set, prepend ControlMaster flags to every SSH invocation:

```
-o ControlMaster=auto
-o ControlPath=/tmp/dokku-compose-{host}.sock
-o ControlPersist=60
```

Add a `close()` method to the `Runner` interface that runs `ssh -O exit` on the control socket to clean it up when the command finishes.

### CLI entry point

Wrap each command in a `try/finally` that calls `runner.close()` so the socket is removed immediately rather than waiting for ControlPersist to expire.

## Scope

- Only `src/core/dokku.ts` and the CLI entry point need changes
- No module or command changes required
- Existing tests are unaffected (they mock the runner)

## Platform

macOS/Linux only (SSH ControlMaster is not supported on Windows).
