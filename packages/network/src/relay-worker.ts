import { parentPort, workerData } from "node:worker_threads";
import { WebSocketServer, WebSocket } from "ws";
import { decode, encode, type Envelope } from "@tbridge/protocol";

const port = workerData?.port || 8787;

const wss = new WebSocketServer({ port });

// Map of `${user}:${device}` to WebSocket
const clients = new Map<string, WebSocket>();

// Map of WebSocket to `${user}:${device}`
const socketIds = new Map<WebSocket, string>();

// Map of share codes to `${user}:${device}` (the host)
const shareCodes = new Map<string, string>();

// Map of WebSocket to their own share code
const socketCodes = new Map<WebSocket, string>();

function generateCode(): string {
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}

// ── Rate Limiting ────────────────────────────────────────────
// Simple sliding window: max 50 requests per 10 seconds per IP (here simulated by connection/fromId)
const WINDOW_MS = 10000;
const MAX_REQUESTS = 50;
const rateLimits = new Map<string, number[]>();

function checkRateLimit(id: string): boolean {
  const now = Date.now();
  let timestamps = rateLimits.get(id) || [];
  timestamps = timestamps.filter(ts => now - ts < WINDOW_MS);
  
  if (timestamps.length >= MAX_REQUESTS) {
    return false;
  }
  
  timestamps.push(now);
  rateLimits.set(id, timestamps);
  return true;
}

wss.on("connection", (socket, req) => {
  const ip = req.socket.remoteAddress || "unknown";
  
  socket.on("message", (data) => {
    try {
      if (!checkRateLimit(ip)) {
        // Rate limited
        return;
      }
      const envelope = decode(data as Buffer);
      handleEnvelope(socket, envelope);
    } catch (err) {
      // Ignore invalid envelopes
    }
  });

  socket.on("close", () => {
    const id = socketIds.get(socket);
    if (id) {
      clients.delete(id);
      socketIds.delete(socket);
    }
    const code = socketCodes.get(socket);
    if (code) {
      shareCodes.delete(code);
      socketCodes.delete(socket);
    }
  });
});

function handleEnvelope(socket: WebSocket, envelope: Envelope) {
  const fromId = `${envelope.from.user}:${envelope.from.device}`;

  // Ensure socket is registered
  if (!clients.has(fromId)) {
    clients.set(fromId, socket);
    socketIds.set(socket, fromId);
  }

  // Handle Relay-bound messages
  if (envelope.to.kind === "relay") {
    if (envelope.payload.kind === "HELLO") {
      // Give them a share code
      const code = generateCode();
      shareCodes.set(code, fromId);
      socketCodes.set(socket, code);

      send(socket, {
        v: 2,
        id: `relay-${Date.now()}`,
        ts: Date.now(),
        from: { user: "relay", device: "relay" },
        to: { kind: "peer", user: envelope.from.user, device: envelope.from.device },
        payload: { kind: "HELLO_ACK", sessionCode: code }
      });
    } else if (envelope.payload.kind === "PAIR_REQUEST") {
      const targetId = shareCodes.get(envelope.payload.sessionCode);
      if (!targetId) {
        // Send PAIR_REJECT back
        send(socket, {
          v: 2,
          id: `relay-${Date.now()}`,
          ts: Date.now(),
          from: { user: "relay", device: "relay" },
          to: { kind: "peer", user: envelope.from.user, device: envelope.from.device },
          payload: { kind: "PAIR_REJECT", reason: "Invalid or expired share code." }
        });
        return;
      }

      // Forward to the host
      const targetSocket = clients.get(targetId);
      if (targetSocket) {
        send(targetSocket, envelope);
      }
    }
    return;
  }

  // Handle Peer-to-Peer Routing
  if (envelope.to.kind === "peer") {
    const targetId = `${envelope.to.user}:${envelope.to.device}`;
    const targetSocket = clients.get(targetId);
    if (targetSocket) {
      send(targetSocket, envelope);
    }
    return;
  }

  // Handle Broadcast Routing
  if (envelope.to.kind === "broadcast") {
    for (const [id, targetSocket] of clients.entries()) {
      if (id !== fromId) {
        send(targetSocket, envelope);
      }
    }
  }
}

function send(socket: WebSocket, envelope: Envelope) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(encode(envelope));
  }
}

// Tell parent thread we started successfully
parentPort?.postMessage({ type: "READY", port });
