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

## Proposed Commands

```bash
tbridge login
tbridge share
tbridge connect <code-or-user-id>
tbridge allow <user-id>
tbridge deny <user-id>
tbridge sessions
tbridge revoke <session-id>
```

## Initial Principle

The server coordinates, authenticates, and relays encrypted messages. It must
not execute shell commands and should not store terminal input or output.

Terminal traffic must stream continuously. When the host terminal starts
producing output, the guest should see chunks immediately instead of waiting for
the command to finish.
