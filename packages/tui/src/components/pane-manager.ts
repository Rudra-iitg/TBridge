/**
 * PaneManager — manages multiple terminal panes with split layout.
 *
 * Handles pane creation, focus switching, splitting, and resize
 * calculations. Each pane occupies a rectangular region of the screen.
 */

import type { Screen } from "../screen.js";
import type { Session } from "@tbridge/engine";
import { TerminalPane, type PaneOptions } from "./terminal-pane.js";

export type SplitDirection = "horizontal" | "vertical";

type LayoutNode = {
  id: string;
  type: "pane";
  pane: TerminalPane;
} | {
  id: string;
  type: "split";
  direction: SplitDirection;
  children: LayoutNode[];
  ratio: number; // 0-1, split position
};

export class PaneManager {
  private readonly _screen: Screen;
  private readonly _panes = new Map<string, TerminalPane>();
  private _focusedId: string | null = null;
  private _paneOrder: string[] = [];

  // Layout region (the area available for panes)
  private _x = 1;
  private _y = 2;
  private _width: number;
  private _height: number;

  constructor(screen: Screen) {
    this._screen = screen;
    this._width = screen.cols;
    this._height = screen.rows - 3; // status bar (1) + command bar (2)

    screen.on("resize", () => {
      this._width = screen.cols;
      this._height = screen.rows - 3;
      this._relayout();
    });
  }

  /** Update the left offset (e.g., when sidebar toggles). */
  setOffset(x: number): void {
    this._x = x;
    this._width = this._screen.cols - x + 1;
    this._relayout();
  }

  get focusedPane(): TerminalPane | undefined {
    return this._focusedId ? this._panes.get(this._focusedId) : undefined;
  }

  get focusedId(): string | null {
    return this._focusedId;
  }

  get paneCount(): number {
    return this._panes.size;
  }

  get allPanes(): TerminalPane[] {
    return Array.from(this._panes.values());
  }

  // ─── Pane Lifecycle ───────────────────────────────────────

  /** Create a new pane and add it to the layout. */
  createPane(id: string, session?: Session): TerminalPane {
    const options = this._calculatePaneRect(this._panes.size);
    const pane = new TerminalPane(this._screen, id, options);

    if (session) pane.attachSession(session);

    this._panes.set(id, pane);
    this._paneOrder.push(id);

    // Focus the new pane
    this.focusPane(id);
    this._relayout();

    return pane;
  }

  /** Remove a pane. */
  removePane(id: string): void {
    const pane = this._panes.get(id);
    if (!pane) return;

    pane.detachSession();
    this._panes.delete(id);
    this._paneOrder = this._paneOrder.filter((pid) => pid !== id);

    // Refocus
    if (this._focusedId === id) {
      this._focusedId = this._paneOrder[0] ?? null;
      if (this._focusedId) {
        this._panes.get(this._focusedId)!.focused = true;
      }
    }

    this._relayout();
  }

  /** Focus a specific pane. */
  focusPane(id: string): void {
    if (this._focusedId === id) return;

    // Unfocus previous
    if (this._focusedId) {
      const prev = this._panes.get(this._focusedId);
      if (prev) prev.focused = false;
    }

    this._focusedId = id;
    const pane = this._panes.get(id);
    if (pane) pane.focused = true;
  }

  /** Focus the next pane in order. */
  focusNext(): void {
    if (this._paneOrder.length <= 1) return;
    const idx = this._focusedId ? this._paneOrder.indexOf(this._focusedId) : -1;
    const nextIdx = (idx + 1) % this._paneOrder.length;
    this.focusPane(this._paneOrder[nextIdx]!);
  }

  /** Focus the previous pane in order. */
  focusPrev(): void {
    if (this._paneOrder.length <= 1) return;
    const idx = this._focusedId ? this._paneOrder.indexOf(this._focusedId) : 0;
    const prevIdx = (idx - 1 + this._paneOrder.length) % this._paneOrder.length;
    this.focusPane(this._paneOrder[prevIdx]!);
  }

  // ─── Layout ───────────────────────────────────────────────

  /**
   * Recalculate all pane positions.
   * Uses a simple grid: 1 pane = full, 2 = side-by-side, 3+ = grid.
   */
  private _relayout(): void {
    const count = this._paneOrder.length;
    if (count === 0) return;

    const rects = this._calculateGrid(count);

    for (let i = 0; i < this._paneOrder.length; i++) {
      const id = this._paneOrder[i]!;
      const pane = this._panes.get(id);
      const rect = rects[i];
      if (pane && rect) {
        pane.resize(rect.x, rect.y, rect.width, rect.height);
      }
    }
  }

  private _calculateGrid(count: number): PaneOptions[] {
    const x = this._x;
    const y = this._y;
    const w = this._width;
    const h = this._height;

    if (count === 1) {
      return [{ x, y, width: w, height: h }];
    }

    if (count === 2) {
      // Side by side (vertical split)
      const half = Math.floor(w / 2);
      return [
        { x, y, width: half, height: h },
        { x: x + half, y, width: w - half, height: h },
      ];
    }

    if (count === 3) {
      // 1 left, 2 stacked right
      const leftW = Math.floor(w / 2);
      const rightW = w - leftW;
      const halfH = Math.floor(h / 2);
      return [
        { x, y, width: leftW, height: h },
        { x: x + leftW, y, width: rightW, height: halfH },
        { x: x + leftW, y: y + halfH, width: rightW, height: h - halfH },
      ];
    }

    // 4+: 2x2 grid (expandable)
    const cols = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / cols);
    const cellW = Math.floor(w / cols);
    const cellH = Math.floor(h / rows);
    const rects: PaneOptions[] = [];

    for (let i = 0; i < count; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      rects.push({
        x: x + col * cellW,
        y: y + row * cellH,
        width: col === cols - 1 ? w - col * cellW : cellW,
        height: row === rows - 1 ? h - row * cellH : cellH,
      });
    }

    return rects;
  }

  private _calculatePaneRect(existingCount: number): PaneOptions {
    // Temporary rect — will be recalculated by _relayout
    return { x: this._x, y: this._y, width: this._width, height: this._height };
  }

  /** Render all panes. */
  renderAll(): void {
    for (const pane of this._panes.values()) {
      pane.render();
    }
  }
}
