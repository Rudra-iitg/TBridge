import os from "node:os";
import process from "node:process";

export function getDefaultShell(shell?: string): string {
  if (shell) {
    return shell;
  }

  if (process.env.SHELL) {
    return process.env.SHELL;
  }

  if (os.platform() === "win32") {
    return process.env.ComSpec || "powershell.exe";
  }

  return "/bin/sh";
}

export function generateShareCode(): string {
  const first = Math.floor(100 + Math.random() * 900);
  const second = Math.floor(100 + Math.random() * 900);
  return `${first}-${second}`;
}
