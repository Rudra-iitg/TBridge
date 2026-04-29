import http from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import {
  decodeMessage,
  encodeMessage,
  type ClientMessage,
  type ServerMessage
} from "@t-bridge/protocol";
import { SessionManager } from "./session-manager.js";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";
const codeTtlMs = Number(process.env.CODE_TTL_MS ?? 5 * 60 * 1000);
const sessions = new SessionManager(codeTtlMs);

const server = http.createServer();
const wss = new WebSocketServer({ server });

const expirySweep = setInterval(() => {
  for (const room of sessions.expireRooms()) {
    send(room.host.socket, {
      type: "ERROR",
      message: "share code expired before a guest connected"
    });
    room.host.socket.close();
    room.guest?.socket.close();
  }
}, Math.min(codeTtlMs, 30_000));

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
  process.stdout.write(
    `T-Bridge relay listening on ws://${host}:${port} (code TTL ${codeTtlMs}ms)\n`
  );
});

server.on("close", () => {
  clearInterval(expirySweep);
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
  const result = sessions.registerHost(socket, code);
  if (!result.ok) {
    send(socket, { type: "ERROR", message: result.message });
    socket.close();
    return;
  }

  send(socket, { type: "HOST_REGISTERED", code: result.room.code });
}

function registerGuest(socket: WebSocket, code: string): void {
  const result = sessions.registerGuest(socket, code);
  if (!result.ok) {
    send(socket, { type: "ERROR", message: result.message });
    socket.close();
    return;
  }

  send(result.room.host.socket, { type: "ACCESS_REQUEST", code });
}

function approveAccess(socket: WebSocket): void {
  const result = sessions.approve(socket);
  if (!result.ok) {
    send(socket, { type: "ERROR", message: result.message });
    return;
  }

  send(result.room.host.socket, {
    type: "SESSION_READY",
    sessionId: result.sessionId,
    role: "host"
  });
  send(result.room.guest!.socket, {
    type: "SESSION_READY",
    sessionId: result.sessionId,
    role: "guest"
  });
}

function rejectAccess(socket: WebSocket, reason = "host rejected access"): void {
  const result = sessions.reject(socket);
  if (!result.ok) {
    send(socket, { type: "ERROR", message: result.message });
    return;
  }

  send(result.room.guest!.socket, { type: "ACCESS_REJECTED", reason });
  result.room.guest!.socket.close();
}

function forwardToPeer(socket: WebSocket, message: ClientMessage): void {
  const result = sessions.getPeer(socket);
  if (!result.ok) {
    send(socket, { type: "ERROR", message: result.message });
    return;
  }

  send(result.peer, message as ServerMessage);
}

function closeSocketRoom(socket: WebSocket): void {
  const room = sessions.getRoom(socket);
  if (!room) {
    return;
  }

  const peer =
    socket === room.host.socket ? room.guest?.socket : room.host.socket;

  sessions.releaseSocket(socket);

  if (peer?.readyState === WebSocket.OPEN) {
    send(peer, { type: "SESSION_TERMINATE", reason: "peer disconnected" });
  }

  if (socket === room.host.socket) {
    room.guest?.socket.close();
  }
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(encodeMessage(message));
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
