/**
 * T-Bridge Interactive TUI — full-screen terminal application.
 *
 * Flow: Welcome → Create/Join → Connected Session
 */

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
  type SessionCipher
} from "@tbridge/crypto";
import {
  loadOrCreateIdentity,
  publicIdentity,
  type LocalIdentity
} from "../identity/identity-store.js";
import { decideAccess } from "../permissions/policy.js";
import { generateShareCode, getDefaultShell } from "../terminal/platform.js";
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
  icons,
  renderBox,
  renderDivider,
  type Spinner,
} from "../ui/index.js";
import { clearScreen, writeLine, write, showCursor, hideCursor } from "./renderer.js";
import { selectMenu, textInput } from "./input.js";

const RELAY_URL = "ws://localhost:8787";
const BACKPRESSURE_HIGH = 64 * 1024;

// ───────────────────────────────────────────────────────────────────
// Entry point
// ───────────────────────────────────────────────────────────────────

export async function launchApp(): Promise<void> {
  const identity = await loadOrCreateIdentity();

  clearScreen();
  write(
    renderBanner({
      version: "0.1.0",
      userId: identity.userId,
      deviceName: identity.deviceName,
    })
  );

  writeLine("");

  const choice = await selectMenu(
    [
      "Create Session — share your terminal",
      "Join Session   — connect to a peer",
      "Exit",
    ],
    { title: bold("What would you like to do?") }
  );

  writeLine("");

  switch (choice) {
    case 0:
      await createSessionFlow(identity);
      break;
    case 1:
      await joinSessionFlow(identity);
      break;
    default:
      showCursor();
      process.exit(0);
  }
}

// ───────────────────────────────────────────────────────────────────
// Create Session
// ───────────────────────────────────────────────────────────────────

async function createSessionFlow(identity: LocalIdentity): Promise<void> {
  const code = generateShareCode();
  const shell = getDefaultShell();

  // Auto-start relay
  const spinner = spin("Starting relay…");
  let embeddedRelay: ChildProcess | undefined;

  const alive = await isRelayReachable(RELAY_URL);
  if (!alive) {
    embeddedRelay = await startRelay(RELAY_URL);
  }
  spinner.succeed("Relay ready");

  // Connect and register
  const regSpinner = spin("Registering session…");
  const socket = new WebSocket(RELAY_URL);

  await new Promise<void>((resolve, reject) => {
    socket.on("open", () => {
      socket.send(
        encodeMessage({
          type: "REGISTER_HOST",
          code,
          identity: publicIdentity(identity),
        })
      );
    });

    socket.on("message", (data) => {
      const msg = decodeMessage(data) as ServerMessage;
      if (msg.type === "HOST_REGISTERED") {
        regSpinner.succeed("Session created");
        resolve();
      } else if (msg.type === "ERROR") {
        regSpinner.fail(msg.message);
        reject(new Error(msg.message));
      }
    });

    socket.on("error", (err) => {
      regSpinner.fail(err.message);
      reject(err);
    });
  });

  // Show the session key
  writeLine("");
  write(
    renderBox(
      [
        `${bold("Share this key with your peer:")}`,
        "",
        `     ${primary("⬤")}  ${bold(code)}  ${primary("⬤")}`,
        "",
        `${dim("They run")} ${bold("tbridge")} ${dim("→ Join Session → enter this key")}`,
      ],
      `Session Key`
    )
  );
  writeLine("\r\n");

  const waitSpinner = spin("Waiting for peer to join…");

  // Wait for guest + handle approval + key exchange + role selection + session
  await runHostSession(socket, identity, shell, waitSpinner, embeddedRelay);
}

// ───────────────────────────────────────────────────────────────────
// Join Session
// ───────────────────────────────────────────────────────────────────

async function joinSessionFlow(identity: LocalIdentity): Promise<void> {
  const code = await textInput("Enter the session key:");

  if (!code.trim()) {
    writeLine(`  ${error(icons.cross)} No key provided.`);
    process.exit(1);
  }

  const spinner = spin("Connecting…");
  const socket = new WebSocket(RELAY_URL);

  socket.on("open", () => {
    spinner.update("Requesting access…");
    socket.send(
      encodeMessage({
        type: "REGISTER_GUEST",
        code: code.trim(),
        identity: publicIdentity(identity),
      })
    );
  });

  socket.on("error", (err) => {
    spinner.fail(`Connection failed: ${err.message}`);
    process.exit(1);
  });

  // Wait for session + key exchange + role selection + session
  await runGuestSession(socket, identity, spinner);
}

