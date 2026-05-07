/**
 * TerminalPane — renders a PTY session into a screen region.
 */

import type { Screen } from "../screen.js";
import type { Session } from "@tbridge/engine";
import { padEnd, muted, primary, bold, dim, colors, box, icons } from "../theme.js";

export type PaneOptions = {
  x: number;
  y: number;
  width: number;
  height: number;
  showBorder?: boolean;
  showTitle?: boolean;
};

export class TerminalPane {
  private readonly _screen: Screen;
  private _session: Session | null = null;
  private _x: number;
  private _y: number;
  private _width: number;
  private _height: number;
  private _showBorder: boolean;
  private _showTitle: boolean;
  private _focused = false;
  private _id: string;
  private _lines: string[] = [];
  private _scrollOffset = 0;
  private _partialLine = "";

  private get _contentX(): number { return this._x + (this._showBorder ? 1 : 0); }
  private get _contentY(): number { return this._y + (this._showTitle ? 1 : 0) + (this._showBorder ? 1 : 0); }
  private get _contentWidth(): number { return this._width - (this._showBorder ? 2 : 0); }
  private get _contentHeight(): number {
    let h = this._height;
    if (this._showBorder) h -= 2;
    if (this._showTitle) h -= 1;
    return Math.max(1, h);
  }

  constructor(screen: Screen, id: string, options: PaneOptions) {
    this._screen = screen;
    this._id = id;
    this._x = options.x;
    this._y = options.y;
    this._width = options.width;
    this._height = options.height;
    this._showBorder = options.showBorder ?? true;
    this._showTitle = options.showTitle ?? true;
  }

  get id(): string { return this._id; }
  get focused(): boolean { return this._focused; }
  set focused(v: boolean) { this._focused = v; this.render(); }
  get session(): Session | null { return this._session; }

  attachSession(session: Session): void {
    if (this._session) this._session.removeAllListeners("data");
    this._session = session;
    this._lines = [];
    this._scrollOffset = 0;
    this._partialLine = "";
    session.resize(this._contentWidth, this._contentHeight);
    session.on("data", (data: string) => this._appendData(data));
    session.on("exit", () => this.render());
    this.render();
  }

  detachSession(): void {
    if (this._session) { this._session.removeAllListeners("data"); this._session = null; }
  }

  handleInput(data: Buffer): void {
    if (this._session?.status === "active") this._session.write(data.toString("utf8"));
  }

  resize(x: number, y: number, width: number, height: number): void {
    this._x = x; this._y = y; this._width = width; this._height = height;
    if (this._session) this._session.resize(this._contentWidth, this._contentHeight);
    this.render();
  }

  render(): void {
    const borderC = this._focused
      ? `\x1b[38;2;${colors.borderFocus.r};${colors.borderFocus.g};${colors.borderFocus.b}m`
      : `\x1b[38;2;${colors.border.r};${colors.border.g};${colors.border.b}m`;
    const reset = "\x1b[0m";

    if (this._showBorder) {
      const w = this._width, h = this._height, x = this._x, y = this._y;
      this._screen.writeAt(x, y, `${borderC}${box.roundTopLeft}${box.horizontal.repeat(w - 2)}${box.roundTopRight}${reset}`);
      for (let row = 1; row < h - 1; row++) {
        this._screen.writeAt(x, y + row, `${borderC}${box.vertical}${reset}`);
        this._screen.writeAt(x + w - 1, y + row, `${borderC}${box.vertical}${reset}`);
      }
      this._screen.writeAt(x, y + h - 1, `${borderC}${box.roundBottomLeft}${box.horizontal.repeat(w - 2)}${box.roundBottomRight}${reset}`);
    }

    if (this._showTitle && this._session) {
      const titleY = this._y + (this._showBorder ? 1 : 0);
      const statusIcon = this._session.status === "active"
        ? (this._focused ? primary(icons.connected) : muted(icons.connected))
        : dim(icons.disconnected);
      const title = ` ${statusIcon} ${bold(this._session.title)} `;
      const statusText = this._session.status === "exited" ? dim("[exited]") : "";
      this._screen.writeAt(this._contentX, titleY, padEnd(`${title}${statusText}`, this._contentWidth));
    }

    this._renderContent();
  }

  private _renderContent(): void {
    const cw = this._contentWidth, ch = this._contentHeight, cx = this._contentX, cy = this._contentY;
    if (!this._session) {
      for (let row = 0; row < ch; row++) this._screen.writeAt(cx, cy + row, " ".repeat(cw));
      const msg = muted("No active session");
      this._screen.writeAt(cx + Math.floor((cw - 17) / 2), cy + Math.floor(ch / 2), msg);
      return;
    }
    const totalLines = this._lines.length;
    const startLine = Math.max(0, totalLines - ch - this._scrollOffset);
    for (let row = 0; row < ch; row++) {
      const line = this._lines[startLine + row] ?? "";
      this._screen.writeAt(cx, cy + row, padEnd(line, cw));
    }
  }

  private _appendData(data: string): void {
    const combined = this._partialLine + data;
    const segments = combined.split(/\r?\n/);
    this._partialLine = segments.pop() ?? "";
    for (const segment of segments) {
      const crParts = segment.split("\r");
      this._lines.push(crParts[crParts.length - 1] ?? "");
    }
    if (this._partialLine) this._lines.push(this._partialLine);
    if (this._lines.length > 10000) this._lines = this._lines.slice(-10000);
    this._scrollOffset = 0;
    this._renderContent();
    this._screen.flush();
  }

  scrollUp(lines = 1): void {
    this._scrollOffset = Math.min(this._scrollOffset + lines, Math.max(0, this._lines.length - this._contentHeight));
    this._renderContent(); this._screen.flush();
  }

  scrollDown(lines = 1): void {
    this._scrollOffset = Math.max(0, this._scrollOffset - lines);
    this._renderContent(); this._screen.flush();
  }
}
