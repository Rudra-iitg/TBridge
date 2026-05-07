#!/usr/bin/env node
/**
 * TBridge v2 — Collaborative Terminal Workspace
 *
 * A single command launches the full-screen TUI.
 * No subcommands, no flags, no multiple terminals.
 *
 *   $ tbridge
 *
 * Once inside, use:
 *   Ctrl+B, N    — new terminal pane
 *   Ctrl+B, W    — close current pane
 *   Ctrl+B, ←/→  — switch panes
 *   Ctrl+B, S    — toggle sidebar
 *   Ctrl+B, Q    — quit
 *   /            — enter command mode
 *   Ctrl+P       — command palette (coming soon)
 */

import { App } from "@tbridge/tui";

async function main(): Promise<void> {
  const app = new App({
    userId: process.env.TBRIDGE_USER ?? process.env.USER,
    deviceName: process.env.TBRIDGE_DEVICE,
    shell: process.env.SHELL,
  });

  await app.start();
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`\x1b[31m✗\x1b[0m TBridge fatal: ${message}\n`);
  process.exitCode = 1;
});