// ───────────────────────────────────────────────────────────────────
// Host session handler
// ───────────────────────────────────────────────────────────────────

async function runHostSession(
  socket: WebSocket,
  identity: LocalIdentity,
  shell: string,
  waitSpinner: Spinner,
  embeddedRelay?: ChildProcess
): Promise<void> {
  let peerIdentity: PeerIdentity | undefined;
  let cipher: SessionCipher | undefined;
  let child: IPty | undefined;
  let sessionId: string | undefined;

  return new Promise<void>((resolve) => {
    socket.on("message", async (data) => {
      const msg = decodeMessage(data) as ServerMessage;

      switch (msg.type) {
        case "ACCESS_REQUEST": {
          waitSpinner.info(`${primary(msg.requester.userId)} ${dim(`(${msg.requester.deviceName})`)} wants to connect`);

          // Check policy
          const decision = await decideAccess(msg.requester.userId);
          if (decision.action === "deny") {
            writeLine(`  ${error(icons.cross)} Auto-rejected: ${decision.reason}`);
            socket.send(encodeMessage({ type: "ACCESS_REJECTED", reason: decision.reason }));
            return;
          }

          if (decision.action === "ask") {
            writeLine("");
            const choice = await selectMenu(
              ["Allow — let them connect", "Deny  — reject this request"],
              { title: `${primary(msg.requester.userId)} wants to connect. Allow?` }
            );

            if (choice === 1) {
              socket.send(encodeMessage({ type: "ACCESS_REJECTED", reason: "host rejected" }));
              writeLine(`  ${error(icons.cross)} Access denied.`);
              return;
            }
          } else {
            writeLine(`  ${success(icons.check)} Auto-approved: ${decision.reason}`);
          }

          socket.send(encodeMessage({ type: "ACCESS_APPROVED" }));
          return;
        }

        case "SESSION_READY": {
          sessionId = msg.sessionId;

          const keySpinner = spin("Establishing E2E encryption…");
          const ephemeral = generateEphemeralKeyPair();

          socket.send(
            encodeMessage({
              type: "KEY_EXCHANGE",
              ephemeralPublicKey: ephemeral.publicKey.toString("base64"),
            })
          );

          // Store for later
          (socket as any).__ephemeral = ephemeral;
          (socket as any).__keySpinner = keySpinner;
          return;
        }

        case "SESSION_INFO": {
          peerIdentity = msg.peerIdentity;
          return;
        }

        case "KEY_EXCHANGE": {
          const ephemeral = (socket as any).__ephemeral;
          const keySpinner: Spinner = (socket as any).__keySpinner;
          if (!ephemeral) return;

          const peerPub = Buffer.from(msg.ephemeralPublicKey, "base64");
          cipher = createSessionCipher(ephemeral.privateKey, peerPub, "host");
          keySpinner.succeed("E2E encryption established");

          // Role selection
          writeLine("");
          const roleChoice = await selectMenu(
            [
              "Both Admin   — both can run commands on each other's terminal",
              "You Admin    — only you can run commands on their terminal",
              "They Admin   — only they can run commands on your terminal",
            ],
            { title: bold("Select session mode:") }
          );

          const roleMap = ["both", "self", "peer"] as const;
          const role = roleMap[roleChoice] ?? "both";

          // Notify peer of role assignment
          if (cipher) {
            const roleMsg = JSON.stringify({ roleAssign: role });
            const enc = cipher.encrypt(roleMsg);
            socket.send(encodeMessage({ type: "ENCRYPTED_DATA", ciphertext: enc.ciphertext, nonce: enc.nonce }));
          }

          // Show connected session
          const peerName = peerIdentity?.userId ?? "peer";
          writeLine("");
          write(
            renderSessionBox({
              state: "connected",
              peerName,
              peerColorIndex: 1,
              encrypted: true,
              sessionStartMs: Date.now(),
              deviceName: peerIdentity?.deviceName,
            })
          );
          writeLine("\r\n");

          const adminLabel = role === "both"
            ? accent("Both Admin")
            : role === "self"
              ? success("You Admin")
              : dim("They Admin");
          writeLine(`  ${icons.terminal} Mode: ${adminLabel}\r\n`);

          // Spawn PTY for the peer to use
          child = pty.spawn(shell, [], {
            name: process.env.TERM || "xterm-256color",
            cols: process.stdout.columns || 80,
            rows: process.stdout.rows || 24,
            cwd: process.cwd(),
            env: { ...process.env, TBRIDGE_MODE: "host" },
          });

          child.onData((ptyData) => {
            if (!cipher || socket.readyState !== WebSocket.OPEN) return;
            if (socket.bufferedAmount > BACKPRESSURE_HIGH) return;
            const enc = cipher.encrypt(ptyData);
            socket.send(encodeMessage({ type: "ENCRYPTED_DATA", ciphertext: enc.ciphertext, nonce: enc.nonce }));
          });

          child.onExit(({ exitCode }) => {
            socket.send(encodeMessage({ type: "PTY_EXIT", code: exitCode }));
          });

          // If we are admin or both, enable stdin → peer
          if (role !== "peer") {
            enableRawStdin(socket, cipher, child);
          } else {
            writeLine(dim("  (Read-only mode — peer is admin)\r\n"));
          }
          return;
        }

        case "ENCRYPTED_DATA": {
          if (!cipher) return;
          try {
            const plain = cipher.decrypt({ ciphertext: msg.ciphertext, nonce: msg.nonce });

            // Check for role assignment message (JSON with roleAssign key)
            if (plain.startsWith("{") && plain.includes("roleAssign")) {
              return; // Already handled
            }

            // Peer is sending input to our PTY
            child?.write(plain);
          } catch {}
          return;
        }

        case "PTY_RESIZE": {
          child?.resize(msg.cols, msg.rows);
          return;
        }

        case "SESSION_TERMINATE": {
          writeLine(`\r\n  ${dim(icons.dash.repeat(50))}`);
          writeLine(`  ${error(icons.cross)} Session ended: ${msg.reason ?? "peer disconnected"}`);
          cleanup();
          resolve();
          return;
        }

        case "ERROR": {
          writeLine(`  ${error(icons.cross)} ${msg.message}`);
          cleanup();
          resolve();
          return;
        }
      }
    });

    socket.on("close", () => {
      cleanup();
      resolve();
    });

    function cleanup(): void {
      child?.kill();
      embeddedRelay?.kill();
      showCursor();
      process.stdin.setRawMode(false);
      process.stdin.pause();
    }
  });
}

