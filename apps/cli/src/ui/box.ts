/**
 * Box-drawing frames, dividers, and status bars for terminal UI.
 */

import { dim, primary, bold } from "./theme.js";

// Box-drawing characters
const CORNER_TL = "┌";
const CORNER_TR = "┐";
const CORNER_BL = "└";
const CORNER_BR = "┘";
const HORIZ = "─";
const VERT = "│";

/**
 * Render a bordered box with an optional title.
 *
 * ```
 * ┌─ Title ──────────────────────┐
 * │ Line 1                       │
 * │ Line 2                       │
 * └──────────────────────────────┘
 * ```
 */
export function renderBox(lines: string[], title?: string): string {
  const width = Math.min(process.stdout.columns || 80, 70);
  const innerWidth = width - 4; // 2 border chars + 2 padding

  // Strip ANSI for length calculation
  const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

  // Top border
  let topLine: string;
  if (title) {
    const titleText = ` ${title} `;
    const remaining = width - 2 - stripAnsi(titleText).length; // -2 for corners
    topLine = dim(CORNER_TL + HORIZ) + primary(titleText) + dim(HORIZ.repeat(Math.max(0, remaining)) + CORNER_TR);
  } else {
    topLine = dim(CORNER_TL + HORIZ.repeat(width - 2) + CORNER_TR);
  }

  // Content lines
  const contentLines = lines.map((line) => {
    const visibleLen = stripAnsi(line).length;
    const pad = Math.max(0, innerWidth - visibleLen);
    return `${dim(VERT)} ${line}${" ".repeat(pad)} ${dim(VERT)}`;
  });

  // Bottom border
  const bottomLine = dim(CORNER_BL + HORIZ.repeat(width - 2) + CORNER_BR);

  return [topLine, ...contentLines, bottomLine].join("\r\n");
}

/**
 * Render a horizontal divider with an optional centered label.
 */
export function renderDivider(label?: string): string {
  const width = Math.min(process.stdout.columns || 80, 70);

  if (!label) {
    return dim(HORIZ.repeat(width));
  }

  const labelText = ` ${label} `;
  const sideLen = Math.max(0, Math.floor((width - labelText.length) / 2));
  return dim(HORIZ.repeat(sideLen)) + dim(labelText) + dim(HORIZ.repeat(width - sideLen - labelText.length));
}

/**
 * Render a key-value info line with aligned values.
 */
export function renderInfoLine(label: string, value: string): string {
  return `  ${dim(label + ":")} ${value}`;
}

/**
 * Render a compact status bar.
 */
export function renderStatusBar(left: string, right: string): string {
  const width = Math.min(process.stdout.columns || 80, 70);
  const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

  const leftLen = stripAnsi(left).length;
  const rightLen = stripAnsi(right).length;
  const pad = Math.max(1, width - leftLen - rightLen);

  return `${left}${" ".repeat(pad)}${right}`;
}
