/**
 * Interactive menu and text input for the TUI.
 */

import process from "node:process";
import { primary, dim, bold, success, error } from "../ui/theme.js";
import { eraseLine, write, writeLine, showCursor, hideCursor } from "./renderer.js";

/**
 * Show an arrow-key navigable menu. Returns the selected index.
 */
export function selectMenu(
  items: string[],
  opts?: { title?: string }
): Promise<number> {
  return new Promise((resolve) => {
    let selected = 0;
    const wasRaw = process.stdin.isRaw;

    function render(): void {
      // Move cursor up to overwrite previous render
      if (selected >= 0) {
        write(`\x1b[${items.length}A`);
      }

      for (let i = 0; i < items.length; i++) {
        eraseLine();
        if (i === selected) {
          writeLine(`  ${primary("❯")} ${bold(items[i]!)}`);
        } else {
          writeLine(`    ${dim(items[i]!)}`);
        }
      }
    }

    // Initial render
    hideCursor();
    if (opts?.title) {
      writeLine(`  ${opts.title}\r\n`);
    }
    for (let i = 0; i < items.length; i++) {
      if (i === selected) {
        writeLine(`  ${primary("❯")} ${bold(items[i]!)}`);
      } else {
        writeLine(`    ${dim(items[i]!)}`);
      }
    }

    process.stdin.setRawMode(true);
    process.stdin.resume();

    const onKey = (data: Buffer) => {
      const key = data.toString();

      if (key === "\x1b[A" || key === "k") {
        // Up
        selected = Math.max(0, selected - 1);
        render();
      } else if (key === "\x1b[B" || key === "j") {
        // Down
        selected = Math.min(items.length - 1, selected + 1);
        render();
      } else if (key === "\r" || key === "\n") {
        // Enter
        cleanup();
        resolve(selected);
      } else if (key === "\x03") {
        // Ctrl+C
        cleanup();
        process.exit(0);
      }
    };

    function cleanup(): void {
      process.stdin.off("data", onKey);
      if (!wasRaw) {
        process.stdin.setRawMode(false);
        process.stdin.pause();
      }
      showCursor();
    }

    process.stdin.on("data", onKey);
  });
}

/**
 * Prompt for text input with a styled label.
 */
export function textInput(label: string): Promise<string> {
  return new Promise((resolve) => {
    showCursor();
    write(`  ${primary("?")} ${label} `);

    let buffer = "";
    const wasRaw = process.stdin.isRaw;

    process.stdin.setRawMode(true);
    process.stdin.resume();

    const onKey = (data: Buffer) => {
      const key = data.toString();

      if (key === "\r" || key === "\n") {
        cleanup();
        writeLine("");
        resolve(buffer);
      } else if (key === "\x7f" || key === "\b") {
        // Backspace
        if (buffer.length > 0) {
          buffer = buffer.slice(0, -1);
          write("\b \b");
        }
      } else if (key === "\x03") {
        // Ctrl+C
        cleanup();
        process.exit(0);
      } else if (key.length === 1 && key >= " ") {
        buffer += key;
        write(key);
      }
    };

    function cleanup(): void {
      process.stdin.off("data", onKey);
      if (!wasRaw) {
        process.stdin.setRawMode(false);
        process.stdin.pause();
      }
    }

    process.stdin.on("data", onKey);
  });
}
