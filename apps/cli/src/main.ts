#!/usr/bin/env node
import { Command } from "commander";
import { login, logout, showIdentity } from "./identity/commands.js";
import { connectToShare } from "./terminal/remote-guest.js";
import {
  allowUser,
  denyUser,
  forgetUser,
  showPolicy
} from "./permissions/commands.js";
import { shareTerminal } from "./terminal/remote-host.js";
import { runLocalPty } from "./terminal/local-pty.js";
import { launchApp } from "./tui/app.js";
import { gradient, dim, primary, bold } from "./ui/theme.js";

const LOGO_COMPACT = "  ▀█▀ ─ █▄▄ █▀█ █ █▀▄ █▀▀ █▀▀";
const FROM = { r: 0, g: 210, b: 255 };
const TO = { r: 189, g: 147, b: 249 };

// If no subcommand given, launch the interactive TUI
const args = process.argv.slice(2);
const hasSubcommand = args.length > 0 && !args[0]!.startsWith("-");

if (!hasSubcommand) {
  launchApp().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`  \x1b[31m✗\x1b[0m ${message}\n`);
    process.exitCode = 1;
  });
} else {
  // Commander-based subcommands (advanced / scripting)
  const program = new Command();

  program
    .name("tbridge")
    .description(
      gradient(LOGO_COMPACT, FROM, TO) +
      "\n" +
      dim("  Secure terminal sharing · E2E encrypted · Zero config") +
      "\n"
    )
    .version("0.1.0");

  // ── Identity ───────────────────────────────────────────────────────

  program
    .command("login")
    .description("Create or replace the local identity")
    .option("-u, --user <id>", "local user id")
    .option("-d, --device-name <name>", "local device display name")
    .action(async (options: { deviceName?: string; user?: string }) => {
      await login({
        deviceName: options.deviceName,
        userId: options.user
      });
    });

  program
    .command("identity")
    .description("Show the local identity (no private key)")
    .action(async () => {
      await showIdentity();
    });

  program
    .command("logout")
    .description("Remove the local identity")
    .action(async () => {
      await logout();
    });

  // ── Terminal ───────────────────────────────────────────────────────

  program
    .command("local")
    .description("Run a local PTY prototype (no network)")
    .option("-s, --shell <path>", "shell to launch")
    .action(async (options: { shell?: string }) => {
      await runLocalPty({ shell: options.shell });
    });

  program
    .command("share")
    .description("Share your terminal with a peer")
    .option("-s, --shell <path>", "shell to launch")
    .option("-c, --code <code>", "custom share code")
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
    .description("Connect to a shared terminal")
    .option("--server <url>", "relay WebSocket URL", "ws://localhost:8787")
    .option("-u, --user <id>", "override local user id")
    .action(async (code: string, options: { server: string; user?: string }) => {
      await connectToShare({
        code,
        requesterId: options.user,
        serverUrl: options.server
      });
    });

  // ── Permissions ────────────────────────────────────────────────────

  program
    .command("allow <user-id>")
    .description("Trust a user for future connections")
    .action(async (userId: string) => {
      await allowUser(userId);
    });

  program
    .command("deny <user-id>")
    .description("Block a user from connecting")
    .action(async (userId: string) => {
      await denyUser(userId);
    });

  program
    .command("forget <user-id>")
    .description("Remove a user from the policy")
    .action(async (userId: string) => {
      await forgetUser(userId);
    });

  program
    .command("policy")
    .description("Show the local access policy")
    .action(async () => {
      await showPolicy();
    });

  program.parseAsync(process.argv).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`  \x1b[31m✗\x1b[0m ${message}\n`);
    process.exitCode = 1;
  });
}
