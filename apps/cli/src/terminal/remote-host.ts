import readline from "node:readline/promises";
import process from "node:process";
import pty, { type IPty } from "node-pty";
import WebSocket from "ws";
import {
  decodeMessage,
  encodeMessage,
  type ServerMessage
} from "@t-bridge/protocol";
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

  socket.on("open", () => {
    socket.send(encodeMessage({ type: "REGISTER_HOST", code }));
  });

  socket.on("message", async (data) => {
    const message = decodeMessage(data) as ServerMessage;

    switch (message.type) {
      case "HOST_REGISTERED":
        process.stdout.write(
          `T-Bridge share code: ${message.code}\nWaiting for guest on ${options.serverUrl}\n`
        );
        return;
      case "ACCESS_REQUEST":
        if (await approveAccess(message.code)) {
          socket.send(encodeMessage({ type: "ACCESS_APPROVED" }));
        } else {
          socket.send(
            encodeMessage({
              type: "ACCESS_REJECTED",
              reason: "host rejected access"
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
    child?.kill();
  });

  socket.on("error", (error) => {
    process.stderr.write(`Relay connection error: ${error.message}\n`);
  });
}

async function approveAccess(code: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    const answer = await rl.question(
      `Guest wants to connect with code ${code}. Allow? [y/N] `
    );
    return answer.trim().toLowerCase() === "y";
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
