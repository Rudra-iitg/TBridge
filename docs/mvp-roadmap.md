# MVP Roadmap

The MVP should prove that two users can safely share an interactive terminal
through a TypeScript relay with manual approval.

## Phase 0: Planning

- Confirm architecture.
- Confirm TypeScript monorepo stack.
- Confirm Graphify workflow.
- Define security constraints.
- Define MVP/non-MVP scope.

## Phase 1: Local PTY Prototype

Goal: prove terminal mechanics before network complexity.

Current command:

```bash
npm install
npm run dev:local
```

- Spawn a local PTY with `node-pty`.
- Render PTY output in the current terminal.
- Forward keyboard input to the PTY.
- Stream output chunk-by-chunk while commands are still running.
- Handle terminal resize.
- Handle Ctrl+C and process exit.

Success criteria:

- Interactive shell works locally.
- Long output appears progressively, not after process exit.
- Commands like `ls`, `top`, `node`, and `vim` behave acceptably.
- Terminal resize does not corrupt the session badly.

## Phase 2: Relay Prototype

Goal: connect two CLI processes over a local server.

Current commands:

```bash
npm run dev:relay
npm run dev:share
npm run dev:connect
```

- Create a local Node.js WebSocket relay server.
- Add session rooms.
- Add JSON protocol messages.
- Connect host CLI and guest CLI.
- Stream PTY input/output through the server.
- Avoid command-level buffering; relay PTY output chunks immediately.
- Require host approval before the guest receives the remote PTY.

Success criteria:

- Guest can type into host PTY.
- Host PTY output appears on guest terminal while commands are still running.
- Host can reject a pending local relay guest.
- Either side can terminate the session.

## Phase 3: Pairing And Approval

Goal: make connection flow resemble the real product.

Current implementation:

- Relay state is managed by a dedicated `SessionManager`.
- Share codes have a configurable TTL through `CODE_TTL_MS`.
- Sessions move through `waiting`, `pending`, `active`, and `ended` states.
- Approved codes are consumed so they cannot be reused.

- `tbridge share` creates short-lived code.
- `tbridge connect <code>` requests access.
- Host sees approval prompt.
- Approval creates a relay session.
- Rejection returns a clear guest error.

Success criteria:

- No shell starts before host approval.
- Expired or reused codes fail.
- Session lifecycle is visible in logs.
- Guest disconnect and host disconnect both cleanly notify the peer.

## Phase 4: Local Permissions

Goal: add basic trust controls.

Current implementation:

- Local policy is stored at `~/.tbridge/policy.json`.
- `tbridge allow <user-id>` marks a requester as trusted.
- `tbridge deny <user-id>` blocks a requester.
- `tbridge forget <user-id>` removes a local policy override.
- `tbridge policy` prints the local policy file.
- `tbridge connect <code> --user <id>` sends a temporary requester ID until
  Phase 5 adds real login/device identity.

- Add local policy file.
- Add `allow`, `deny`, and `sessions` commands.
- Add blocked-user rejection.
- Add trusted-user shortcut while host is actively sharing.

Success criteria:

- Blocked users cannot request a session.
- Trusted users can be approved according to policy.
- Policy changes are local and transparent.

## Phase 5: Auth And Devices

Goal: move from anonymous pairing to user/device identity.

- Add user login.
- Add device registration.
- Store device public key.
- Add device revocation.
- Bind sessions to user and device IDs.

Success criteria:

- Session records identify both users and devices.
- Revoked devices cannot connect.

## Phase 6: Hardening

Goal: prepare for serious dogfooding.

- End-to-end encrypted terminal payloads.
- Backpressure and reconnect behavior.
- Rate limiting.
- Safer local secret storage.
- Structured server logs.
- Focused protocol and security tests.

Success criteria:

- Relay cannot inspect terminal payloads.
- Abuse attempts are rate-limited.
- Common disconnects recover or fail cleanly.

## Deferred Features

- WebRTC direct peer-to-peer transport.
- QUIC transport.
- File transfer.
- Browser dashboard.
- Team management.
- Command-by-command approval mode.
- View-only mode.
- Windows-native shell polish.
