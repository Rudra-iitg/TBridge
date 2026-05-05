# T-Bridge

T-Bridge is a TypeScript CLI tool for secure remote terminal sharing.
It lets one user request access to another user's terminal, stream interactive
PTY input/output with approval, and enforce local permissions.

The implementation is a TypeScript monorepo with:

- a Node.js CLI
- a WebSocket relay backend
- a shared protocol package
- end-to-end encrypted terminal traffic
- explicit host approval for every remote terminal session
- Graphify-generated knowledge graph artifacts for architecture recall

## Planning Docs

- [Architecture](./docs/architecture.md)
- [Security model](./docs/security-model.md)
- [Graphify workflow](./docs/graphify.md)
- [MVP roadmap](./docs/mvp-roadmap.md)

## Phases

- Phase 0: planning, architecture, security boundaries, and Graphify workflow.
- Phase 1: local PTY prototype with live stdin/stdout streaming.
- Phase 2: local WebSocket relay connecting host and guest CLI processes.
- Phase 3: pairing codes, approval flow hardening, and session lifecycle.
- Phase 4: local permissions with allow/deny/trusted users.
- Phase 5: user login, device identity, and local keypair generation.
- Phase 6: hardening with end-to-end encryption, backpressure, rate limits,
  reconnect, structured logging, and security tests.

## Proposed Commands

```bash
tbridge login
tbridge identity
tbridge logout
tbridge share
tbridge connect <code-or-user-id>
tbridge allow <user-id>
tbridge deny <user-id>
tbridge forget <user-id>
tbridge policy
```

## Local Permissions

Phase 4 stores host-side allow/deny policy at:

```text
~/.tbridge/policy.json
```

For the current local relay prototype, requesters identify themselves with
`--user <id>`:

```bash
tbridge allow dev-guest
tbridge deny unknown-user
tbridge connect 123-456 --user dev-guest
```

`trusted` users are auto-approved while sharing is active. `blocked` users are
auto-rejected. Everyone else uses the manual approval prompt.

## Local Identity

Phase 5 creates a local device identity at `~/.tbridge/identity.json` with:

- user ID
- device ID and display name
- ed25519 public key
- private key (stored in OS keychain when available, file fallback with 0o600)

```bash
tbridge login --user alice --device-name work-laptop
tbridge identity
tbridge logout
```

## Local Relay Prototype

Start the relay:

```bash
npm run dev:relay
```

In another terminal, share a shell:

```bash
npm run dev:share
```

In a third terminal, connect as the guest:

```bash
npm run dev:connect
```

The host must approve before the guest receives a remote PTY. Output streams
continuously as the host shell produces it. Share codes are short-lived and are
consumed when a session becomes active.

## End-to-End Encryption (Phase 6)

After session approval, host and guest perform an X25519 key exchange through
the relay. All subsequent PTY traffic is encrypted with AES-256-GCM. The relay
only sees opaque `ENCRYPTED_DATA` messages — it cannot read terminal content.

## Rate Limiting (Phase 6)

The relay enforces per-IP sliding-window rate limits:

- 10 WebSocket connections per minute
- 5 host/guest registrations per minute
- 200 messages per second (PTY flood protection)

## Reconnect (Phase 6)

If a WebSocket drops during an active session, both peers attempt reconnect
with exponential backoff (1s/2s/4s). The server holds the session for a 30‑second
grace period before cleanup.

## Running Tests

```bash
npm test
```

Tests cover: protocol codec, session state machine, E2E crypto, rate limiter,
and identity store.

## Initial Principle

The server coordinates, authenticates, and relays encrypted messages. It must
not execute shell commands and should not store terminal input or output.

Terminal traffic must stream continuously. When the host terminal starts
producing output, the guest should see chunks immediately instead of waiting for
the command to finish.
