# T-Bridge

T-Bridge is a planned TypeScript CLI tool for secure remote terminal sharing.
It lets one user request access to another user's terminal, stream interactive
PTY input/output with approval, and enforce local permissions.

The first implementation target is a TypeScript monorepo with:

- a Node.js CLI
- a WebSocket relay backend
- a shared protocol package
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
- Phase 5: user login, device identity, and Postgres/Redis-backed metadata.
- Phase 6: hardening with end-to-end encryption, reconnects, rate limits, and
  deeper cross-platform testing.

## Proposed Commands

```bash
tbridge login
tbridge share
tbridge connect <code-or-user-id>
tbridge allow <user-id>
tbridge deny <user-id>
tbridge forget <user-id>
tbridge policy
tbridge sessions
tbridge revoke <session-id>
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

## Initial Principle

The server coordinates, authenticates, and relays encrypted messages. It must
not execute shell commands and should not store terminal input or output.

Terminal traffic must stream continuously. When the host terminal starts
producing output, the guest should see chunks immediately instead of waiting for
the command to finish.
