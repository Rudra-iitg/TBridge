import readline from "node:readline/promises";
import process from "node:process";
import pty, { type IPty } from "node-pty";
import WebSocket from "ws";
import {
  decodeMessage,
  encodeMessage,
  type ServerMessage
} from "@t-bridge/protocol";
import { decideAccess } from "../permissions/policy.js";
import { generateShareCode, getDefaultShell } from "./platform.js";

export type ShareTerminalOptions = {
  code?: string;
  serverUrl: string;
  shell?: string;
};

export async function shareTerminal(
  options: ShareTerminalOptions
): Promise<void> {
  const code = options.code ?? generateShareCode();
  const shell = getDefaultShell(options.shell);
  const socket = new WebSocket(options.serverUrl);
  let child: IPty | undefined;
  let isClosed = false;

  socket.on("open", () => {
    socket.send(encodeMessage({ type: "REGISTER_HOST", code }));
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
        const approval = await approveAccess(message.code, message.requesterId);
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
        process.stdout.write(`Guest connected. Sharing shell: ${shell}\n`);
        child = spawnSharedPty(shell, socket);
        return;
      case "PTY_INPUT":
        child?.write(message.data);
        return;
      case "PTY_RESIZE":
        child?.resize(message.cols, message.rows);
        return;
      case "SESSION_TERMINATE":
        child?.kill();
        process.stdout.write(`Session ended: ${message.reason ?? "closed"}\n`);
        socket.close();
        return;
      case "ERROR":
        process.stderr.write(`Relay error: ${message.message}\n`);
        socket.close();
        return;
      default:
        return;
    }
  });

  socket.on("close", () => {
    if (isClosed) {
      return;
    }

    isClosed = true;
    child?.kill();
  });

  socket.on("error", (error) => {
    process.stderr.write(`Relay connection error: ${error.message}\n`);
  });
}

async function approveAccess(
  code: string,
  requesterId: string
): Promise<{ allowed: boolean; reason: string }> {
  const decision = await decideAccess(requesterId);

  if (decision.action === "allow") {
    process.stdout.write(`Auto-approved ${requesterId}: ${decision.reason}\n`);
    return { allowed: true, reason: decision.reason };
  }

  if (decision.action === "deny") {
    process.stdout.write(`Auto-rejected ${requesterId}: ${decision.reason}\n`);
    return { allowed: false, reason: decision.reason };
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    const answer = await rl.question(
      `Guest ${requesterId} wants to connect with code ${code}. Allow? [y/N] `
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

function spawnSharedPty(shell: string, socket: WebSocket): IPty {
  const child = pty.spawn(shell, [], {
    name: process.env.TERM || "xterm-256color",
    cols: 80,
    rows: 24,
    cwd: process.cwd(),
    env: {
      ...process.env,
      TBRIDGE_MODE: "host"
    }
  });

  child.onData((data) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(encodeMessage({ type: "PTY_OUTPUT", data }));
    }
  });

  child.onExit(({ exitCode, signal }) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(
        encodeMessage({
          type: "PTY_EXIT",
          code: signal === 0 ? exitCode : null
        })
      );
    }
  });

  return child;
}
