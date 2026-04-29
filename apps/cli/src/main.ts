#!/usr/bin/env node
import { Command } from "commander";
import { connectToShare } from "./terminal/remote-guest.js";
import { shareTerminal } from "./terminal/remote-host.js";
import { runLocalPty } from "./terminal/local-pty.js";

const program = new Command();

program
  .name("tbridge")
  .description("T-Bridge secure terminal sharing CLI")
  .version("0.1.0");

program
  .command("local")
  .description("Run the Phase 1 local PTY prototype")
  .option("-s, --shell <path>", "shell to launch")
  .action(async (options: { shell?: string }) => {
    await runLocalPty({ shell: options.shell });
  });

program
  .command("share")
  .description("Share a local PTY through a T-Bridge relay")
  .option("-s, --shell <path>", "shell to launch")
  .option("-c, --code <code>", "share code to register")
  .option("--server <url>", "relay WebSocket URL", "ws://localhost:8787")
  .action(async (options: { shell?: string; code?: string; server: string }) => {
    await shareTerminal({
      shell: options.shell,
      code: options.code,
      serverUrl: options.server
    });
  });

program
  .command("connect <code>")
  .description("Connect to a shared PTY through a T-Bridge relay")
  .option("--server <url>", "relay WebSocket URL", "ws://localhost:8787")
  .action(async (code: string, options: { server: string }) => {
    await connectToShare({
      code,
      serverUrl: options.server
    });
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`tbridge: ${message}\n`);
  process.exitCode = 1;
});
