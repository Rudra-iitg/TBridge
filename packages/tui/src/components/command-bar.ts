/**
 * CommandBar — bottom bar with slash command input and keyboard hints.
 *
 * ├──────────────────────────────────────────────────────────────────┤
 * │ /connect  /msg  /targets   Ctrl+P: palette  Ctrl+B,N: new pane │
 * └──────────────────────────────────────────────────────────────────┘
 */

import type { Screen } from "../screen.js";
import {
  muted,
  primary,
  bold,
  dim,
  padEnd,
  colors,
  box,
  icons,
  visibleLength,
} from "../theme.js";

export type CommandBarMode = "hints" | "input";

export class CommandBar {
  private readonly _screen: Screen;
  private _mode: CommandBarMode = "hints";
  private _inputBuffer = "";
  private _cursorPos = 0;
  private _prompt = "/";
  private _onSubmit: ((command: string) => void) | null = null;
  private _onCancel: (() => void) | null = null;

  constructor(screen: Screen) {
    this._screen = screen;
  }

  get height(): number {
    return 2;
  }

  get mode(): CommandBarMode {
    return this._mode;
  }

  get y(): number {
    return this._screen.rows - 1;
  }

  // ─── Mode switching ───────────────────────────────────────

  enterInput(onSubmit: (cmd: string) => void, onCancel: () => void): void {
    this._mode = "input";
    this._inputBuffer = "";
    this._cursorPos = 0;
    this._onSubmit = onSubmit;
    this._onCancel = onCancel;
    this.render();
  }

  exitInput(): void {
    this._mode = "hints";
    this._inputBuffer = "";
    this._cursorPos = 0;
    this._onSubmit = null;
    this._onCancel = null;
    this.render();
  }

  // ─── Input handling ───────────────────────────────────────

  handleKey(name: string, ch: string, raw: Buffer): boolean {
    if (this._mode !== "input") return false;

    switch (name) {
      case "return":
        if (this._onSubmit && this._inputBuffer.trim()) {
          this._onSubmit(this._inputBuffer.trim());
        }
        this.exitInput();
        return true;

      case "escape":
        if (this._onCancel) this._onCancel();
        this.exitInput();
        return true;

      case "backspace":
        if (this._cursorPos > 0) {
          this._inputBuffer =
            this._inputBuffer.slice(0, this._cursorPos - 1) +
            this._inputBuffer.slice(this._cursorPos);
          this._cursorPos--;
          this.render();
        }
        return true;

      case "left":
        if (this._cursorPos > 0) { this._cursorPos--; this.render(); }
        return true;

      case "right":
        if (this._cursorPos < this._inputBuffer.length) { this._cursorPos++; this.render(); }
        return true;

      default:
        if (ch && ch.length === 1 && ch >= " ") {
          this._inputBuffer =
            this._inputBuffer.slice(0, this._cursorPos) +
            ch +
            this._inputBuffer.slice(this._cursorPos);
          this._cursorPos++;
          this.render();
          return true;
        }
        return false;
    }
  }

  // ─── Rendering ────────────────────────────────────────────

  render(): void {
    const y = this._screen.rows;
    const w = this._screen.cols;
    const borderC = `\x1b[38;2;${colors.border.r};${colors.border.g};${colors.border.b}m`;
    const bg = `\x1b[48;2;${colors.bgSurface.r};${colors.bgSurface.g};${colors.bgSurface.b}m`;
    const reset = "\x1b[0m";

    // Top divider line
    this._screen.writeLine(
      y - 1,
      `${borderC}${box.horizontal.repeat(w)}${reset}`
    );

    if (this._mode === "hints") {
      // Keyboard hints
      const hints = [
        `${primary("/")}${muted("command")}`,
        `${primary("Ctrl+P")}${muted(" palette")}`,
        `${primary("Ctrl+B,N")}${muted(" new")}`,
        `${primary("Ctrl+B,W")}${muted(" close")}`,
        `${primary("Ctrl+B,←→")}${muted(" switch")}`,
        `${primary("Ctrl+B,Q")}${muted(" quit")}`,
      ];

      const line = `${bg} ${hints.join(`  ${dim(icons.dot)}  `)} `;
      this._screen.writeLine(y, padEnd(line, w) + reset);
    } else {
      // Input mode
      const promptStr = primary(`${this._prompt} `);
      const input = this._inputBuffer;
      const line = `${bg} ${promptStr}${input}`;
      this._screen.writeLine(y, padEnd(line, w) + reset);

      // Show cursor at input position
      const cursorX = 4 + this._cursorPos; // prompt + space + cursor pos
      this._screen.writeAt(cursorX, y, "\x1b[?25h"); // show cursor
    }
  }
}
