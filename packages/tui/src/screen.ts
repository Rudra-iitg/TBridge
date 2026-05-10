/**
 * Screen — manages the raw terminal for the TUI.
 *
 * Handles alternate screen buffer, raw mode, resize events,
 * key input, and provides a buffered write API so components
 * can render without flicker.
 */

import process from "node:process";
import { EventEmitter } from "node:events";
import {
  altScreen,
  mainScreen,
  hideCursor,
  showCursor,
  clearScreen,
  moveTo,
  clearToEOL,
} from "./theme.js";

// ─── Types ───────────────────────────────────────────────────────

export type KeyEvent = {
  raw: Buffer;
  name: string;
  ctrl: boolean;
  shift: boolean;
  meta: boolean;
  ch: string;
};

export interface ScreenEvents {
  key: (key: KeyEvent) => void;
  resize: (cols: number, rows: number) => void;
  close: () => void;
}

// ─── Key Parsing ─────────────────────────────────────────────────

const SPECIAL_KEYS: Record<string, string> = {
  "\x1b[A": "up",
  "\x1b[B": "down",
  "\x1b[C": "right",
  "\x1b[D": "left",
  "\x1b[H": "home",
  "\x1b[F": "end",
  "\x1b[3~": "delete",
  "\x1b[5~": "pageup",
  "\x1b[6~": "pagedown",
  "\x1b[Z": "shift-tab",
  "\x1b[1;5A": "ctrl-up",
  "\x1b[1;5B": "ctrl-down",
  "\x1b[1;5C": "ctrl-right",
  "\x1b[1;5D": "ctrl-left",
  "\x1b[1;2A": "shift-up",
  "\x1b[1;2B": "shift-down",
  "\x1b[1;2C": "shift-right",
  "\x1b[1;2D": "shift-left",
  "\x1bOP": "f1",
  "\x1bOQ": "f2",
  "\x1bOR": "f3",
  "\x1bOS": "f4",
  "\x1b[15~": "f5",
  "\x1b[17~": "f6",
  "\x1b[18~": "f7",
  "\x1b[19~": "f8",
  "\x1b[20~": "f9",
  "\x1b[21~": "f10",
  "\x1b[23~": "f11",
  "\x1b[24~": "f12",
  "\r": "return",
  "\n": "return",
  "\t": "tab",
  "\x7f": "backspace",
  "\x1b": "escape",
  " ": "space",
};

function parseKey(data: Buffer): KeyEvent {
  const raw = data;
  const str = data.toString("utf8");

  // Check special keys
  const special = SPECIAL_KEYS[str];
  if (special) {
    return {
      raw,
      name: special,
      ctrl: special.startsWith("ctrl-"),
      shift: special.startsWith("shift-"),
      meta: false,
      ch: "",
    };
  }

  // Ctrl+letter (0x01-0x1a)
  if (data.length === 1 && data[0]! >= 1 && data[0]! <= 26) {
    const letter = String.fromCharCode(data[0]! + 96); // a-z
    return {
      raw,
      name: `ctrl-${letter}`,
      ctrl: true,
      shift: false,
      meta: false,
      ch: letter,
    };
  }

  // Alt+letter
  if (data.length === 2 && data[0] === 0x1b) {
    const ch = String.fromCharCode(data[1]!);
    return {
      raw,
      name: `alt-${ch}`,
      ctrl: false,
      shift: false,
      meta: true,
      ch,
    };
  }

  // Regular character
  return {
    raw,
    name: str,
    ctrl: false,
    shift: false,
    meta: false,
    ch: str,
  };
}

// ─── Screen ──────────────────────────────────────────────────────

export class Screen extends EventEmitter {
  private _cols: number;
  private _rows: number;
  private _isRaw = false;
  private _buffer: string[] = [];
  private _flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super();
    this._cols = process.stdout.columns || 80;
    this._rows = process.stdout.rows || 24;
  }

  get cols(): number {
    return this._cols;
  }

  get rows(): number {
    return this._rows;
  }

  // ─── Lifecycle ────────────────────────────────────────────

  /** Enter TUI mode — alternate screen, raw input, hidden cursor. */
  start(): void {
    // Enter alternate screen buffer
    process.stdout.write(altScreen() + hideCursor() + clearScreen());

    // Enable raw mode
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      this._isRaw = true;
    }
    process.stdin.resume();
    process.stdin.on("data", this._onInput);

    // Listen for resize
    process.stdout.on("resize", this._onResize);

    // Clean exit handlers
    process.on("exit", this._cleanup);
    process.on("SIGINT", this._onSigInt);
    process.on("SIGTERM", this._onSigTerm);
  }

  /** Exit TUI mode — restore terminal state. */
  stop(): void {
    this._cleanup();
    this.emit("close");
  }

  // ─── Drawing API ──────────────────────────────────────────

  /** Write text at a specific (x, y) position. 1-indexed. */
  writeAt(x: number, y: number, text: string): void {
    this._buffer.push(moveTo(x, y) + text);
    this._scheduleFlush();
  }

  /** Write a full line at row y, clearing to end of line. */
  writeLine(y: number, text: string): void {
    this._buffer.push(moveTo(1, y) + text + clearToEOL());
    this._scheduleFlush();
  }

  /** Clear a rectangular region. */
  clearRegion(x: number, y: number, width: number, height: number): void {
    const blank = " ".repeat(width);
    for (let row = y; row < y + height; row++) {
      this._buffer.push(moveTo(x, row) + blank);
    }
    this._scheduleFlush();
  }

  /** Force immediate flush of the write buffer. */
  flush(): void {
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }
    if (this._buffer.length === 0) return;

    // Batch all writes into a single stdout write to prevent flicker
    process.stdout.write(this._buffer.join(""));
    this._buffer = [];
  }

  /** Full screen repaint — clears and signals components to redraw. */
  fullRedraw(): void {
    process.stdout.write(clearScreen());
    this.emit("redraw");
  }

  // ─── Internal ─────────────────────────────────────────────

  private _scheduleFlush(): void {
    if (this._flushTimer) return;
    this._flushTimer = setTimeout(() => {
      this._flushTimer = null;
      this.flush();
    }, 8); // ~120fps max
  }

  private _onInput = (data: Buffer): void => {
    // Raw mode turns Ctrl+C into a byte instead of SIGINT. Emit it and also
    // provide an emergency app-level quit fallback even if a component swallows
    // the key.
    if (data.length === 1 && data[0] === 0x18) {
      this.stop();
      process.exit(0);
    }

    const key = parseKey(data);
    this.emit("key", key);
  };

  private _onResize = (): void => {
    this._cols = process.stdout.columns || 80;
    this._rows = process.stdout.rows || 24;
    this.emit("resize", this._cols, this._rows);
  };

  private _onSigInt = (): void => {
    this.stop();
    process.exit(0);
  };

  private _onSigTerm = (): void => {
    this.stop();
    process.exit(0);
  };

  private _cleanup = (): void => {
    if (this._isRaw) {
      process.stdin.setRawMode(false);
      this._isRaw = false;
    }
    process.stdin.pause();
    process.stdin.off("data", this._onInput);
    process.stdout.off("resize", this._onResize);
    process.off("exit", this._cleanup);
    process.off("SIGINT", this._onSigInt);
    process.off("SIGTERM", this._onSigTerm);

    process.stdout.write(showCursor() + mainScreen());
  };
}
