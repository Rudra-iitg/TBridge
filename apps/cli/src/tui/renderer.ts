/**
 * Low-level terminal rendering helpers for the TUI.
 */

import process from "node:process";

export function clearScreen(): void {
  process.stdout.write("\x1b[2J\x1b[H");
}

export function moveTo(row: number, col: number): void {
  process.stdout.write(`\x1b[${row};${col}H`);
}

export function hideCursor(): void {
  process.stdout.write("\x1b[?25l");
}

export function showCursor(): void {
  process.stdout.write("\x1b[?25h");
}

export function eraseLine(): void {
  process.stdout.write("\x1b[2K");
}

export function write(text: string): void {
  process.stdout.write(text);
}

export function writeLine(text: string): void {
  process.stdout.write(text + "\r\n");
}

export function getTermSize(): { cols: number; rows: number } {
  return {
    cols: process.stdout.columns || 80,
    rows: process.stdout.rows || 24,
  };
}

/**
 * Center a line of text horizontally.
 */
export function center(text: string, width?: number): string {
  const w = width ?? getTermSize().cols;
  const stripped = text.replace(/\x1b\[[0-9;]*m/g, "");
  const pad = Math.max(0, Math.floor((w - stripped.length) / 2));
  return " ".repeat(pad) + text;
}
