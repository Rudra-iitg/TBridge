# Architecture

T-Bridge is a remote PTY sharing tool. The product should feel like terminal
AnyDesk: a user can grant another user access to an interactive terminal, while
both sides keep clear session visibility and revocation controls.

## Goals

- Interactive remote terminal access with low latency.
- Continuous input/output streaming; never wait for command completion before
  returning output.
- Explicit approval before a host shell is exposed.
- Strong separation between coordination server and command execution.
- Shared protocol types across CLI and backend.
- A path from simple WebSocket relay MVP to lower-latency peer-to-peer transport.

## Non-Goals For MVP

- Unattended permanent access.
- File transfer.
- Browser dashboard.
- Command/output recording.
- WebRTC or QUIC transport as the first implementation.
- Enterprise team management.

## System Overview

```text
┌────────────────────┐
│ Guest CLI          │
│ tbridge connect    │
└─────────┬──────────┘
          │ WebSocket relay, E2EE payloads later
┌─────────▼──────────┐
│ Coordination Server│
│ auth, pairing, ACL │
│ presence, relay    │
└─────────▲──────────┘
          │
┌─────────┴──────────┐
│ Host CLI           │
│ tbridge share      │
│ PTY executor       │
└────────────────────┘
```

The host CLI owns shell execution. The server only routes session messages and
stores session metadata.

## Language And Stack

The MVP will use TypeScript for both CLI and backend.

- CLI runtime: Node.js
- CLI framework: Commander or Clipanion
- Terminal/PTY: `node-pty`
- Terminal rendering: raw TTY first, richer TUI later if needed
- Backend: Fastify
- Realtime transport: WebSocket
- Database: PostgreSQL
- Presence and session routing: Redis
- Validation: Zod
- Package manager: pnpm
- Monorepo: pnpm workspaces

TypeScript is chosen for the MVP because it allows fast iteration, shared
protocol types, and a strong networking/terminal ecosystem. Rust or Go may
become good candidates for a production CLI or relay once the protocol and UX
are proven.

## Repository Layout

```text
t-bridge/
├── apps/
│   ├── cli/
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── commands/
│   │   │   ├── auth/
│   │   │   ├── config/
│   │   │   ├── network/
│   │   │   ├── permissions/
│   │   │   └── terminal/
│   │   └── package.json
│   └── server/
│       ├── src/
│       │   ├── main.ts
│       │   ├── auth/
│       │   ├── database/
│       │   ├── pairing/
│       │   ├── permissions/
│       │   ├── relay/
│       │   └── observability/
│       └── package.json
├── packages/
│   ├── protocol/
│   ├── crypto/
│   └── shared/
├── docs/
├── graphify-out/
├── tests/
│   ├── e2e/
│   ├── protocol/
│   └── security/
├── infra/
├── package.json
└── pnpm-workspace.yaml
```

## CLI Responsibilities

- Create and store local device identity.
- Authenticate user and device.
- Connect to the relay server.
- Create share codes.
- Request remote access.
- Prompt host for approval.
- Spawn and manage host PTYs.
- Stream PTY input, output, resize, and control messages.
- Enforce local allow/deny policy.
- Show active session state.
- Provide detach, pause, terminate, and mode-switch shortcuts.

## Backend Responsibilities

- User authentication.
- Device registration.
- Short-lived pairing codes.
- Presence tracking.
- Permission checks before session creation.
- Session metadata and audit events.
- WebSocket relay routing.
- Rate limiting and abuse prevention.

The backend must not execute shell commands or store raw terminal traffic.

## Session Flow

```text
1. Host runs `tbridge share`.
2. Host CLI connects to server and creates a short-lived share code.
3. Guest runs `tbridge connect <code>`.
4. Server validates code and guest identity.
5. Server asks host CLI for approval.
6. Host accepts or rejects.
7. Server creates a relay room.
8. Host CLI starts a PTY.
9. Guest keystrokes stream to host PTY.
10. Host PTY output streams back to guest terminal as soon as chunks are
    produced.
11. Either side can pause, detach, or terminate.
```

## Relay Session Lifecycle

Local relay sessions currently use these states:

- `waiting`: host registered a code and is waiting for a guest.
- `pending`: guest requested access and host must approve or reject.
- `active`: host approved and PTY traffic can flow.
- `ended`: peer disconnected, code expired, or session was rejected/closed.

Share codes are short-lived. The relay consumes a code when the session becomes
active, so a later guest cannot reuse it.

## Protocol Events

```ts
export type TBridgeMessage =
  | { type: "PAIR_REQUEST"; code: string; requesterDeviceId: string }
  | { type: "PAIR_APPROVED"; sessionId: string }
  | { type: "PAIR_REJECTED"; reason: string }
  | { type: "PTY_START"; sessionId: string; shell: string; cols: number; rows: number }
  | { type: "PTY_INPUT"; sessionId: string; data: string }
  | { type: "PTY_OUTPUT"; sessionId: string; data: string }
  | { type: "PTY_RESIZE"; sessionId: string; cols: number; rows: number }
  | { type: "PTY_EXIT"; sessionId: string; code: number | null }
  | { type: "SESSION_PAUSE"; sessionId: string }
  | { type: "SESSION_RESUME"; sessionId: string }
  | { type: "SESSION_TERMINATE"; sessionId: string }
  | { type: "ERROR"; code: string; message: string };
```

JSON framing is acceptable for the first prototype. PTY payloads can move to
binary frames once the interaction model is stable.

## Continuous Streaming

T-Bridge must treat the remote terminal as a live stream, not as a request and
response command runner.

Required behavior:

- Guest keystrokes are forwarded to the host PTY immediately.
- Host PTY output is forwarded to the guest immediately as chunks arrive.
- Long-running commands stream progressively.
- Interactive programs work because stdin, stdout, stderr, resize, and control
  signals are all event streams.
- The guest does not wait for command exit before seeing output.

Example:

```bash
tbridge connect 842-193
remote$ find /usr -name "*.dylib"
```

If the host PTY starts producing thousands of lines, the guest should see those
lines continuously while the command is still running.

## Transport Strategy

MVP:

- Persistent WebSocket from each CLI to relay.
- Relay routes messages by session ID.
- Backpressure on both WebSocket and PTY streams.
- No command-level buffering.
- Small output batching window, around 5 to 10 ms, only if needed to reduce
  frame overhead without making output feel delayed.
- Flush output immediately for prompts, newline-heavy output, and interactive
  programs.

Stream path:

```text
guest keyboard -> guest CLI -> WebSocket -> relay -> WebSocket -> host CLI
-> host PTY -> host CLI -> WebSocket -> relay -> WebSocket -> guest CLI
-> guest terminal
```

Backpressure rules:

- If the guest terminal cannot render fast enough, slow remote output delivery.
- If the WebSocket send buffer grows too large, pause PTY reads when possible.
- If pausing is not possible, buffer with strict memory limits and terminate
  cleanly on overflow.
- Preserve byte order within each PTY stream.

Later:

- End-to-end encrypted payloads over relay.
- WebRTC DataChannel direct transport.
- WebSocket fallback when peer-to-peer fails.
- QUIC evaluation if WebRTC overhead or NAT behavior becomes a problem.

## Latency Target

- Good: under 100 ms round trip.
- Acceptable: under 200 ms.
- Noticeable: over 300 ms.
- Bad: over 500 ms.

The MVP should optimize for persistent connections and minimal server work
before introducing complex peer-to-peer networking.
