/**
 * CommandPalette — fuzzy-searchable modal overlay.
 *
 * ╭─────────────────────────────────╮
 * │ 🔍 Search commands...          │
 * ├─────────────────────────────────┤
 * │ ▸ New Terminal Pane    Ctrl+B,N │
 * │   Close Pane           Ctrl+B,W │
 * │   Split Horizontal             │
 * │   Connect to Peer              │
 * │   Toggle Sidebar      Ctrl+B,S │
 * │   Quit                Ctrl+B,Q │
 * ╰─────────────────────────────────╯
 */

import type { Screen, KeyEvent } from "../screen.js";
import {
  bold,
  muted,
  primary,
  dim,
  accent,
  padEnd,
  truncate,
  visibleLength,
  colors,
  box,
  icons,
} from "../theme.js";

// ─── Types ───────────────────────────────────────────────────────

export type PaletteAction = {
  id: string;
  label: string;
  description?: string;
  shortcut?: string;
  category?: string;
  handler: () => void;
};

// ─── CommandPalette ──────────────────────────────────────────────

export class CommandPalette {
  private readonly _screen: Screen;
  private _visible = false;
  private _query = "";
  private _cursorPos = 0;
  private _selectedIndex = 0;
  private _actions: PaletteAction[] = [];
  private _filtered: PaletteAction[] = [];
  private _onClose: (() => void) | null = null;

  // Layout
  private readonly _width = 52;
  private readonly _maxResults = 10;

  constructor(screen: Screen) {
    this._screen = screen;
  }

  get visible(): boolean {
    return this._visible;
  }

  // ─── Action Registry ──────────────────────────────────────

  registerActions(actions: PaletteAction[]): void {
    this._actions = actions;
  }

  addAction(action: PaletteAction): void {
    this._actions.push(action);
  }

  // ─── Show / Hide ──────────────────────────────────────────

  open(onClose?: () => void): void {
    this._visible = true;
    this._query = "";
    this._cursorPos = 0;
    this._selectedIndex = 0;
    this._onClose = onClose ?? null;
    this._filter();
    this.render();
  }

  close(): void {
    this._visible = false;
    this._query = "";
    if (this._onClose) {
      this._onClose();
      this._onClose = null;
    }
  }

  // ─── Key Handling ─────────────────────────────────────────

  handleKey(key: KeyEvent): boolean {
    if (!this._visible) return false;

    switch (key.name) {
      case "escape":
        this.close();
        return true;

      case "return":
        this._execute();
        return true;

      case "up":
      case "ctrl-p":
        this._selectedIndex = Math.max(0, this._selectedIndex - 1);
        this.render();
        return true;

      case "down":
      case "ctrl-n":
        this._selectedIndex = Math.min(
          this._filtered.length - 1,
          this._selectedIndex + 1
        );
        this.render();
        return true;

      case "backspace":
        if (this._cursorPos > 0) {
          this._query =
            this._query.slice(0, this._cursorPos - 1) +
            this._query.slice(this._cursorPos);
          this._cursorPos--;
          this._filter();
          this.render();
        }
        return true;

      case "left":
        if (this._cursorPos > 0) {
          this._cursorPos--;
          this.render();
        }
        return true;

      case "right":
        if (this._cursorPos < this._query.length) {
          this._cursorPos++;
          this.render();
        }
        return true;

      case "ctrl-a":
        this._cursorPos = 0;
        this.render();
        return true;

      case "ctrl-e":
        this._cursorPos = this._query.length;
        this.render();
        return true;

      case "ctrl-u":
        this._query = "";
        this._cursorPos = 0;
        this._filter();
        this.render();
        return true;

      default:
        if (key.ch && key.ch.length === 1 && key.ch >= " " && !key.ctrl && !key.meta) {
          this._query =
            this._query.slice(0, this._cursorPos) +
            key.ch +
            this._query.slice(this._cursorPos);
          this._cursorPos++;
          this._filter();
          this.render();
          return true;
        }
        return true; // Absorb all keys when palette is open
    }
  }

  // ─── Filtering ────────────────────────────────────────────

