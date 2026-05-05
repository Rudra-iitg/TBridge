/**
 * T-Bridge ASCII art banner displayed on CLI startup.
 */

import { gradient, dim, primary, bold, accent, icons } from "./theme.js";

const LOGO = [
  "  ████████╗      ██████╗  ██████╗ ██╗██████╗  ██████╗ ███████╗",
  "  ╚══██╔══╝      ██╔══██╗██╔══██╗██║██╔══██╗██╔════╝ ██╔════╝",
  "     ██║   █████╗██████╔╝██████╔╝██║██║  ██║██║  ███╗█████╗  ",
  "     ██║   ╚════╝██╔══██╗██╔══██╗██║██║  ██║██║   ██║██╔══╝  ",
  "     ██║         ██████╔╝██║  ██║██║██████╔╝╚██████╔╝███████╗",
  "     ╚═╝         ╚═════╝ ╚═╝  ╚═╝╚═╝╚═════╝  ╚═════╝ ╚══════╝",
];

const FROM = { r: 0, g: 210, b: 255 };
const TO = { r: 189, g: 147, b: 249 };

/**
 * Render the startup banner with gradient logo and context info.
 */
export function renderBanner(opts: {
  version: string;
  userId?: string;
  deviceName?: string;
}): string {
  const lines: string[] = [];

  lines.push("");

  // Gradient logo
  for (const line of LOGO) {
    lines.push(gradient(line, FROM, TO));
  }

  lines.push("");
  lines.push(
    `  ${dim("v" + opts.version)}  ${dim(icons.dot)}  ${accent("Secure terminal sharing")}  ${dim(icons.dot)}  ${dim("E2E encrypted")}`
  );

  if (opts.userId) {
    lines.push(
      `  ${dim("Logged in as")} ${primary(opts.userId)}${opts.deviceName ? dim(` on ${opts.deviceName}`) : ""}`
    );
  }

  lines.push("");

  return lines.join("\r\n");
}

/**
 * Render a compact one-line header (used after initial banner).
 */
export function renderHeader(label: string): string {
  const width = Math.min(process.stdout.columns || 80, 70);
  const line = "─".repeat(width);
  return `${dim(line)}\r\n  ${bold(label)}\r\n${dim(line)}`;
}
