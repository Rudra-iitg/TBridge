# Security Model

T-Bridge exposes remote shell access, so security is part of the core product,
not an optional hardening pass.

## Core Security Principles

- No remote shell without host-side approval.
- No unattended access in the MVP.
- The backend never executes commands.
- The backend should not store terminal input or output.
- Every device has its own identity and can be revoked.
- Pairing codes are short-lived and single-use.
- Session state is visible to both users.
- Either user can terminate a session immediately.

## Identity

Each installation creates a device keypair.

```text
user
└── device
    ├── device id
    ├── public key
    ├── local private key
    └── display name/platform metadata
```

Local secret storage should use the OS credential store when possible:

- macOS: Keychain
- Windows: Credential Manager
- Linux: Secret Service/libsecret
- Fallback: encrypted local file with a clear warning

The Phase 5 prototype stores identity locally at:

```text
~/.tbridge/identity.json
```

This includes private key material for the local prototype. Production should
move private keys into the OS credential store.

## Pairing

`tbridge share` creates a short-lived code, for example:

```text
842-193
```

Pairing code rules:

- Expires quickly, such as 5 minutes.
- Single-use.
- Rate-limited by user, device, and IP.
- Bound to the host device that created it.
- Does not grant access by itself; the host still approves.

## Permissions

Local policy belongs to the host machine.

The Phase 4 prototype stores this local policy at:

```text
~/.tbridge/policy.json
```

```json
{
  "defaultPolicy": "ask",
  "trustedUsers": {
    "user_123": {
      "access": "interactive",
      "requireApproval": false,
      "expiresAt": null
    }
  },
  "blockedUsers": ["user_456"]
}
```

Supported access modes:

- `ask`: always ask before access.
- `trusted`: allow future access while the host is actively sharing.
- `blocked`: reject immediately.

Future capability modes:

- View-only terminal.
- Interactive terminal.
- Command-by-command approval.
- Clipboard sharing.
- File transfer.

## Dangerous Command Filtering

Command filters can catch obvious mistakes but cannot be treated as a complete
sandbox. A user with shell access can bypass naive string filters.

The MVP should rely on:

- explicit host approval
- no unattended access
- visible active session
- local OS account permissions
- quick revocation
- metadata audit trail

Dangerous command warnings can be added later as a UX safety layer.

## Encryption

MVP transport can start with TLS-protected WebSockets.

Production should add end-to-end encryption so the relay cannot read terminal
payloads. A suitable design is:

- device keypair for identity
- ephemeral session keys per connection
- signed handshake
- encrypted PTY messages
- replay protection

Candidate libraries/protocols:

- libsodium
- Noise Protocol
- WebCrypto where runtime support is adequate

## Audit Metadata

Store:

- session ID
- host user/device
- guest user/device
- approval decision
- start and end time
- termination reason
- coarse network metadata for abuse prevention if needed

Do not store:

- command text
- terminal output
- passwords
- environment variables
- private keys

## Kill Switches

The host CLI must support:

- terminate current session
- pause input
- revoke a user
- revoke current device
- disable sharing

Recommended shortcuts:

```text
Ctrl+]  detach/terminate guest session
Ctrl+T  toggle local/remote mode on guest
Ctrl+C  send interrupt to active terminal
```

Shortcut behavior must be clear in the CLI UI, especially when the guest is in
remote mode.