  private _filter(): void {
    if (!this._query) {
      this._filtered = [...this._actions];
    } else {
      const q = this._query.toLowerCase();
      this._filtered = this._actions
        .map((action) => ({
          action,
          score: this._fuzzyScore(action, q),
        }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)
        .map(({ action }) => action);
    }

    this._selectedIndex = Math.min(
      this._selectedIndex,
      Math.max(0, this._filtered.length - 1)
    );
  }

  private _fuzzyScore(action: PaletteAction, query: string): number {
    const label = action.label.toLowerCase();
    const desc = (action.description ?? "").toLowerCase();
    const cat = (action.category ?? "").toLowerCase();

    // Exact substring match gets highest score
    if (label.includes(query)) return 100;
    if (desc.includes(query)) return 50;
    if (cat.includes(query)) return 30;

    // Fuzzy match: check if all query chars appear in order
    let score = 0;
    let qi = 0;
    for (let i = 0; i < label.length && qi < query.length; i++) {
      if (label[i] === query[qi]) {
        score += 10;
        // Bonus for consecutive matches
        if (i > 0 && label[i - 1] === query[qi - 1]) score += 5;
        // Bonus for word boundary matches
        if (i === 0 || label[i - 1] === " " || label[i - 1] === ":") score += 3;
        qi++;
      }
    }

    return qi === query.length ? score : 0;
  }

  // ─── Execution ────────────────────────────────────────────

  private _execute(): void {
    const action = this._filtered[this._selectedIndex];
    if (action) {
      this.close();
      action.handler();
    }
  }

  // ─── Rendering ────────────────────────────────────────────

  render(): void {
    if (!this._visible) return;

    const w = this._width;
    const results = this._filtered.slice(0, this._maxResults);
    const h = results.length + 4; // border top + search + divider + results + border bottom

    // Center on screen
    const startX = Math.max(1, Math.floor((this._screen.cols - w) / 2));
    const startY = Math.max(2, Math.floor((this._screen.rows - h) / 3));

    const borderC = `\x1b[38;2;${colors.borderFocus.r};${colors.borderFocus.g};${colors.borderFocus.b}m`;
    const bg = `\x1b[48;2;${colors.bgSurface.r};${colors.bgSurface.g};${colors.bgSurface.b}m`;
    const bgSel = `\x1b[48;2;${colors.bgHighlight.r};${colors.bgHighlight.g};${colors.bgHighlight.b}m`;
    const reset = "\x1b[0m";

    let row = startY;

    // Top border
    this._screen.writeAt(
      startX, row++,
      `${borderC}${box.roundTopLeft}${box.horizontal.repeat(w - 2)}${box.roundTopRight}${reset}`
    );

    // Search input row
    const searchIcon = `${icons.search} `;
    const placeholder = this._query ? "" : dim("Search commands...");
    const inputDisplay = this._query || "";
    const searchLine = `${bg}${borderC}${box.vertical}${reset}${bg} ${searchIcon}${inputDisplay}${placeholder}`;
    this._screen.writeAt(
      startX, row,
      padEnd(searchLine, startX + w - 2) + `${bg}${borderC}${box.vertical}${reset}`
    );
    // Fix: write full line properly
    const innerW = w - 2;
    const searchContent = ` ${searchIcon}${inputDisplay}${placeholder}`;
    this._screen.writeAt(
      startX, row++,
      `${borderC}${box.vertical}${reset}${bg}${padEnd(searchContent, innerW)}${borderC}${box.vertical}${reset}`
    );

    // Divider
    this._screen.writeAt(
      startX, row++,
      `${borderC}${box.teeRight}${box.horizontal.repeat(w - 2)}${box.teeLeft}${reset}`
    );

    // Results
    if (results.length === 0) {
      const noResults = `  ${muted("No matching commands")}`;
      this._screen.writeAt(
        startX, row++,
        `${borderC}${box.vertical}${reset}${bg}${padEnd(noResults, innerW)}${borderC}${box.vertical}${reset}`
      );
    } else {
      for (let i = 0; i < results.length; i++) {
        const action = results[i]!;
        const isSelected = i === this._selectedIndex;
        const rowBg = isSelected ? bgSel : bg;

        const icon = isSelected ? primary(`${icons.arrowRight} `) : "  ";
        const label = isSelected ? bold(action.label) : action.label;
        const shortcut = action.shortcut ? dim(action.shortcut) : "";

        // Build the line: icon + label + spacer + shortcut
        const leftPart = `${icon}${label}`;
        const leftLen = visibleLength(leftPart);
        const shortcutLen = visibleLength(shortcut);
        const spacerLen = Math.max(1, innerW - leftLen - shortcutLen - 1);
        const content = `${leftPart}${" ".repeat(spacerLen)}${shortcut} `;

        this._screen.writeAt(
          startX, row++,
          `${borderC}${box.vertical}${reset}${rowBg}${padEnd(content, innerW)}${reset}${borderC}${box.vertical}${reset}`
        );
      }
    }

    // Bottom border
    this._screen.writeAt(
      startX, row++,
      `${borderC}${box.roundBottomLeft}${box.horizontal.repeat(w - 2)}${box.roundBottomRight}${reset}`
    );

    // Show cursor in search field
    const cursorX = startX + 4 + this._cursorPos; // border + space + icon + cursor
    this._screen.writeAt(cursorX, startY + 1, "\x1b[?25h");

    this._screen.flush();
  }
}
