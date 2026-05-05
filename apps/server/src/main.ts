import http from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import {
  decodeMessage,
  encodeMessage,
  type ClientMessage,
  type PeerIdentity,
  type ServerMessage
} from "@t-bridge/protocol";
import { log } from "./logger.js";
import {
  connectionLimiter,
  messageLimiter,
  registrationLimiter
} from "./rate-limiter.js";
import { SessionManager } from "./session-manager.js";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";
const codeTtlMs = Number(process.env.CODE_TTL_MS ?? 5 * 60 * 1000);
const reconnectGraceMs = Number(process.env.RECONNECT_GRACE_MS ?? 30_000);
const sessions = new SessionManager(codeTtlMs);

// Track session start times for duration logging
const sessionStartTimes = new Map<string, number>();

// Track pending grace-period cleanups so reconnect can cancel them
const graceTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Map sockets to their remote IP for rate limiting
const socketIps = new Map<WebSocket, string>();

const server = http.createServer();
const wss = new WebSocketServer({ server });

const expirySweep = setInterval(() => {
  for (const room of sessions.expireRooms()) {
    log.info({
      event: "code.expire",
      code: room.code,
      userId: room.host.identity.userId
    });
    send(room.host.socket, {
      type: "ERROR",
      message: "share code expired before a guest connected"
    });
    room.host.socket.close();
    room.guest?.socket.close();
  }
}, Math.min(codeTtlMs, 30_000));

wss.on("connection", (socket, req) => {
  const ip = req.socket.remoteAddress ?? "unknown";
  socketIps.set(socket, ip);

  // Rate limit connections per IP
  const connResult = connectionLimiter.check(ip);
  if (!connResult.allowed) {
    log.warn({
      event: "rate.limit",
      ip,
      message: `connection rate limit exceeded (retry after ${connResult.retryAfterMs}ms)`
    });
    send(socket, { type: "ERROR", message: "too many connections" });
    socket.close();
    return;
  }

  socket.on("message", (data) => {
    // Rate limit messages per IP
    const msgResult = messageLimiter.check(ip);
    if (!msgResult.allowed) {
      log.warn({ event: "rate.limit", ip, message: "message rate limit exceeded" });
      send(socket, { type: "ERROR", message: "message rate limit exceeded" });
      return;
    }

    let message: ClientMessage;

    try {
      message = decodeMessage(data) as ClientMessage;
    } catch (error) {
      log.error({
        event: "error",
        ip,
        message: getErrorMessage(error)
      });
      send(socket, { type: "ERROR", message: getErrorMessage(error) });
      return;
    }

    handleMessage(socket, message, ip);
  });

  socket.on("close", () => {
    handleDisconnect(socket);
    socketIps.delete(socket);
  });
});

server.listen(port, host, () => {
  log.info({
    event: "relay.start",
    message: `T-Bridge relay listening on ws://${host}:${port} (code TTL ${codeTtlMs}ms, reconnect grace ${reconnectGraceMs}ms)`
  });
});

server.on("close", () => {
  clearInterval(expirySweep);
  for (const timer of graceTimers.values()) {
    clearTimeout(timer);
  }
});

