/**
 * Toast — transient notification system.
 *
 * Displays brief messages at the bottom-right of the screen
 * that auto-dismiss after a timeout. Stacks multiple toasts.
 */

import type { Screen } from "../screen.js";
import {
  padEnd,
  colors,
  box,
  icons,
  success,
  warning,
  error as errorColor,
  info,
  muted,
  bold,
  visibleLength,
} from "../theme.js";

export type ToastLevel = "info" | "success" | "warning" | "error";

type ToastItem = {
  id: number;
  message: string;
  level: ToastLevel;
  expiry: number;
};

export class Toast {
  private readonly _screen: Screen;
  private _items: ToastItem[] = [];
  private _nextId = 0;
  private _timer: ReturnType<typeof setInterval> | null = null;

  constructor(screen: Screen) {
    this._screen = screen;
  }

  show(message: string, level: ToastLevel = "info", durationMs = 3000): void {
    const item: ToastItem = {
      id: this._nextId++,
      message,
      level,
      expiry: Date.now() + durationMs,
    };

    this._items.push(item);
    if (this._items.length > 5) this._items.shift();

    this.render();
    this._startTimer();
  }

  render(): void {
    const now = Date.now();
    this._items = this._items.filter((t) => t.expiry > now);

    const maxW = 40;
    const rightMargin = 2;
    const startX = this._screen.cols - maxW - rightMargin;
    const bottomY = this._screen.rows - 3; // Above command bar

    const borderC = `\x1b[38;2;${colors.border.r};${colors.border.g};${colors.border.b}m`;
    const bg = `\x1b[48;2;${colors.bgSurface.r};${colors.bgSurface.g};${colors.bgSurface.b}m`;
    const reset = "\x1b[0m";

    for (let i = 0; i < this._items.length; i++) {
      const item = this._items[i]!;
      const y = bottomY - (this._items.length - 1 - i) * 3;
      if (y < 3) continue;

      let icon: string;
      let styledMsg: string;
      switch (item.level) {
        case "success":
          icon = success(icons.check);
          styledMsg = success(item.message);
          break;
        case "warning":
          icon = warning(icons.warning);
          styledMsg = warning(item.message);
          break;
        case "error":
          icon = errorColor(icons.cross);
          styledMsg = errorColor(item.message);
          break;
        default:
          icon = info(icons.info);
          styledMsg = item.message;
      }

      const content = ` ${icon} ${styledMsg} `;
      const innerW = maxW - 2;

      this._screen.writeAt(startX, y,
        `${borderC}${box.roundTopLeft}${box.horizontal.repeat(innerW)}${box.roundTopRight}${reset}`);
      this._screen.writeAt(startX, y + 1,
        `${borderC}${box.vertical}${reset}${bg}${padEnd(content, innerW)}${borderC}${box.vertical}${reset}`);
      this._screen.writeAt(startX, y + 2,
        `${borderC}${box.roundBottomLeft}${box.horizontal.repeat(innerW)}${box.roundBottomRight}${reset}`);
    }

    this._screen.flush();
  }

  private _startTimer(): void {
    if (this._timer) return;
    this._timer = setInterval(() => {
      const now = Date.now();
      const before = this._items.length;
      this._items = this._items.filter((t) => t.expiry > now);
      if (this._items.length !== before) {
        // Trigger full redraw to clean up old toast areas
        this._screen.emit("redraw");
      }
      if (this._items.length === 0 && this._timer) {
        clearInterval(this._timer);
        this._timer = null;
      }
    }, 500);
  }
}
