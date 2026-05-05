import process from "node:process";
import WebSocket from "ws";
import {
  decodeMessage,
  encodeMessage,
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
        socket.send(
          encodeMessage({
            type: "RECONNECT",
            sessionId,
            identity: publicIdentity(identity)
          })
        );
        process.stdout.write("Reconnecting...\n");
      } else {
        socket.send(
          encodeMessage({
            type: "REGISTER_GUEST",
            code: options.code,
            identity: publicIdentity(identity)
          })
        );
        process.stdout.write(
          `Requesting access for ${options.code} as ${identity.userId} (${identity.deviceName})...\n`
        );
      }
    });

    socket.on("message", (data) => {
      const message = decodeMessage(data) as ServerMessage;

      switch (message.type) {
        case "SESSION_READY":
          sessionId = message.sessionId;
          process.stdout.write("\x1b[36mRemote session ready\x1b[0m\r\n");

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
        case "KEY_EXCHANGE":
          if (!ephemeral) {
            return;
          }

          const peerPublicKey = Buffer.from(
            message.ephemeralPublicKey,
            "base64"
          );
          cipher = createSessionCipher(
            ephemeral.privateKey,
            peerPublicKey,
            "guest"
          );
          process.stdout.write(
            "\x1b[36mE2E encryption established\x1b[0m\r\n"
          );
          return;
        case "ENCRYPTED_DATA":
          if (!cipher) {
            return;
          }

          try {
            const plaintext = cipher.decrypt({
              ciphertext: message.ciphertext,
              nonce: message.nonce
            });
            process.stdout.write(plaintext);
          } catch (error) {
            process.stderr.write(
              `Decryption error: ${error instanceof Error ? error.message : String(error)}\r\n`
            );
          }
          return;
        case "ACCESS_REJECTED":
          process.stderr.write(`Access rejected: ${message.reason}\n`);
          socket.close();
          return;
        case "PTY_OUTPUT":
          // Unencrypted fallback
          process.stdout.write(message.data);
          return;
        case "PTY_EXIT":
          process.stdout.write(
            `\r\nRemote shell exited (${message.code}).\r\n`
          );
          socket.close();
          return;
        case "SESSION_TERMINATE":
          process.stdout.write(
            `\r\nSession ended: ${message.reason ?? "closed"}\r\n`
          );
          socket.close();
          return;
        case "RECONNECT_OK":
          process.stdout.write(
            "\x1b[36mReconnected to session\x1b[0m\r\n"
          );
          if (!isRaw) {
            enableRawInput(onInput);
            isRaw = true;
          }
          sendResize(socket);
          return;
        case "ERROR":
          process.stderr.write(`Relay error: ${message.message}\n`);
          socket.close();
          return;
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

      if (isClosed) {
        return;
      }

      // If session was active, attempt reconnect
      if (sessionId && !isClosed) {
        attemptReconnect(0);
        return;
      }

      isClosed = true;
      cleanup();
    });

    socket.on("error", (error) => {
      process.stderr.write(`Relay connection error: ${error.message}\n`);
    });

    return socket;
  }

  let currentSocket = connectSocket(false);

  function attemptReconnect(attempt: number): void {
    if (attempt >= MAX_RECONNECT_ATTEMPTS) {
      process.stderr.write("Reconnect failed. Closing session.\r\n");
      isClosed = true;
      cleanup();
      return;
    }

    const delay = RECONNECT_DELAYS[attempt] ?? 4000;
    process.stderr.write(
      `Connection lost. Reconnecting in ${delay}ms (attempt ${attempt + 1}/${MAX_RECONNECT_ATTEMPTS})...\r\n`
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
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(
    encodeMessage({
      type: "PTY_RESIZE",
      cols: process.stdout.columns || 80,
      rows: process.stdout.rows || 24
    })
  );
}
