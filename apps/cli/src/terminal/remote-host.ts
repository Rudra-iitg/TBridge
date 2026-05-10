import process from "node:process";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pty, { type IPty } from "node-pty";
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
import { decideAccess } from "../permissions/policy.js";
import { generateShareCode, getDefaultShell } from "./platform.js";
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
  renderBox,
  accessPrompt,
  type Spinner,
} from "../ui/index.js";

export type ShareTerminalOptions = {
  code?: string;
  serverUrl: string;
  shell?: string;
};

const BACKPRESSURE_HIGH = 64 * 1024;
const BACKPRESSURE_LOW = 16 * 1024;
const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAYS = [1000, 2000, 4000];

// ---------------------------------------------------------------------------
// Embedded relay: auto-start if no relay is already running
// ---------------------------------------------------------------------------

function isRelayReachable(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.close();
      resolve(false);
    }, 1500);

    ws.on("open", () => {
      clearTimeout(timer);
      ws.close();
      resolve(true);
    });
    ws.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

function startEmbeddedRelay(
  url: string,
  spinner: Spinner
): { child: ChildProcess; ready: Promise<void> } {
  // Resolve the server entry point relative to this file
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  const serverEntry = path.resolve(thisDir, "../../../server/src/main.ts");

  // Parse port from the URL
  const parsed = new URL(url.replace("ws://", "http://").replace("wss://", "https://"));
  const port = parsed.port || "8787";
  const host = parsed.hostname || "127.0.0.1";

  const child = spawn("npx", ["tsx", serverEntry], {
    env: { ...process.env, PORT: port, HOST: host },
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  // Kill relay when the main process exits
  const cleanup = () => {
    try { child.kill(); } catch {}
  };
  process.on("exit", cleanup);
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  const ready = new Promise<void>((resolve, reject) => {
    let resolved = false;

    // Wait for the relay to be reachable (poll every 200ms, up to 10s)
    const maxAttempts = 50;
    let attempts = 0;

    const poll = setInterval(async () => {
      if (resolved) return;
      attempts++;

      if (await isRelayReachable(url)) {
        clearInterval(poll);
        resolved = true;
        resolve();
      } else if (attempts >= maxAttempts) {
        clearInterval(poll);
        resolved = true;
        reject(new Error("embedded relay failed to start"));
      }
    }, 200);

    child.on("error", (err) => {
      if (!resolved) {
        clearInterval(poll);
        resolved = true;
        reject(err);
      }
    });

    child.on("exit", (code) => {
      if (!resolved) {
        clearInterval(poll);
        resolved = true;
        reject(new Error(`relay process exited with code ${code}`));
      }
    });
  });

  return { child, ready };
}

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
  let sessionStartMs: number | undefined;
  let peerIdentity: PeerIdentity | undefined;
  let embeddedRelay: ChildProcess | undefined;

  // ── Banner ──────────────────────────────────────────────────────
  process.stderr.write(
    renderBanner({
      version: "0.1.0",
      userId: identity.userId,
      deviceName: identity.deviceName,
    })
  );

  const spinner = spin("Connecting to relay…");

  // ── Auto-start relay if needed ──────────────────────────────────
  const relayAlive = await isRelayReachable(options.serverUrl);
  if (!relayAlive) {
    spinner.update("Starting embedded relay…");
    try {
      const relay = startEmbeddedRelay(options.serverUrl, spinner);
      embeddedRelay = relay.child;
      await relay.ready;
      spinner.succeed("Relay started on " + dim(options.serverUrl));
    } catch (err) {
      spinner.fail(
        `Could not start relay: ${err instanceof Error ? err.message : String(err)}`
      );
      process.exitCode = 1;
      return;
    }
    // Re-create spinner for the next phase
    Object.assign(spinner, spin("Registering share code…"));
  }

  function connectSocket(isReconnect = false): WebSocket {
    const socket = new WebSocket(options.serverUrl);

    socket.on("open", () => {
      if (isReconnect && sessionId) {
        spinner.update("Reconnecting to session…");
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
        case "HOST_REGISTERED": {
          spinner.succeed("Connected to relay");

          const codeDisplay = renderBox(
            [
              `${bold("Share this code with your peer:")}`,
              "",
              `  ${primary("❯")}  ${bold(message.code)}`,
              "",
              `${dim("Shell:")} ${dim(shell)}`,
              `${dim("Server:")} ${dim(options.serverUrl)}`,
            ],
            "T-Bridge Share"
          );
          process.stderr.write(codeDisplay + "\r\n\r\n");

          const waitSpinner = spin("Waiting for a peer to connect…");
          // Store spinner for later access
          (socket as any).__waitSpinner = waitSpinner;
          return;
        }

        case "ACCESS_REQUEST": {
          const waitSpinner = (socket as any).__waitSpinner;
          if (waitSpinner) {
            waitSpinner.info(`${primary(message.requester.userId)} wants to connect`);
          }

          const approval = await handleApproval(
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
        }

        case "SESSION_READY": {
          sessionId = message.sessionId;
          sessionStartMs = Date.now();

          // Start E2E key exchange
          ephemeral = generateEphemeralKeyPair();
          const keySpinner = spin("Establishing E2E encryption…");
          (socket as any).__keySpinner = keySpinner;

          socket.send(
            encodeMessage({
              type: "KEY_EXCHANGE",
              ephemeralPublicKey: ephemeral.publicKey.toString("base64")
            })
          );
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
            "host"
          );

          const keySpinner = (socket as any).__keySpinner;
          if (keySpinner) {
            keySpinner.succeed("E2E encryption established");
          }

          // Show connected session box
          const peerName = peerIdentity?.userId ?? "peer";
          const peerDevice = peerIdentity?.deviceName;

          process.stderr.write("\r\n" + renderSessionBox({
            state: "connected",
            peerName,
            peerColorIndex: 1,
            encrypted: true,
            sessionStartMs,
            deviceName: peerDevice,
          }) + "\r\n\r\n");

          // Now spawn the PTY
          child = spawnSharedPty(shell, socket, cipher, peerName);
          return;
        }

        case "ENCRYPTED_DATA": {
          if (!cipher || !child) return;

          try {
            const plaintext = cipher.decrypt({
              ciphertext: message.ciphertext,
              nonce: message.nonce
            });
            child.write(plaintext);
          } catch (err) {
            process.stderr.write(
              `  ${error("✗")} Decryption error: ${err instanceof Error ? err.message : String(err)}\r\n`
            );
          }
          return;
        }

        case "PTY_INPUT":
          child?.write(message.data);
          return;

        case "PTY_RESIZE":
          child?.resize(message.cols, message.rows);
          return;

        case "SESSION_TERMINATE": {
          isClosed = true;
          child?.kill();
          process.stderr.write(
            `\r\n  ${dim(icons.dash.repeat(50))}\r\n  ${error(icons.cross)} Session ended: ${message.reason ?? "closed"}\r\n\r\n`
          );
          socket.close();
          return;
        }

        case "RECONNECT_OK": {
          spinner.succeed("Reconnected to session");
          return;
        }

        case "ERROR": {
          spinner.fail(`Relay error: ${message.message}`);
          socket.close();
          return;
        }

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

      if (isClosed) return;

      // If session was active, attempt reconnect
      if (sessionId && !isClosed) {
        attemptReconnect(0);
        return;
      }

      isClosed = true;
      child?.kill();
    });

    socket.on("error", (err) => {
      spinner.fail(`Connection error: ${err.message}`);
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
      child?.kill();
      return;
    }

    const delay = RECONNECT_DELAYS[attempt] ?? 4000;
    const reconnectSpinner = spin(
      `Connection lost. Reconnecting in ${delay}ms (${attempt + 1}/${MAX_RECONNECT_ATTEMPTS})…`
    );

    setTimeout(() => {
      if (isClosed) return;

      reconnectSpinner.update("Reconnecting…");
      const newSocket = connectSocket(true);
      newSocket.on("open", () => {
        currentSocket = newSocket;
      });
      newSocket.on("error", () => {
        reconnectSpinner.fail("Reconnect attempt failed");
        attemptReconnect(attempt + 1);
      });
    }, delay);
  }

  function spawnSharedPty(
    shellPath: string,
    socket: WebSocket,
    sessionCipher: SessionCipher,
    peerName: string
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
      if (socket.readyState !== WebSocket.OPEN) return;

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
        isClosed = true;
        socket.send(
          encodeMessage({
            type: "PTY_EXIT",
            code: signal === 0 ? exitCode : null
          })
        );
        socket.close();
      }
    });

    return ptyChild;
  }
}

async function handleApproval(
  code: string,
  requester: PeerIdentity
): Promise<{ allowed: boolean; reason: string }> {
  const decision = await decideAccess(requester.userId);

  if (decision.action === "allow") {
    process.stderr.write(
      `  ${success(icons.check)} Auto-approved ${primary(requester.userId)} ${dim(`(${requester.deviceName})`)}\r\n`
    );
    return { allowed: true, reason: decision.reason };
  }

  if (decision.action === "deny") {
    process.stderr.write(
      `  ${error(icons.cross)} Auto-rejected ${primary(requester.userId)} ${dim(`(${requester.deviceName})`)}\r\n`
    );
    return { allowed: false, reason: decision.reason };
  }

  // Interactive prompt
  const allowed = await accessPrompt({
    userId: requester.userId,
    deviceName: requester.deviceName,
    code,
    colorIndex: 1,
  });

  return {
    allowed,
    reason: allowed ? "host approved access" : "host rejected access"
  };
}
