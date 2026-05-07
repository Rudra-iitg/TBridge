/**
 * Theme — TBridge v2 design system.
 *
 * Curated color palette inspired by Warp, k9s, and Claude Code.
 * All functions return ANSI-decorated strings. Zero dependencies.
 */

const ESC = "\x1b[";
const RESET = `${ESC}0m`;

function rgb(r: number, g: number, b: number): string {
  return `${ESC}38;2;${r};${g};${b}m`;
}

function bgRgb(r: number, g: number, b: number): string {
  return `${ESC}48;2;${r};${g};${b}m`;
}

// ─── Brand Colors ────────────────────────────────────────────────

export const colors = {
  // Core palette
  primary:     { r: 99,  g: 179, b: 237 },  // Soft blue
  secondary:   { r: 189, g: 147, b: 249 },  // Purple
  accent:      { r: 0,   g: 210, b: 255 },  // Cyan
  success:     { r: 80,  g: 250, b: 123 },  // Green
  warning:     { r: 255, g: 183, b: 77  },  // Amber
  error:       { r: 255, g: 85,  b: 85  },  // Red
  info:        { r: 139, g: 233, b: 253 },  // Light cyan

  // Surface colors (dark theme)
  bg:          { r: 13,  g: 17,  b: 23  },  // Deep navy-black
  bgSurface:   { r: 22,  g: 27,  b: 34  },  // Elevated surface
  bgHighlight: { r: 33,  g: 38,  b: 45  },  // Hover/selected
  bgPanel:     { r: 27,  g: 32,  b: 40  },  // Sidebar panel

  // Text
  text:        { r: 230, g: 237, b: 243 },  // Primary text
  textMuted:   { r: 125, g: 133, b: 144 },  // Secondary text
  textDim:     { r: 72,  g: 79,  b: 88  },  // Disabled/subtle

  // Borders
  border:      { r: 48,  g: 54,  b: 61  },  // Default border
  borderFocus: { r: 99,  g: 179, b: 237 },  // Focused element
} as const;

// ─── Peer Colors ─────────────────────────────────────────────────

const PEER_COLORS = [
  { r: 99,  g: 179, b: 237 },  // Blue (self)
  { r: 255, g: 121, b: 198 },  // Pink
  { r: 80,  g: 250, b: 123 },  // Green
  { r: 255, g: 183, b: 77  },  // Amber
  { r: 189, g: 147, b: 249 },  // Purple
  { r: 139, g: 233, b: 253 },  // Cyan
  { r: 241, g: 250, b: 140 },  // Yellow
  { r: 255, g: 85,  b: 85  },  // Red
];

// ─── Text Styling ────────────────────────────────────────────────

export function primary(text: string): string {
  const c = colors.primary;
  return `${rgb(c.r, c.g, c.b)}${text}${RESET}`;
}

export function secondary(text: string): string {
  const c = colors.secondary;
  return `${rgb(c.r, c.g, c.b)}${text}${RESET}`;
}

export function accent(text: string): string {
  const c = colors.accent;
  return `${rgb(c.r, c.g, c.b)}${text}${RESET}`;
}

export function success(text: string): string {
  const c = colors.success;
  return `${rgb(c.r, c.g, c.b)}${text}${RESET}`;
}

export function warning(text: string): string {
  const c = colors.warning;
  return `${rgb(c.r, c.g, c.b)}${text}${RESET}`;
}

export function error(text: string): string {
  const c = colors.error;
  return `${rgb(c.r, c.g, c.b)}${text}${RESET}`;
}

export function info(text: string): string {
  const c = colors.info;
  return `${rgb(c.r, c.g, c.b)}${text}${RESET}`;
}

export function muted(text: string): string {
  const c = colors.textMuted;
  return `${rgb(c.r, c.g, c.b)}${text}${RESET}`;
}

export function dim(text: string): string {
  return `${ESC}2m${text}${RESET}`;
}

export function bold(text: string): string {
  return `${ESC}1m${text}${RESET}`;
}

export function italic(text: string): string {
  return `${ESC}3m${text}${RESET}`;
}

export function underline(text: string): string {
  return `${ESC}4m${text}${RESET}`;
}

export function inverse(text: string): string {
  return `${ESC}7m${text}${RESET}`;
}

export function strikethrough(text: string): string {
  return `${ESC}9m${text}${RESET}`;
}

// ─── Composite Styles ────────────────────────────────────────────

export function bgPrimary(text: string): string {
  const c = colors.primary;
  return `${bgRgb(c.r, c.g, c.b)}${rgb(13, 17, 23)}${text}${RESET}`;
}

export function bgSurface(text: string): string {
  const c = colors.bgSurface;
  return `${bgRgb(c.r, c.g, c.b)}${text}${RESET}`;
}

export function bgHighlight(text: string): string {
  const c = colors.bgHighlight;
  return `${bgRgb(c.r, c.g, c.b)}${text}${RESET}`;
}

export function bgPanel(text: string): string {
  const c = colors.bgPanel;
  return `${bgRgb(c.r, c.g, c.b)}${text}${RESET}`;
}

export function peerColor(text: string, index: number): string {
  const c = PEER_COLORS[index % PEER_COLORS.length]!;
  return `${rgb(c.r, c.g, c.b)}${text}${RESET}`;
}

// ─── Gradient ────────────────────────────────────────────────────

