/**
 * @tbridge/protocol v2 — Envelope-based wire protocol.
 *
 * Every message is wrapped in an Envelope with routing metadata,
 * versioning, and correlation IDs. Payloads are typed by `kind`.
 */

// ─── Domain Entities ─────────────────────────────────────────────

export type DeviceCapabilities = {
  shells: string[];
  canExecute: boolean;
  os: string;
  arch: string;
};

export type DeviceStatus = "online" | "offline" | "away";

export type DeviceInfo = {
  id: string;
  name: string;
  platform: string;
  owner: string;
  status: DeviceStatus;
  capabilities: DeviceCapabilities;
};

export type SessionStatus = "active" | "idle" | "exited";

export type SessionInfo = {
  id: string;
  deviceId: string;
  owner: string;
  shell: string;
  status: SessionStatus;
  title: string;
  cols: number;
  rows: number;
  createdAt: number;
};

export type PeerIdentity = {
  userId: string;
  deviceId: string;
  deviceName: string;
  publicKey: string;
};

export type PermissionMode = "safe" | "trusted";

// ─── Envelope ────────────────────────────────────────────────────

export type Destination =
  | { kind: "peer"; user: string; device: string }
  | { kind: "relay" }
  | { kind: "broadcast" };

export type Envelope = {
  v: 2;
  id: string;
  ts: number;
  from: { user: string; device: string };
  to: Destination;
  payload: Payload;
};

// ─── Payload Types ───────────────────────────────────────────────

export type Payload =
  // ── Connection lifecycle ───────────────────────────────────
  | { kind: "HELLO"; capabilities: DeviceCapabilities; publicKey: string }
  | { kind: "HELLO_ACK"; sessionCode: string }
  | { kind: "PAIR_REQUEST"; sessionCode: string; identity: PeerIdentity }
  | { kind: "PAIR_ACCEPT" }
  | { kind: "PAIR_REJECT"; reason: string }
  | { kind: "KEY_EXCHANGE"; ephemeralPublicKey: string }

  // ── Execution ──────────────────────────────────────────────
  | { kind: "EXEC_REQUEST"; sessionId: string; command?: string }
  | { kind: "EXEC_APPROVAL_REQUIRED"; sessionId: string; command: string; fromUser: string }
  | { kind: "EXEC_APPROVED"; sessionId: string }
  | { kind: "EXEC_REJECTED"; sessionId: string; reason: string }
  | { kind: "PTY_DATA"; sessionId: string; data: string }
  | { kind: "PTY_RESIZE"; sessionId: string; cols: number; rows: number }
  | { kind: "PTY_EXIT"; sessionId: string; code: number | null }

  // ── Session management ─────────────────────────────────────
  | { kind: "SESSION_LIST_REQUEST" }
  | { kind: "SESSION_LIST"; sessions: SessionInfo[] }
  | { kind: "SYNC_SESSIONS"; sessions: SessionInfo[] }
  | { kind: "SESSION_CREATE"; shell?: string; title?: string }
  | { kind: "SESSION_CREATED"; session: SessionInfo }
  | { kind: "SESSION_CLOSE"; sessionId: string }

  // ── Device management ──────────────────────────────────────
  | { kind: "DEVICE_STATUS"; status: DeviceStatus }
  | { kind: "DEVICE_LIST_REQUEST" }
  | { kind: "DEVICE_LIST"; devices: DeviceInfo[] }

  // ── Messaging ──────────────────────────────────────────────
  | { kind: "MESSAGE"; text: string }
  | { kind: "MESSAGE_ACK"; messageId: string }

  // ── Encrypted wrapper ──────────────────────────────────────
  | { kind: "ENCRYPTED"; ciphertext: string; nonce: string }

  // ── Control ────────────────────────────────────────────────
  | { kind: "PING" }
  | { kind: "PONG" }
  | { kind: "ERROR"; code: string; message: string }
  | { kind: "DISCONNECT"; reason?: string };

// ─── Helpers ─────────────────────────────────────────────────────

export type PayloadKind = Payload["kind"];

let _seqId = 0;

/**
 * Generate a monotonically increasing message ID.
 * Format: `<timestamp>-<seq>` for ordering and deduplication.
 */
export function generateMessageId(): string {
  return `${Date.now()}-${++_seqId}`;
}

/**
 * Create a new envelope ready to send.
 */
export function createEnvelope(
  from: { user: string; device: string },
  to: Destination,
  payload: Payload
): Envelope {
  return {
    v: 2,
    id: generateMessageId(),
    ts: Date.now(),
    from,
    to,
    payload,
  };
}

// ─── Codec ───────────────────────────────────────────────────────

/**
 * Encode an envelope to a wire-format string.
 * Uses JSON for now; can be swapped to MessagePack for binary efficiency.
 */
export function encode(envelope: Envelope): string {
  return JSON.stringify(envelope);
}

/**
 * Decode a wire-format string into an envelope.
 * Validates the protocol version.
 */
export function decode(data: string | Buffer): Envelope {
  const text = typeof data === "string" ? data : data.toString("utf8");
  const parsed = JSON.parse(text) as Partial<Envelope>;

  if (!parsed || typeof parsed.v !== "number") {
    throw new ProtocolError("INVALID_MESSAGE", "missing protocol version");
  }

  if (parsed.v !== 2) {
    throw new ProtocolError(
      "VERSION_MISMATCH",
      `expected protocol v2, got v${parsed.v}`
    );
  }

  if (!parsed.payload || typeof parsed.payload.kind !== "string") {
    throw new ProtocolError("INVALID_PAYLOAD", "missing payload kind");
  }

  return parsed as Envelope;
}

// ─── Errors ──────────────────────────────────────────────────────

export class ProtocolError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ProtocolError";
  }
}

// ─── Legacy compat (re-exports for gradual migration) ────────────

/** @deprecated Use `encode()` instead */
export const encodeMessage = (msg: Record<string, unknown>): string =>
  JSON.stringify(msg);

/** @deprecated Use `decode()` instead */
export function decodeMessage(data: unknown): Record<string, unknown> {
  const text = typeof data === "string" ? data : data?.toString();
  if (!text) throw new Error("empty message");
  return JSON.parse(text) as Record<string, unknown>;
}
