/**
 * Live status bar rendered at the bottom of the terminal during a session.
 */

import { dim, success, warning, error, accent, userColor, bold, primary } from "./theme.js";

export type ConnectionState = "disconnected" | "connecting" | "connected";

export type StatusInfo = {
  state: ConnectionState;
  peerName?: string;
  peerColorIndex?: number;
  encrypted: boolean;
  sessionStartMs?: number;
};

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;

  if (min === 0) {
    return `${sec}s`;
  }

  return `${min}m ${sec.toString().padStart(2, "0")}s`;
}

function stateIndicator(state: ConnectionState): string {
  switch (state) {
    case "connected":
      return success("●");
    case "connecting":
      return warning("◌");
    case "disconnected":
      return error("○");
  }
}

function stateLabel(info: StatusInfo): string {
  switch (info.state) {
    case "connected": {
      const peer = info.peerName
        ? userColor(info.peerName, info.peerColorIndex ?? 1)
        : "peer";
      return `Connected to ${peer}`;
    }
    case "connecting":
      return warning("Connecting…");
    case "disconnected":
      return dim("Disconnected");
  }
}

/**
 * Render a single-line status bar.
 */
export function renderStatus(info: StatusInfo): string {
  const parts: string[] = [];

  // Connection state
  parts.push(`${stateIndicator(info.state)} ${stateLabel(info)}`);

  // Encryption
  if (info.encrypted) {
    parts.push(accent("🔒 E2E"));
  }

  // Duration
  if (info.sessionStartMs) {
    const elapsed = Date.now() - info.sessionStartMs;
    parts.push(dim(formatDuration(elapsed)));
  }

  return parts.join(dim("  ·  "));
}

/**
 * Render the session connection box shown when peers connect.
 */
export function renderSessionBox(info: StatusInfo & { deviceName?: string }): string {
  const width = Math.min(process.stdout.columns || 80, 56);

  const lines: string[] = [];
  const bar = dim("─".repeat(width));

  lines.push("");
  lines.push(`  ${stateIndicator(info.state)} ${stateLabel(info)}${info.deviceName ? " " + dim(`(${info.deviceName})`) : ""}`);

  if (info.encrypted) {
    lines.push(`  ${accent("🔒 End-to-end encrypted")}`);
  }

  lines.push(`  ${dim("Ctrl+]")} ${dim("exit")}  ${dim("·")}  ${dim("Type commands to run on peer's terminal")}`);
  lines.push("");

  return bar + "\r\n" + lines.join("\r\n") + bar;
}