type RGB = { r: number; g: number; b: number };

function lerp(a: RGB, b: RGB, t: number): RGB {
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  };
}

export function gradient(
  text: string,
  from: RGB = colors.primary,
  to: RGB = colors.secondary
): string {
  const chars = [...text];
  if (chars.length <= 1) return `${rgb(from.r, from.g, from.b)}${text}${RESET}`;

  let result = "";
  for (let i = 0; i < chars.length; i++) {
    const t = i / (chars.length - 1);
    const c = lerp(from, to, t);
    result += `${rgb(c.r, c.g, c.b)}${chars[i]}`;
  }
  return result + RESET;
}

// ─── Box Drawing ─────────────────────────────────────────────────

export const box = {
  topLeft:     "┌",
  topRight:    "┐",
  bottomLeft:  "└",
  bottomRight: "┘",
  horizontal:  "─",
  vertical:    "│",
  teeLeft:     "┤",
  teeRight:    "├",
  teeUp:       "┴",
  teeDown:     "┬",
  cross:       "┼",

  // Rounded
  roundTopLeft:    "╭",
  roundTopRight:   "╮",
  roundBottomLeft: "╰",
  roundBottomRight:"╯",

  // Double
  dblHorizontal: "═",
  dblVertical:   "║",

  // Heavy
  heavyHorizontal: "━",
  heavyVertical:   "┃",
} as const;

// ─── Icons ───────────────────────────────────────────────────────

export const icons = {
  connected:    "●",
  disconnected: "○",
  connecting:   "◌",
  encrypted:    "🔒",
  check:        "✓",
  cross:        "✗",
  arrow:        "→",
  arrowRight:   "▸",
  arrowDown:    "▾",
  dot:          "·",
  dash:         "─",
  pipe:         "│",
  info:         "ℹ",
  warning:      "⚠",
  terminal:     "❯",
  shell:        "$",
  folder:       "📁",
  device:       "💻",
  user:         "👤",
  message:      "💬",
  lock:         "🔐",
  gear:         "⚙",
  search:       "🔍",
  plus:         "+",
  minus:        "−",
  split:        "⊞",
  close:        "×",
} as const;

// ─── ANSI Utilities ──────────────────────────────────────────────

/** Move cursor to (x, y) — 1-indexed. */
export function moveTo(x: number, y: number): string {
  return `${ESC}${y};${x}H`;
}

/** Clear the entire screen. */
export function clearScreen(): string {
  return `${ESC}2J${ESC}H`;
}

/** Clear from cursor to end of line. */
export function clearToEOL(): string {
  return `${ESC}K`;
}

/** Clear from cursor to end of screen. */
export function clearToEOS(): string {
  return `${ESC}J`;
}

/** Hide cursor. */
export function hideCursor(): string {
  return `${ESC}?25l`;
}

/** Show cursor. */
export function showCursor(): string {
  return `${ESC}?25h`;
}

/** Enable alternative screen buffer. */
export function altScreen(): string {
  return `${ESC}?1049h`;
}

/** Disable alternative screen buffer. */
export function mainScreen(): string {
  return `${ESC}?1049l`;
}

/** Set scroll region (top and bottom row, 1-indexed). */
export function setScrollRegion(top: number, bottom: number): string {
  return `${ESC}${top};${bottom}r`;
}

/** Reset scroll region to full screen. */
export function resetScrollRegion(): string {
  return `${ESC}r`;
}

/** Save cursor position. */
export function saveCursor(): string {
  return `${ESC}s`;
}

/** Restore cursor position. */
export function restoreCursor(): string {
  return `${ESC}u`;
}

/**
 * Strip all ANSI escape sequences from a string.
 * Returns the visible character count.
 */
// eslint-disable-next-line no-control-regex
const ANSI_REGEX = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*\x07/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, "");
}

export function visibleLength(text: string): number {
  return stripAnsi(text).length;
}

/**
 * Pad a styled string to a given visible width.
 * Handles ANSI codes so padding is visually correct.
 */
export function padEnd(text: string, width: number, fill = " "): string {
  const visible = visibleLength(text);
  if (visible >= width) return text;
  return text + fill.repeat(width - visible);
}

export function padStart(text: string, width: number, fill = " "): string {
  const visible = visibleLength(text);
  if (visible >= width) return text;
  return fill.repeat(width - visible) + text;
}

export function center(text: string, width: number, fill = " "): string {
  const visible = visibleLength(text);
  if (visible >= width) return text;
  const left = Math.floor((width - visible) / 2);
  const right = width - visible - left;
  return fill.repeat(left) + text + fill.repeat(right);
}

/**
 * Truncate a styled string to a given visible width.
 * Preserves ANSI codes up to the truncation point.
 */
export function truncate(text: string, maxWidth: number, suffix = "…"): string {
  if (visibleLength(text) <= maxWidth) return text;

  const suffixLen = suffix.length;
  const target = maxWidth - suffixLen;
  let visible = 0;
  let result = "";
  let i = 0;
  const chars = text;

  while (i < chars.length && visible < target) {
    if (chars[i] === "\x1b") {
      // Consume entire escape sequence
      const end = chars.indexOf("m", i);
      if (end !== -1) {
        result += chars.slice(i, end + 1);
        i = end + 1;
        continue;
      }
    }
    result += chars[i];
    visible++;
    i++;
  }

  return result + RESET + suffix;
}