// ───────────────────────────────────────────────────────────────────
// Guest session handler
// ───────────────────────────────────────────────────────────────────

async function runGuestSession(
  socket: WebSocket,
  identity: LocalIdentity,
  spinner: Spinner
): Promise<void> {
  let cipher: SessionCipher | undefined;
  let peerIdentity: PeerIdentity | undefined;
  let adminRole: string = "both";

  return new Promise<void>((resolve) => {
    socket.on("message", async (data) => {
      const msg = decodeMessage(data) as ServerMessage;

      switch (msg.type) {
        case "ACCESS_REJECTED": {
          spinner.fail(`Access rejected: ${msg.reason}`);
          resolve();
          return;
        }

        case "SESSION_READY": {
          spinner.succeed("Access approved");
          const keySpinner = spin("Establishing E2E encryption…");

          const ephemeral = generateEphemeralKeyPair();
          socket.send(
            encodeMessage({
              type: "KEY_EXCHANGE",
              ephemeralPublicKey: ephemeral.publicKey.toString("base64"),
            })
          );

          (socket as any).__ephemeral = ephemeral;
          (socket as any).__keySpinner = keySpinner;

          // Enable raw mode for PTY interaction
          process.stdin.setRawMode(true);
          process.stdin.resume();

          // Send terminal size
          socket.send(
            encodeMessage({
              type: "PTY_RESIZE",
              cols: process.stdout.columns || 80,
              rows: process.stdout.rows || 24,
            })
          );
          return;
        }

        case "SESSION_INFO": {
          peerIdentity = msg.peerIdentity;
          return;
        }

        case "KEY_EXCHANGE": {
          const ephemeral = (socket as any).__ephemeral;
          const keySpinner: Spinner = (socket as any).__keySpinner;
          if (!ephemeral) return;

          const peerPub = Buffer.from(msg.ephemeralPublicKey, "base64");
          cipher = createSessionCipher(ephemeral.privateKey, peerPub, "guest");
          keySpinner.succeed("E2E encryption established");

          writeLine(`\r\n  ${dim("Waiting for host to select session mode…")}`);
          return;
        }

        case "ENCRYPTED_DATA": {
          if (!cipher) return;
          try {
            const plain = cipher.decrypt({ ciphertext: msg.ciphertext, nonce: msg.nonce });

            // Check for role assignment
            if (plain.startsWith("{") && plain.includes("roleAssign")) {
              const parsed = JSON.parse(plain);
              adminRole = parsed.roleAssign;

              // Determine guest's perspective
              const peerName = peerIdentity?.userId ?? "host";
              writeLine("");
              write(
                renderSessionBox({
                  state: "connected",
                  peerName,
                  peerColorIndex: 1,
                  encrypted: true,
                  sessionStartMs: Date.now(),
                  deviceName: peerIdentity?.deviceName,
                })
              );
              writeLine("\r\n");

              const guestRole = adminRole === "both" ? "both"
                : adminRole === "self" ? "peer"   // host is admin → guest is viewer
                : "self";                          // peer is admin → guest is admin

              const adminLabel = guestRole === "both"
                ? accent("Both Admin")
                : guestRole === "self"
                  ? success("You Admin")
                  : dim("They Admin");
              writeLine(`  ${icons.terminal} Mode: ${adminLabel}\r\n`);

              // Set up stdin forwarding if guest has admin rights
              if (guestRole !== "peer") {
                setupGuestInput(socket, cipher);
              } else {
                writeLine(dim("  (Read-only mode — host is admin)\r\n"));
              }
              return;
            }

            // PTY output from host
            process.stdout.write(plain);
          } catch {}
          return;
        }

        case "PTY_EXIT": {
          writeLine(`\r\n  ${dim("Remote shell exited")} ${dim(`(${msg.code})`)}`);
          cleanup();
          resolve();
          return;
        }

        case "SESSION_TERMINATE": {
          writeLine(`\r\n  ${dim(icons.dash.repeat(50))}`);
          writeLine(`  ${error(icons.cross)} Session ended: ${msg.reason ?? "closed"}`);
          cleanup();
          resolve();
          return;
        }

        case "ERROR": {
          spinner.fail(msg.message);
          cleanup();
          resolve();
          return;
        }
      }
    });

    socket.on("close", () => {
      cleanup();
      resolve();
    });

    function cleanup(): void {
      showCursor();
      try {
        process.stdin.setRawMode(false);
        process.stdin.pause();
      } catch {}
    }
  });
}

