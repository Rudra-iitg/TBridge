import process from "node:process";
import WebSocket from "ws";
import {
  decodeMessage,
  encodeMessage,
  type PeerIdentity,
  type ServerMessage
} from "@tbridge/protocol";
import {
  createSessionCipher,
  generateEphemeralKeyPair,
  type EphemeralKeyPair,
  type SessionCipher
} from "@tbridge/crypto";
import {
  loadOrCreateIdentity,
  publicIdentity
} from "../identity/identity-store.js";
import {
  renderBanner,
  renderSessionBox,
  spin,
  primary,
  success,
  error,
  dim,
  accent,
  bold,
  userTag,
  icons,
  type Spinner,
} from "../ui/index.js";

export type ConnectToShareOptions = {
  code: string;
  requesterId?: string;
  serverUrl: string;
};

const EXIT_SEQUENCE = "\u001d"; // Ctrl+]
const BACKPRESSURE_HIGH = 64 * 1024;
const BACKPRESSURE_LOW = 16 * 1024;
const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAYS = [1000, 2000, 4000];

export async function connectToShare(
  options: ConnectToShareOptions
): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("connect mode requires an interactive terminal");
  }

  const identity = await loadOrCreateIdentity({ userId: options.requesterId });

  let isRaw = false;
  let isClosed = false;
  let sessionId: string | undefined;
  let cipher: SessionCipher | undefined;
  let ephemeral: EphemeralKeyPair | undefined;
  let isStdinPaused = false;
  let sessionStartMs: number | undefined;
  let peerIdentity: PeerIdentity | undefined;
  let activeSpinner: Spinner | undefined;

  // ── Banner ──────────────────────────────────────────────────────
  process.stderr.write(
    renderBanner({
      version: "0.1.0",
      userId: identity.userId,
      deviceName: identity.deviceName,
    })
  );

  activeSpinner = spin("Connecting to relay…");

  const onInput = (data: Buffer) => {
    if (data.toString("utf8") === EXIT_SEQUENCE) {
      currentSocket.send(
        encodeMessage({
          type: "SESSION_TERMINATE",
          reason: "guest detached"
        })
      );
      currentSocket.close();
      return;
    }

    // Backpressure: skip if send buffer is too high
    if (currentSocket.bufferedAmount > BACKPRESSURE_HIGH) {
      if (!isStdinPaused) {
        isStdinPaused = true;
        process.stdin.pause();
      }
      return;
    }

    if (cipher) {
      const encrypted = cipher.encrypt(data.toString("binary"));
      currentSocket.send(
        encodeMessage({
          type: "ENCRYPTED_DATA",
          ciphertext: encrypted.ciphertext,
          nonce: encrypted.nonce
        })
      );
    } else {
      currentSocket.send(
        encodeMessage({
          type: "PTY_INPUT",
          data: data.toString("binary")
        })
      );
    }
  };

  const onResize = () => {
    sendResize(currentSocket);
  };

  function connectSocket(isReconnect = false): WebSocket {
    const socket = new WebSocket(options.serverUrl);

    socket.on("open", () => {
      if (isReconnect && sessionId) {
        activeSpinner = spin("Reconnecting to session…");
        socket.send(
          encodeMessage({
            type: "RECONNECT",
            sessionId,
            identity: publicIdentity(identity)
          })
        );
      } else {
        activeSpinner?.succeed("Connected to relay");
        activeSpinner = spin(`Requesting access for code ${bold(options.code)}…`);

        socket.send(
          encodeMessage({
            type: "REGISTER_GUEST",
            code: options.code,
            identity: publicIdentity(identity)
          })
        );
      }
    });

    socket.on("message", (data) => {
      const message = decodeMessage(data) as ServerMessage;

      switch (message.type) {
        case "SESSION_READY": {
          sessionId = message.sessionId;
          sessionStartMs = Date.now();

          activeSpinner?.succeed("Access approved");
          activeSpinner = spin("Establishing E2E encryption…");

          // Start E2E key exchange
          ephemeral = generateEphemeralKeyPair();
          socket.send(
            encodeMessage({
              type: "KEY_EXCHANGE",
              ephemeralPublicKey: ephemeral.publicKey.toString("base64")
            })
          );

          enableRawInput(onInput);
          isRaw = true;
          sendResize(socket);
          return;
        }

        case "SESSION_INFO": {
          peerIdentity = message.peerIdentity;
          return;
        }

        case "KEY_EXCHANGE": {
          if (!ephemeral) return;

          const peerPublicKey = Buffer.from(
            message.ephemeralPublicKey,
            "base64"
          );
          cipher = createSessionCipher(
            ephemeral.privateKey,
            peerPublicKey,
            "guest"
          );

          activeSpinner?.succeed("E2E encryption established");

          // Show connected session box
          const peerName = peerIdentity?.userId ?? "host";
          const peerDevice = peerIdentity?.deviceName;

          process.stderr.write("\r\n" + renderSessionBox({
            state: "connected",
            peerName,
            peerColorIndex: 1,
            encrypted: true,
            sessionStartMs,
            deviceName: peerDevice,
          }) + "\r\n\r\n");

          activeSpinner = undefined;
          return;
        }

        case "ENCRYPTED_DATA": {
          if (!cipher) return;

          try {
            const plaintext = cipher.decrypt({
              ciphertext: message.ciphertext,
              nonce: message.nonce
            });
            process.stdout.write(plaintext);
          } catch (err) {
            process.stderr.write(
              `  ${error("✗")} Decryption error: ${err instanceof Error ? err.message : String(err)}\r\n`
            );
          }
          return;
        }

        case "ACCESS_REJECTED": {
          activeSpinner?.fail(`Access rejected: ${message.reason}`);
          socket.close();
          return;
        }

        case "PTY_OUTPUT":
          process.stdout.write(message.data);
          return;

        case "PTY_EXIT": {
          process.stderr.write(
            `\r\n  ${dim(icons.dash.repeat(50))}\r\n  ${dim("Remote shell exited")} ${dim(`(${message.code})`)}\r\n\r\n`
          );
          socket.close();
          return;
        }

        case "SESSION_TERMINATE": {
          process.stderr.write(
            `\r\n  ${dim(icons.dash.repeat(50))}\r\n  ${error(icons.cross)} Session ended: ${message.reason ?? "closed"}\r\n\r\n`
          );
          socket.close();
          return;
        }

        case "RECONNECT_OK": {
          activeSpinner?.succeed("Reconnected to session");
          activeSpinner = undefined;

          if (!isRaw) {
            enableRawInput(onInput);
            isRaw = true;
          }
          sendResize(socket);
          return;
        }

        case "ERROR": {
          activeSpinner?.fail(`Relay error: ${message.message}`);
          socket.close();
          return;
        }

        default:
          return;
      }
    });

    // Backpressure: resume stdin when send buffer drains
    const drainCheck = setInterval(() => {
      if (
        isStdinPaused &&
        socket.bufferedAmount < BACKPRESSURE_LOW
      ) {
        isStdinPaused = false;
        process.stdin.resume();
      }
    }, 50);

    socket.on("close", () => {
      clearInterval(drainCheck);

      if (isClosed) return;

      // If session was active, attempt reconnect
      if (sessionId && !isClosed) {
        attemptReconnect(0);
        return;
      }

      isClosed = true;
      cleanup();
    });

    socket.on("error", (err) => {
      activeSpinner?.fail(`Connection error: ${err.message}`);
    });

    return socket;
  }

  let currentSocket = connectSocket(false);

  function attemptReconnect(attempt: number): void {
    if (attempt >= MAX_RECONNECT_ATTEMPTS) {
      process.stderr.write(
        `  ${error(icons.cross)} Reconnect failed after ${MAX_RECONNECT_ATTEMPTS} attempts\r\n`
      );
      isClosed = true;
      cleanup();
      return;
    }

    const delay = RECONNECT_DELAYS[attempt] ?? 4000;
    activeSpinner = spin(
      `Connection lost. Reconnecting in ${delay}ms (${attempt + 1}/${MAX_RECONNECT_ATTEMPTS})…`
    );

    setTimeout(() => {
      if (isClosed) return;

      activeSpinner?.update("Reconnecting…");
      const newSocket = connectSocket(true);
      newSocket.on("open", () => {
        currentSocket = newSocket;
      });
      newSocket.on("error", () => {
        activeSpinner?.fail("Reconnect attempt failed");
        attemptReconnect(attempt + 1);
      });
    }, delay);
  }

  function cleanup(): void {
    if (isRaw) {
      process.stdin.off("data", onInput);
      process.stdout.off("resize", onResize);
      process.stdin.setRawMode(false);
      process.stdin.pause();
    }
  }

  process.stdout.on("resize", onResize);
}

function enableRawInput(onInput: (data: Buffer) => void): void {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("data", onInput);
}

function sendResize(socket: WebSocket): void {
  if (socket.readyState !== WebSocket.OPEN) return;

  socket.send(
    encodeMessage({
      type: "PTY_RESIZE",
      cols: process.stdout.columns || 80,
      rows: process.stdout.rows || 24
    })
  );
}
