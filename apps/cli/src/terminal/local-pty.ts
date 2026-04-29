import os from "node:os";
import process from "node:process";
import pty from "node-pty";
import { getDefaultShell } from "./platform.js";

export type LocalPtyOptions = {
  shell?: string;
};

const EXIT_SEQUENCE = "\u001d"; // Ctrl+]

export async function runLocalPty(options: LocalPtyOptions): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("local PTY mode requires an interactive terminal");
  }

  const shell = getDefaultShell(options.shell);
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;
  let isExiting = false;

  process.stdout.write(
    [
      "\x1b[36mT-Bridge local PTY prototype\x1b[0m",
      `shell: ${shell}`,
      "Ctrl+] exits the prototype. Ctrl+C is forwarded to the shell.",
      ""
    ].join("\r\n")
  );

  const child = pty.spawn(shell, [], {
    name: process.env.TERM || "xterm-256color",
    cols,
    rows,
    cwd: process.cwd(),
    env: {
      ...process.env,
      TBRIDGE_MODE: "local"
    }
  });

  const cleanup = () => {
    if (isExiting) {
      return;
    }

    isExiting = true;
    process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdout.write("\r\n\x1b[36mT-Bridge local PTY closed\x1b[0m\r\n");
  };

  const exit = () => {
    cleanup();
    child.kill();
  };

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("data", (data: Buffer) => {
    if (data.toString("utf8") === EXIT_SEQUENCE) {
      exit();
      return;
    }

    child.write(data.toString("binary"));
  });

  process.stdout.on("resize", () => {
    child.resize(process.stdout.columns || 80, process.stdout.rows || 24);
  });

  child.onData((data) => {
    process.stdout.write(data);
  });

  child.onExit(({ exitCode, signal }) => {
    cleanup();
    if (exitCode !== 0 && signal === 0) {
      process.exitCode = exitCode;
    }
  });

  process.once("SIGINT", () => {
    child.write("\u0003");
  });

  process.once("SIGTERM", exit);
}