// ───────────────────────────────────────────────────────────────────
// Input helpers
// ───────────────────────────────────────────────────────────────────

function enableRawStdin(socket: WebSocket, cipher: SessionCipher, child?: IPty): void {
  process.stdin.setRawMode(true);
  process.stdin.resume();

  process.stdin.on("data", (data: Buffer) => {
    const key = data.toString("utf8");

    // Ctrl+] exits
    if (key === "\u001d") {
      socket.send(encodeMessage({ type: "SESSION_TERMINATE", reason: "host detached" }));
      socket.close();
      return;
    }

    // Write to local PTY (so host also sees their own commands)
    child?.write(data.toString("binary"));
  });

  process.stdout.on("resize", () => {
    child?.resize(process.stdout.columns || 80, process.stdout.rows || 24);
  });
}

function setupGuestInput(socket: WebSocket, cipher: SessionCipher): void {
  process.stdin.on("data", (data: Buffer) => {
    const key = data.toString("utf8");

    // Ctrl+] exits
    if (key === "\u001d") {
      socket.send(encodeMessage({ type: "SESSION_TERMINATE", reason: "guest detached" }));
      socket.close();
      return;
    }

    if (socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > BACKPRESSURE_HIGH) return;

    const enc = cipher.encrypt(data.toString("binary"));
    socket.send(
      encodeMessage({ type: "ENCRYPTED_DATA", ciphertext: enc.ciphertext, nonce: enc.nonce })
    );
  });

  process.stdout.on("resize", () => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(
        encodeMessage({
          type: "PTY_RESIZE",
          cols: process.stdout.columns || 80,
          rows: process.stdout.rows || 24,
        })
      );
    }
  });
}

// ───────────────────────────────────────────────────────────────────
// Embedded relay helpers
// ───────────────────────────────────────────────────────────────────

function isRelayReachable(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => { ws.close(); resolve(false); }, 1500);
    ws.on("open", () => { clearTimeout(timer); ws.close(); resolve(true); });
    ws.on("error", () => { clearTimeout(timer); resolve(false); });
  });
}

async function startRelay(url: string): Promise<ChildProcess> {
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  const serverEntry = path.resolve(thisDir, "../../../server/src/main.ts");
  const parsed = new URL(url.replace("ws://", "http://").replace("wss://", "https://"));

  const child = spawn("npx", ["tsx", serverEntry], {
    env: { ...process.env, PORT: parsed.port || "8787", HOST: parsed.hostname || "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  const kill = () => { try { child.kill(); } catch {} };
  process.on("exit", kill);
  process.on("SIGINT", kill);
  process.on("SIGTERM", kill);

  // Wait until reachable
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 200));
    if (await isRelayReachable(url)) return child;
  }
  throw new Error("relay did not start");
}