function handleMessage(
  socket: WebSocket,
  message: ClientMessage,
  ip: string
): void {
  switch (message.type) {
    case "REGISTER_HOST":
      registerHost(socket, message.code, message.identity, ip);
      return;
    case "REGISTER_GUEST":
      registerGuest(socket, message.code, message.identity, ip);
      return;
    case "ACCESS_APPROVED":
      approveAccess(socket);
      return;
    case "ACCESS_REJECTED":
      rejectAccess(socket, message.reason);
      return;
    case "RECONNECT":
      handleReconnect(socket, message.sessionId, message.identity, ip);
      return;
    case "KEY_EXCHANGE":
    case "ENCRYPTED_DATA":
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

function registerHost(
  socket: WebSocket,
  code: string,
  identity: PeerIdentity,
  ip: string
): void {
  // Rate limit registrations per IP
  const regResult = registrationLimiter.check(ip);
  if (!regResult.allowed) {
    log.warn({
      event: "rate.limit",
      ip,
      userId: identity.userId,
      message: "registration rate limit exceeded"
    });
    send(socket, { type: "ERROR", message: "too many registration attempts" });
    socket.close();
    return;
  }

  const result = sessions.registerHost(socket, code, identity);
  if (!result.ok) {
    log.warn({
      event: "error",
      code,
      userId: identity.userId,
      ip,
      message: result.message
    });
    send(socket, { type: "ERROR", message: result.message });
    socket.close();
    return;
  }

  log.info({
    event: "host.register",
    code: result.room.code,
    userId: identity.userId,
    deviceId: identity.deviceId,
    ip
  });
  send(socket, { type: "HOST_REGISTERED", code: result.room.code });
}

function registerGuest(
  socket: WebSocket,
  code: string,
  identity: PeerIdentity,
  ip: string
): void {
  // Rate limit registrations per IP
  const regResult = registrationLimiter.check(ip);
  if (!regResult.allowed) {
    log.warn({
      event: "rate.limit",
      ip,
      userId: identity.userId,
      message: "registration rate limit exceeded"
    });
    send(socket, { type: "ERROR", message: "too many registration attempts" });
    socket.close();
    return;
  }

  const result = sessions.registerGuest(socket, code, identity);
  if (!result.ok) {
    log.warn({
      event: "error",
      code,
      userId: identity.userId,
      ip,
      message: result.message
    });
    send(socket, { type: "ERROR", message: result.message });
    socket.close();
    return;
  }

  log.info({
    event: "guest.register",
    code,
    userId: identity.userId,
    deviceId: identity.deviceId,
    ip
  });

  log.info({
    event: "access.request",
    code,
    userId: identity.userId,
    deviceId: identity.deviceId
  });

  send(result.room.host.socket, {
    type: "ACCESS_REQUEST",
    code,
    requester: identity
  });
}

function approveAccess(socket: WebSocket): void {
  const result = sessions.approve(socket);
  if (!result.ok) {
    send(socket, { type: "ERROR", message: result.message });
    return;
  }

  sessionStartTimes.set(result.sessionId, Date.now());

  log.info({
    event: "access.approve",
    sessionId: result.sessionId,
    userId: result.room.host.identity.userId
  });

  log.info({
    event: "session.active",
    sessionId: result.sessionId,
    userId: result.room.guest!.identity.userId,
    deviceId: result.room.guest!.identity.deviceId
  });

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

  // Broadcast peer identity so each side can display the other's name/device
  send(result.room.host.socket, {
    type: "SESSION_INFO",
    peerIdentity: result.room.guest!.identity
  });
  send(result.room.guest!.socket, {
    type: "SESSION_INFO",
    peerIdentity: result.room.host.identity
  });
}

function rejectAccess(
  socket: WebSocket,
  reason = "host rejected access"
): void {
  const result = sessions.reject(socket);
  if (!result.ok) {
    send(socket, { type: "ERROR", message: result.message });
    return;
  }

  log.info({
    event: "access.reject",
    userId: result.room.guest?.identity.userId,
    message: reason
  });

  send(result.room.guest!.socket, { type: "ACCESS_REJECTED", reason });
  result.room.guest!.socket.close();
}

function handleReconnect(
  socket: WebSocket,
  sessionId: string,
  identity: PeerIdentity,
  ip: string
): void {
  const result = sessions.reconnect(socket, sessionId, identity);
  if (!result.ok) {
    log.warn({
      event: "error",
      sessionId,
      userId: identity.userId,
      ip,
      message: result.message
    });
    send(socket, { type: "ERROR", message: result.message });
    socket.close();
    return;
  }

  // Cancel any pending grace timer for this session
  const timer = graceTimers.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    graceTimers.delete(sessionId);
  }

  log.info({
    event: "session.reconnect",
    sessionId,
    userId: identity.userId,
    deviceId: identity.deviceId,
    ip
  });

  send(socket, {
    type: "RECONNECT_OK",
    sessionId,
    role: result.room.host.socket === socket ? "host" : "guest"
  });
}

function forwardToPeer(socket: WebSocket, message: ClientMessage): void {
  const result = sessions.getPeer(socket);
  if (!result.ok) {
    send(socket, { type: "ERROR", message: result.message });
    return;
  }

  send(result.peer, message as ServerMessage);
}

function handleDisconnect(socket: WebSocket): void {
  const room = sessions.getRoom(socket);
  if (!room) {
    return;
  }

  // If the session is active, start a grace period before cleanup
  if (room.state === "active" && room.sessionId) {
    const sessionId = room.sessionId;
    const peer =
      socket === room.host.socket ? room.guest?.socket : room.host.socket;

    // Notify peer about disconnect (they can wait for reconnect)
    if (peer?.readyState === WebSocket.OPEN) {
      send(peer, {
        type: "SESSION_TERMINATE",
        reason: "peer disconnected (may reconnect)"
      });
    }

    // Mark the disconnected socket but don't release yet
    // Start grace timer
    const timer = setTimeout(() => {
      graceTimers.delete(sessionId);
      cleanupRoom(socket, room.sessionId);
    }, reconnectGraceMs);

    graceTimers.set(sessionId, timer);
    return;
  }

  // For non-active sessions, clean up immediately
  cleanupRoom(socket, room.sessionId);
}

function cleanupRoom(socket: WebSocket, sessionId?: string): void {
  const room = sessions.getRoom(socket);
  if (!room) {
    return;
  }

  const peer =
    socket === room.host.socket ? room.guest?.socket : room.host.socket;

  sessions.releaseSocket(socket);

  if (sessionId) {
    const startTime = sessionStartTimes.get(sessionId);
    const durationMs = startTime ? Date.now() - startTime : undefined;
    sessionStartTimes.delete(sessionId);

    log.info({
      event: "session.end",
      sessionId,
      durationMs,
      message: "peer disconnected"
    });
  }

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
