import readline from "node:readline/promises";
import process from "node:process";
import pty, { type IPty } from "node-pty";
import WebSocket from "ws";
import {
  decodeMessage,
  encodeMessage,
  type PeerIdentity,
  type ServerMessage
} from "@t-bridge/protocol";
import {
  createSessionCipher,
  generateEphemeralKeyPair,
  type EphemeralKeyPair,
  type SessionCipher
} from "@t-bridge/crypto";
import {
  loadOrCreateIdentity,
  publicIdentity
} from "../identity/identity-store.js";
import { decideAccess } from "../permissions/policy.js";
import { generateShareCode, getDefaultShell } from "./platform.js";

export type ShareTerminalOptions = {
  code?: string;
  serverUrl: string;
  shell?: string;
};

const BACKPRESSURE_HIGH = 64 * 1024; // 64 KB
const BACKPRESSURE_LOW = 16 * 1024; // 16 KB
const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAYS = [1000, 2000, 4000]; // exponential backoff

export async function shareTerminal(
  options: ShareTerminalOptions
): Promise<void> {
  const code = options.code ?? generateShareCode();
  const shell = getDefaultShell(options.shell);
  const identity = await loadOrCreateIdentity();
  let child: IPty | undefined;
  let isClosed = false;
  let sessionId: string | undefined;
  let cipher: SessionCipher | undefined;
  let ephemeral: EphemeralKeyPair | undefined;
  let isPtyPaused = false;

  function connectSocket(isReconnect = false): WebSocket {
    const socket = new WebSocket(options.serverUrl);

    socket.on("open", () => {
      if (isReconnect && sessionId) {
        socket.send(
          encodeMessage({
            type: "RECONNECT",
            sessionId,
            identity: publicIdentity(identity)
          })
        );
      } else {
        socket.send(
          encodeMessage({
            type: "REGISTER_HOST",
            code,
            identity: publicIdentity(identity)
          })
        );
      }
    });

    socket.on("message", async (data) => {
      const message = decodeMessage(data) as ServerMessage;

      switch (message.type) {
        case "HOST_REGISTERED":
          process.stdout.write(
            `T-Bridge share code: ${message.code}\nWaiting for guest on ${options.serverUrl}\nCodes expire if no guest connects in time.\n`
          );
          return;
        case "ACCESS_REQUEST":
          const approval = await approveAccess(
            message.code,
            message.requester
          );
          if (approval.allowed) {
            socket.send(encodeMessage({ type: "ACCESS_APPROVED" }));
          } else {
            socket.send(
              encodeMessage({
                type: "ACCESS_REJECTED",
                reason: approval.reason
              })
            );
          }
          return;
        case "SESSION_READY":
          sessionId = message.sessionId;
          process.stdout.write(`Guest connected. Sharing shell: ${shell}\n`);

          // Start E2E key exchange
          ephemeral = generateEphemeralKeyPair();
          socket.send(
            encodeMessage({
              type: "KEY_EXCHANGE",
              ephemeralPublicKey: ephemeral.publicKey.toString("base64")
            })
          );
          return;
        case "KEY_EXCHANGE":
          if (!ephemeral) {
            return;
          }

          // Complete key exchange and create cipher
          const peerPublicKey = Buffer.from(
            message.ephemeralPublicKey,
            "base64"
          );
          cipher = createSessionCipher(
            ephemeral.privateKey,
            peerPublicKey,
            "host"
          );
          process.stdout.write("E2E encryption established.\n");

          // Now spawn the PTY
          child = spawnSharedPty(shell, socket, cipher);
          return;
        case "ENCRYPTED_DATA":
          if (!cipher || !child) {
            return;
          }

          try {
            const plaintext = cipher.decrypt({
              ciphertext: message.ciphertext,
              nonce: message.nonce
            });
            child.write(plaintext);
          } catch (error) {
            process.stderr.write(
              `Decryption error: ${error instanceof Error ? error.message : String(error)}\n`
            );
          }
          return;
        case "PTY_INPUT":
          // Unencrypted fallback (should not happen after key exchange)
          child?.write(message.data);
          return;
        case "PTY_RESIZE":
          child?.resize(message.cols, message.rows);
          return;
        case "SESSION_TERMINATE":
          child?.kill();
          process.stdout.write(
            `Session ended: ${message.reason ?? "closed"}\n`
          );
          socket.close();
          return;
        case "RECONNECT_OK":
          process.stdout.write("Reconnected to session.\n");
          return;
        case "ERROR":
          process.stderr.write(`Relay error: ${message.message}\n`);
          socket.close();
          return;
        default:
          return;
      }
    });

    // Backpressure: resume PTY when send buffer drains
    const drainCheck = setInterval(() => {
      if (
        isPtyPaused &&
        socket.bufferedAmount < BACKPRESSURE_LOW &&
        child
      ) {
        isPtyPaused = false;
        child.resume();
      }
    }, 50);

    socket.on("close", () => {
      clearInterval(drainCheck);

      if (isClosed) {
        return;
      }

      // If session was active, attempt reconnect
      if (sessionId && !isClosed) {
        attemptReconnect(0);
        return;
      }

      isClosed = true;
      child?.kill();
    });

    socket.on("error", (error) => {
      process.stderr.write(`Relay connection error: ${error.message}\n`);
    });

    return socket;
  }

  let currentSocket = connectSocket(false);

  function attemptReconnect(attempt: number): void {
    if (attempt >= MAX_RECONNECT_ATTEMPTS) {
      process.stderr.write("Reconnect failed. Closing session.\n");
      isClosed = true;
      child?.kill();
      return;
    }

    const delay = RECONNECT_DELAYS[attempt] ?? 4000;
    process.stderr.write(
      `Connection lost. Reconnecting in ${delay}ms (attempt ${attempt + 1}/${MAX_RECONNECT_ATTEMPTS})...\n`
    );

    setTimeout(() => {
      if (isClosed) {
        return;
      }

      const newSocket = connectSocket(true);
      newSocket.on("open", () => {
        currentSocket = newSocket;
      });
      newSocket.on("error", () => {
        attemptReconnect(attempt + 1);
      });
    }, delay);
  }

  function spawnSharedPty(
    shellPath: string,
    socket: WebSocket,
    sessionCipher: SessionCipher
  ): IPty {
    const ptyChild = pty.spawn(shellPath, [], {
      name: process.env.TERM || "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: process.cwd(),
      env: {
        ...process.env,
        TBRIDGE_MODE: "host"
      }
    });

    ptyChild.onData((ptyData) => {
      if (socket.readyState !== WebSocket.OPEN) {
        return;
      }

      // Backpressure: pause PTY if send buffer is too large
      if (socket.bufferedAmount > BACKPRESSURE_HIGH) {
        if (!isPtyPaused) {
          isPtyPaused = true;
          ptyChild.pause();
        }
        return;
      }

      const encrypted = sessionCipher.encrypt(ptyData);
      socket.send(
        encodeMessage({
          type: "ENCRYPTED_DATA",
          ciphertext: encrypted.ciphertext,
          nonce: encrypted.nonce
        })
      );
    });

    ptyChild.onExit(({ exitCode, signal }) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(
          encodeMessage({
            type: "PTY_EXIT",
            code: signal === 0 ? exitCode : null
          })
        );
      }
    });

    return ptyChild;
  }
}

async function approveAccess(
  code: string,
  requester: PeerIdentity
): Promise<{ allowed: boolean; reason: string }> {
  const decision = await decideAccess(requester.userId);

  if (decision.action === "allow") {
    process.stdout.write(
      `Auto-approved ${requester.userId} (${requester.deviceName}): ${decision.reason}\n`
    );
    return { allowed: true, reason: decision.reason };
  }

  if (decision.action === "deny") {
    process.stdout.write(
      `Auto-rejected ${requester.userId} (${requester.deviceName}): ${decision.reason}\n`
    );
    return { allowed: false, reason: decision.reason };
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    const answer = await rl.question(
      `Guest ${requester.userId} from ${requester.deviceName} wants to connect with code ${code}. Allow? [y/N] `
    );
    const allowed = answer.trim().toLowerCase() === "y";
    return {
      allowed,
      reason: allowed ? "host approved access" : "host rejected access"
    };
  } finally {
    rl.close();
  }
}
