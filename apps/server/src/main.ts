import http from "node:http";
import crypto from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import {
  decodeMessage,
  encodeMessage,
  type ClientMessage,
  type ServerMessage
} from "@t-bridge/protocol";

type RelayPeer = {
  socket: WebSocket;
  role: "host" | "guest";
};

type RelayRoom = {
  code: string;
  sessionId?: string;
  host: RelayPeer;
  guest?: RelayPeer;
};

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";
const roomsByCode = new Map<string, RelayRoom>();
const roomsBySocket = new Map<WebSocket, RelayRoom>();

const server = http.createServer();
const wss = new WebSocketServer({ server });

wss.on("connection", (socket) => {
  socket.on("message", (data) => {
    let message: ClientMessage;

    try {
      message = decodeMessage(data) as ClientMessage;
    } catch (error) {
      send(socket, { type: "ERROR", message: getErrorMessage(error) });
      return;
    }

    handleMessage(socket, message);
  });

  socket.on("close", () => {
    closeSocketRoom(socket);
  });
});

server.listen(port, host, () => {
  process.stdout.write(`T-Bridge relay listening on ws://${host}:${port}\n`);
});

function handleMessage(socket: WebSocket, message: ClientMessage): void {
  switch (message.type) {
    case "REGISTER_HOST":
      registerHost(socket, message.code);
      return;
    case "REGISTER_GUEST":
      registerGuest(socket, message.code);
      return;
    case "ACCESS_APPROVED":
      approveAccess(socket);
      return;
    case "ACCESS_REJECTED":
      rejectAccess(socket, message.reason);
      return;
    case "PTY_INPUT":
    case "PTY_OUTPUT":
    case "PTY_RESIZE":
    case "PTY_EXIT":
    case "SESSION_TERMINATE":
      forwardToPeer(socket, message);
      return;
    default:
      send(socket, { type: "ERROR", message: "unsupported message" });
  }
}

function registerHost(socket: WebSocket, code: string): void {
  if (!code) {
    send(socket, { type: "ERROR", message: "share code is required" });
    socket.close();
    return;
  }

  if (roomsByCode.has(code)) {
    send(socket, { type: "ERROR", message: "share code is already active" });
    socket.close();
    return;
  }

  const room: RelayRoom = {
    code,
    host: { socket, role: "host" }
  };

  roomsByCode.set(code, room);
  roomsBySocket.set(socket, room);
  send(socket, { type: "HOST_REGISTERED", code });
}

function registerGuest(socket: WebSocket, code: string): void {
  const room = roomsByCode.get(code);
  if (!room) {
    send(socket, { type: "ERROR", message: "share code not found" });
    socket.close();
    return;
  }

  if (room.guest) {
    send(socket, { type: "ERROR", message: "share code already has a guest" });
    socket.close();
    return;
  }

  room.guest = { socket, role: "guest" };
  roomsBySocket.set(socket, room);
  send(room.host.socket, { type: "ACCESS_REQUEST", code });
}

function approveAccess(socket: WebSocket): void {
  const room = roomsBySocket.get(socket);
  if (!room || room.host.socket !== socket || !room.guest) {
    send(socket, { type: "ERROR", message: "no pending access request" });
    return;
  }

  room.sessionId = crypto.randomUUID();
  send(room.host.socket, {
    type: "SESSION_READY",
    sessionId: room.sessionId,
    role: "host"
  });
  send(room.guest.socket, {
    type: "SESSION_READY",
    sessionId: room.sessionId,
    role: "guest"
  });
}

function rejectAccess(socket: WebSocket, reason = "host rejected access"): void {
  const room = roomsBySocket.get(socket);
  if (!room || room.host.socket !== socket || !room.guest) {
    send(socket, { type: "ERROR", message: "no pending access request" });
    return;
  }

  send(room.guest.socket, { type: "ACCESS_REJECTED", reason });
  room.guest.socket.close();
  room.guest = undefined;
}

function forwardToPeer(socket: WebSocket, message: ClientMessage): void {
  const room = roomsBySocket.get(socket);
  if (!room?.sessionId) {
    send(socket, { type: "ERROR", message: "session is not ready" });
    return;
  }

  const target =
    socket === room.host.socket ? room.guest?.socket : room.host.socket;

  if (!target || target.readyState !== WebSocket.OPEN) {
    send(socket, { type: "ERROR", message: "peer is not connected" });
    return;
  }

  send(target, message as ServerMessage);
}

function closeSocketRoom(socket: WebSocket): void {
  const room = roomsBySocket.get(socket);
  if (!room) {
    return;
  }

  roomsBySocket.delete(socket);

  const peer =
    socket === room.host.socket ? room.guest?.socket : room.host.socket;
  if (peer?.readyState === WebSocket.OPEN) {
    send(peer, { type: "SESSION_TERMINATE", reason: "peer disconnected" });
  }

  if (socket === room.host.socket) {
    roomsByCode.delete(room.code);
    room.guest?.socket.close();
    return;
  }

  room.guest = undefined;
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(encodeMessage(message));
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
