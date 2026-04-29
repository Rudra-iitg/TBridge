#!/usr/bin/env node
import { Command } from "commander";
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

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`tbridge: ${message}\n`);
  process.exitCode = 1;
});
