/**
 * Sidebar — session list and peer list panel on the left.
 *
 * ├──────────┐
 * │ SESSIONS │
 * │ ● local  │
 * │   zsh    │
 * │ ○ ubuntu │
 * │   bash   │
 * │──────────│
 * │ PEERS    │
 * │ ● @alex  │
 * ├──────────┘
 */

import type { Screen } from "../screen.js";
import type { SessionInfo, DeviceInfo } from "@tbridge/protocol";
import {
  bold,
  muted,
  primary,
  success,
  warning,
  dim,
  padEnd,
  truncate,
  colors,
  icons,
  box,
  peerColor,
} from "../theme.js";

export type SidebarEntry = {
  id: string;
  type: "session" | "peer";
  label: string;
  sublabel: string;
  status: "active" | "idle" | "exited" | "online" | "offline" | "connecting";
  isLocal: boolean;
};

export class Sidebar {
  private readonly _screen: Screen;
  private _entries: SidebarEntry[] = [];
  private _selectedIndex = 0;
  private _width: number;
  private _top: number;
  private _height: number;
  private _visible = true;

  constructor(
    screen: Screen,
    options: { width?: number; top?: number } = {}
  ) {
    this._screen = screen;
    this._width = options.width ?? 18;
    this._top = options.top ?? 2; // Below status bar
    this._height = screen.rows - this._top - 2; // Above command bar

    screen.on("resize", () => {
      this._height = screen.rows - this._top - 2;
      if (this._visible) this.render();
    });
  }

  get width(): number {
    return this._visible ? this._width : 0;
  }

  get visible(): boolean {
    return this._visible;
  }

  set visible(v: boolean) {
    this._visible = v;
  }

  get selectedId(): string | undefined {
    return this._entries[this._selectedIndex]?.id;
  }

  get selectedIndex(): number {
    return this._selectedIndex;
  }

  // ─── Data ─────────────────────────────────────────────────

  setEntries(entries: SidebarEntry[]): void {
    this._entries = entries;
    if (this._selectedIndex >= entries.length) {
      this._selectedIndex = Math.max(0, entries.length - 1);
    }
    if (this._visible) this.render();
  }

  addEntry(entry: SidebarEntry): void {
    this._entries.push(entry);
    if (this._visible) this.render();
  }

  removeEntry(id: string): void {
    this._entries = this._entries.filter((e) => e.id !== id);
    if (this._selectedIndex >= this._entries.length) {
      this._selectedIndex = Math.max(0, this._entries.length - 1);
    }
    if (this._visible) this.render();
  }

  // ─── Navigation ───────────────────────────────────────────

  selectNext(): void {
    if (this._entries.length === 0) return;
    this._selectedIndex = (this._selectedIndex + 1) % this._entries.length;
    if (this._visible) this.render();
  }

  selectPrev(): void {
    if (this._entries.length === 0) return;
    this._selectedIndex =
      (this._selectedIndex - 1 + this._entries.length) % this._entries.length;
    if (this._visible) this.render();
  }

  selectById(id: string): void {
    const idx = this._entries.findIndex((e) => e.id === id);
    if (idx >= 0) {
      this._selectedIndex = idx;
      if (this._visible) this.render();
    }
  }

  // ─── Rendering ────────────────────────────────────────────

  render(): void {
    if (!this._visible) return;

    const w = this._width;
    const bg = `\x1b[48;2;${colors.bgPanel.r};${colors.bgPanel.g};${colors.bgPanel.b}m`;
    const borderColor = `\x1b[38;2;${colors.border.r};${colors.border.g};${colors.border.b}m`;
    const reset = "\x1b[0m";

    // Find where sessions end and peers begin
    const sessionEntries = this._entries.filter((e) => e.type === "session");
    const peerEntries = this._entries.filter((e) => e.type === "peer");

    let row = this._top;

    // ── SESSIONS header ────────────────────────────────────
    const sessHeader = `${bg} ${bold(muted("SESSIONS"))}${padEnd("", w - 10)}${borderColor}${box.vertical}${reset}`;
    this._screen.writeLine(row++, sessHeader);

    // Session entries
    for (let i = 0; i < sessionEntries.length; i++) {
      const entry = sessionEntries[i]!;
      const globalIdx = this._entries.indexOf(entry);
      const isSelected = globalIdx === this._selectedIndex;

      const entryBg = isSelected
        ? `\x1b[48;2;${colors.bgHighlight.r};${colors.bgHighlight.g};${colors.bgHighlight.b}m`
        : bg;

      const statusIcon = this._statusIcon(entry.status);
      const label = truncate(entry.label, w - 6);
      const sublabel = truncate(entry.sublabel, w - 6);

      // Line 1: status icon + label
      const line1 = `${entryBg} ${statusIcon} ${isSelected ? primary(label) : label}`;
      this._screen.writeLine(row++, padEnd(line1, w - 1) + `${borderColor}${box.vertical}${reset}`);

      // Line 2: sublabel (indented)
      const line2 = `${entryBg}   ${muted(sublabel)}`;
      this._screen.writeLine(row++, padEnd(line2, w - 1) + `${borderColor}${box.vertical}${reset}`);

      if (row >= this._top + this._height - 4) break;
    }

    // Divider
    if (peerEntries.length > 0 && row < this._top + this._height - 3) {
      const divLine = `${bg}${borderColor}${box.horizontal.repeat(w - 1)}${box.teeLeft}${reset}`;
      this._screen.writeLine(row++, divLine);

      // ── PEERS header ────────────────────────────────────
      const peerHeader = `${bg} ${bold(muted("PEERS"))}${padEnd("", w - 7)}${borderColor}${box.vertical}${reset}`;
      this._screen.writeLine(row++, peerHeader);

      // Peer entries
      for (let i = 0; i < peerEntries.length; i++) {
        const entry = peerEntries[i]!;
        const globalIdx = this._entries.indexOf(entry);
        const isSelected = globalIdx === this._selectedIndex;

        const entryBg = isSelected
          ? `\x1b[48;2;${colors.bgHighlight.r};${colors.bgHighlight.g};${colors.bgHighlight.b}m`
          : bg;

        const statusIcon = this._statusIcon(entry.status);
        const label = truncate(entry.label, w - 6);
        const sublabel = truncate(entry.sublabel, w - 6);

        const line1 = `${entryBg} ${statusIcon} ${isSelected ? peerColor(label, i + 1) : label}`;
        this._screen.writeLine(row++, padEnd(line1, w - 1) + `${borderColor}${box.vertical}${reset}`);

        const line2 = `${entryBg}   ${muted(sublabel)}`;
        this._screen.writeLine(row++, padEnd(line2, w - 1) + `${borderColor}${box.vertical}${reset}`);

        if (row >= this._top + this._height) break;
      }
    }

    // Fill remaining space
    while (row < this._top + this._height) {
      this._screen.writeLine(
        row++,
        `${bg}${padEnd("", w - 1)}${borderColor}${box.vertical}${reset}`
      );
    }
  }

  private _statusIcon(status: string): string {
    switch (status) {
      case "active":
      case "online":
        return success(icons.connected);
      case "idle":
        return warning(icons.connected);
      case "connecting":
        return warning(icons.connecting);
      case "exited":
      case "offline":
        return muted(icons.disconnected);
      default:
        return muted(icons.dot);
    }
  }
}
