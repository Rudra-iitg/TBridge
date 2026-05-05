/**
 * Styled interactive prompts for terminal input.
 */

import readline from "node:readline/promises";
import process from "node:process";
import { primary, dim, success, error, bold, userColor } from "./theme.js";

/**
 * Ask a styled yes/no confirmation question.
 * Returns true if the user answers 'y' or 'yes'.
 */
export async function confirm(message: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  try {
    const hint = `${dim("[")}${success("y")}${dim("/")}${error("N")}${dim("]")}`;
    const answer = await rl.question(`  ${primary("?")} ${message} ${hint} `);
    return answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
  } finally {
    rl.close();
  }
}

/**
 * Ask a styled question and return the text answer.
 */
export async function ask(message: string, defaultValue?: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  try {
    const hint = defaultValue ? dim(` (${defaultValue})`) : "";
    const answer = await rl.question(`  ${primary("?")} ${message}${hint} `);
    return answer.trim() || defaultValue || "";
  } finally {
    rl.close();
  }
}

/**
 * Display a styled access request prompt showing peer identity.
 */
export async function accessPrompt(opts: {
  userId: string;
  deviceName: string;
  code: string;
  colorIndex: number;
}): Promise<boolean> {
  const peerName = userColor(opts.userId, opts.colorIndex);
  const device = dim(`(${opts.deviceName})`);
  const code = bold(opts.code);

  process.stderr.write(`\r\n`);
  process.stderr.write(`  ${primary("▸")} ${peerName} ${device} wants to connect\r\n`);
  process.stderr.write(`  ${dim("  Share code:")} ${code}\r\n`);

  return confirm("Allow access?");
}
