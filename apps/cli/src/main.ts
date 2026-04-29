#!/usr/bin/env node
import { Command } from "commander";
import { connectToShare } from "./terminal/remote-guest.js";
import {
  allowUser,
  denyUser,
  forgetUser,
  showPolicy
} from "./permissions/commands.js";
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
  .option("-u, --user <id>", "local requester id")
  .action(async (code: string, options: { server: string; user?: string }) => {
    await connectToShare({
      code,
      requesterId: options.user,
      serverUrl: options.server
    });
  });

program
  .command("allow <user-id>")
  .description("Trust a requester for future active shares on this machine")
  .action(async (userId: string) => {
    await allowUser(userId);
  });

program
  .command("deny <user-id>")
  .description("Block a requester from using shared terminals on this machine")
  .action(async (userId: string) => {
    await denyUser(userId);
  });

program
  .command("forget <user-id>")
  .description("Remove a requester from local allow/deny policy")
  .action(async (userId: string) => {
    await forgetUser(userId);
  });

program
  .command("policy")
  .description("Show local terminal sharing policy")
  .action(async () => {
    await showPolicy();
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`tbridge: ${message}\n`);
  process.exitCode = 1;
});
