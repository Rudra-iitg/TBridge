import crypto from "node:crypto";
import type { WebSocket } from "ws";
import type { PeerIdentity } from "@tbridge/protocol";

export type RelayRole = "host" | "guest";
export type RelayState = "waiting" | "pending" | "active" | "ended";

export type RelayPeer = {
  socket: WebSocket;
  role: RelayRole;
  identity: PeerIdentity;
};

export type RelayRoom = {
  code: string;
  createdAt: number;
  expiresAt: number;
  state: RelayState;
  host: RelayPeer;
  guest?: RelayPeer;
  sessionId?: string;
};

export type RegisterHostResult =
  | { ok: true; room: RelayRoom }
  | { ok: false; message: string };

export type RegisterGuestResult =
  | { ok: true; room: RelayRoom }
  | { ok: false; message: string };

export type ApprovalResult =
  | { ok: true; room: RelayRoom; sessionId: string }
  | { ok: false; message: string };

export type PeerResult =
  | { ok: true; room: RelayRoom; peer: WebSocket }
  | { ok: false; message: string };

export type ReconnectResult =
  | { ok: true; room: RelayRoom }
  | { ok: false; message: string };

export class SessionManager {
  private readonly roomsByCode = new Map<string, RelayRoom>();
  private readonly roomsBySocket = new Map<WebSocket, RelayRoom>();
  private readonly roomsBySessionId = new Map<string, RelayRoom>();

  constructor(private readonly codeTtlMs: number) {}

  registerHost(
    socket: WebSocket,
    code: string,
    identity: PeerIdentity,
    now = Date.now()
  ): RegisterHostResult {
    this.expireRooms(now);

    if (!code) {
      return { ok: false, message: "share code is required" };
    }

    if (this.roomsByCode.has(code)) {
      return { ok: false, message: "share code is already active" };
    }

    const room: RelayRoom = {
      code,
      createdAt: now,
      expiresAt: now + this.codeTtlMs,
      state: "waiting",
      host: { socket, role: "host", identity }
    };

    this.roomsByCode.set(code, room);
    this.roomsBySocket.set(socket, room);
    return { ok: true, room };
  }

  registerGuest(
    socket: WebSocket,
    code: string,
    identity: PeerIdentity,
    now = Date.now()
  ): RegisterGuestResult {
    this.expireRooms(now);

    const room = this.roomsByCode.get(code);
    if (!room) {
      return { ok: false, message: "share code not found or expired" };
    }

    if (room.state !== "waiting") {
      return { ok: false, message: `share code is ${room.state}` };
    }

    room.guest = { socket, role: "guest", identity };
    room.state = "pending";
    this.roomsBySocket.set(socket, room);
    return { ok: true, room };
  }

  approve(hostSocket: WebSocket): ApprovalResult {
    const room = this.roomsBySocket.get(hostSocket);
    if (!room || room.host.socket !== hostSocket || !room.guest) {
      return { ok: false, message: "no pending access request" };
    }

    if (room.state !== "pending") {
      return { ok: false, message: `session is ${room.state}` };
    }

    room.sessionId = crypto.randomUUID();
    room.state = "active";
    this.roomsByCode.delete(room.code);
    this.roomsBySessionId.set(room.sessionId, room);
    return { ok: true, room, sessionId: room.sessionId };
  }

  reject(hostSocket: WebSocket): ApprovalResult {
    const room = this.roomsBySocket.get(hostSocket);
    if (!room || room.host.socket !== hostSocket || !room.guest) {
      return { ok: false, message: "no pending access request" };
    }

    room.state = "ended";
    this.roomsByCode.delete(room.code);
    return { ok: true, room, sessionId: room.sessionId ?? "" };
  }

  /**
   * Reconnect a peer to an active session during the grace period.
   * The identity must match the original peer for the corresponding role.
   */
  reconnect(
    socket: WebSocket,
    sessionId: string,
    identity: PeerIdentity
  ): ReconnectResult {
    const room = this.roomsBySessionId.get(sessionId);
    if (!room) {
      return { ok: false, message: "session not found" };
    }

    if (room.state !== "active") {
      return { ok: false, message: `session is ${room.state}` };
    }

    // Match by deviceId to determine which role is reconnecting
    if (room.host.identity.deviceId === identity.deviceId) {
      // Remove old socket mapping
      this.roomsBySocket.delete(room.host.socket);
      // Update to new socket
      room.host = { socket, role: "host", identity };
      this.roomsBySocket.set(socket, room);
      return { ok: true, room };
    }

    if (room.guest?.identity.deviceId === identity.deviceId) {
      this.roomsBySocket.delete(room.guest.socket);
      room.guest = { socket, role: "guest", identity };
      this.roomsBySocket.set(socket, room);
      return { ok: true, room };
    }

    return { ok: false, message: "identity does not match session peers" };
  }

  getPeer(socket: WebSocket): PeerResult {
    const room = this.roomsBySocket.get(socket);
    if (!room) {
      return { ok: false, message: "session not found" };
    }

    if (room.state !== "active") {
      return { ok: false, message: "session is not ready" };
    }

    const peer =
      socket === room.host.socket ? room.guest?.socket : room.host.socket;

    if (!peer) {
      return { ok: false, message: "peer is not connected" };
    }

    return { ok: true, room, peer };
  }

  getRoom(socket: WebSocket): RelayRoom | undefined {
    return this.roomsBySocket.get(socket);
  }

  releaseSocket(socket: WebSocket): RelayRoom | undefined {
    const room = this.roomsBySocket.get(socket);
    if (!room) {
      return undefined;
    }

    this.roomsBySocket.delete(socket);

    if (socket === room.host.socket) {
      room.state = "ended";
      this.roomsByCode.delete(room.code);
      if (room.sessionId) {
        this.roomsBySessionId.delete(room.sessionId);
      }
      if (room.guest) {
        this.roomsBySocket.delete(room.guest.socket);
      }
      return room;
    }

    if (room.guest?.socket === socket) {
      room.guest = undefined;
      if (room.state === "pending" || room.state === "active") {
        room.state = "ended";
        this.roomsByCode.delete(room.code);
        if (room.sessionId) {
          this.roomsBySessionId.delete(room.sessionId);
        }
      }
    }

    return room;
  }

  expireRooms(now = Date.now()): RelayRoom[] {
    const expired: RelayRoom[] = [];

    for (const room of this.roomsByCode.values()) {
      if (room.state !== "active" && room.expiresAt <= now) {
        room.state = "ended";
        this.roomsByCode.delete(room.code);
        this.roomsBySocket.delete(room.host.socket);
        if (room.sessionId) {
          this.roomsBySessionId.delete(room.sessionId);
        }
        if (room.guest) {
          this.roomsBySocket.delete(room.guest.socket);
        }
        expired.push(room);
      }
    }

    return expired;
  }
}
