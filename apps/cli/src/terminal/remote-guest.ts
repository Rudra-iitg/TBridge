import process from "node:process";
import WebSocket from "ws";
import {
  decodeMessage,
  encodeMessage,
  type ServerMessage
} from "@t-bridge/protocol";

export type ConnectToShareOptions = {
  code: string;
  requesterId?: string;
  serverUrl: string;
};

const EXIT_SEQUENCE = "\u001d"; // Ctrl+]

export async function connectToShare(
  options: ConnectToShareOptions
): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("connect mode requires an interactive terminal");
  }

  const socket = new WebSocket(options.serverUrl);
  let isRaw = false;
  let isClosed = false;
  const onInput = (data: Buffer) => {
    if (data.toString("utf8") === EXIT_SEQUENCE) {
      socket.send(
        encodeMessage({
          type: "SESSION_TERMINATE",
          reason: "guest detached"
        })
      );
      socket.close();
      return;
    }

    socket.send(
      encodeMessage({
        type: "PTY_INPUT",
        data: data.toString("binary")
      })
    );
  };
  const onResize = () => {
    sendResize(socket);
  };

  socket.on("open", () => {
    socket.send(
      encodeMessage({
        type: "REGISTER_GUEST",
        code: options.code,
        requesterId: options.requesterId ?? getDefaultRequesterId()
      })
    );
    process.stdout.write(`Requesting access for ${options.code}...\n`);
  });

  socket.on("message", (data) => {
    const message = decodeMessage(data) as ServerMessage;

    switch (message.type) {
      case "SESSION_READY":
        process.stdout.write("\x1b[36mRemote session ready\x1b[0m\r\n");
        enableRawInput(onInput);
        isRaw = true;
        sendResize(socket);
        return;
      case "ACCESS_REJECTED":
        process.stderr.write(`Access rejected: ${message.reason}\n`);
        socket.close();
        return;
      case "PTY_OUTPUT":
        process.stdout.write(message.data);
        return;
      case "PTY_EXIT":
        process.stdout.write(`\r\nRemote shell exited (${message.code}).\r\n`);
        socket.close();
        return;
      case "SESSION_TERMINATE":
        process.stdout.write(`\r\nSession ended: ${message.reason ?? "closed"}\r\n`);
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
    if (isRaw) {
      process.stdin.off("data", onInput);
      process.stdout.off("resize", onResize);
      process.stdin.setRawMode(false);
      process.stdin.pause();
    }
  });

  socket.on("error", (error) => {
    process.stderr.write(`Relay connection error: ${error.message}\n`);
  });

  process.stdout.on("resize", onResize);
}

function getDefaultRequesterId(): string {
  return process.env.TBRIDGE_USER_ID || process.env.USER || "anonymous";
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
