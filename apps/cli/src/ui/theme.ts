/**
 * T-Bridge CLI theme — zero-dependency color palette and text styling.
 *
 * Uses ANSI 256-color and truecolor escape sequences for rich terminal
 * output. All functions return decorated strings, never write to stdout
 * directly.
 */

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

const ESC = "\x1b[";
const RESET = `${ESC}0m`;

function rgb(r: number, g: number, b: number): string {
  return `${ESC}38;2;${r};${g};${b}m`;
}

function bgRgb(r: number, g: number, b: number): string {
  return `${ESC}48;2;${r};${g};${b}m`;
}

function style(code: number): (text: string) => string {
  return (text: string) => `${ESC}${code}m${text}${RESET}`;
}

// ---------------------------------------------------------------------------
// Semantic colors
// ---------------------------------------------------------------------------

/** Brand cyan — primary accent */
export function primary(text: string): string {
  return `${rgb(0, 210, 255)}${text}${RESET}`;
}

/** Bright green — success states */
export function success(text: string): string {
  return `${rgb(80, 250, 123)}${text}${RESET}`;
}

/** Amber — warnings, pending states */
export function warning(text: string): string {
  return `${rgb(255, 183, 77)}${text}${RESET}`;
}

/** Red — errors, failures */
export function error(text: string): string {
  return `${rgb(255, 85, 85)}${text}${RESET}`;
}

/** Soft gray — secondary/muted text */
export function dim(text: string): string {
  return `${ESC}2m${text}${RESET}`;
}

/** Purple accent — encryption, special features */
export function accent(text: string): string {
  return `${rgb(189, 147, 249)}${text}${RESET}`;
}

/** White bold — emphasis */
export function bold(text: string): string {
  return `${ESC}1m${text}${RESET}`;
}

/** Underline */
export function underline(text: string): string {
  return `${ESC}4m${text}${RESET}`;
}

/** Italic */
export function italic(text: string): string {
  return `${ESC}3m${text}${RESET}`;
}

// ---------------------------------------------------------------------------
// User colors — each connected peer gets a distinct color
// ---------------------------------------------------------------------------

const USER_COLORS = [
  { r: 0, g: 210, b: 255 },    // Cyan (self)
  { r: 255, g: 121, b: 198 },  // Pink
  { r: 80, g: 250, b: 123 },   // Green
  { r: 255, g: 183, b: 77 },   // Orange
  { r: 189, g: 147, b: 249 },  // Purple
  { r: 139, g: 233, b: 253 },  // Light cyan
  { r: 241, g: 250, b: 140 },  // Yellow
  { r: 255, g: 85, b: 85 },    // Red
];

/**
 * Color a username for display. Index 0 = self (cyan), 1+ = peers.
 */
export function userColor(text: string, colorIndex: number): string {
  const c = USER_COLORS[colorIndex % USER_COLORS.length]!;
  return `${rgb(c.r, c.g, c.b)}${text}${RESET}`;
}

/**
 * Get a background-highlighted user tag like [alice].
 */
export function userTag(username: string, colorIndex: number): string {
  const c = USER_COLORS[colorIndex % USER_COLORS.length]!;
  return `${rgb(c.r, c.g, c.b)}[${username}]${RESET}`;
}

// ---------------------------------------------------------------------------
// Gradient text
// ---------------------------------------------------------------------------

type RGB = { r: number; g: number; b: number };

function interpolate(a: RGB, b: RGB, t: number): RGB {
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  };
}

/**
 * Apply a horizontal gradient across a line of text.
 */
export function gradient(
  text: string,
  from: RGB = { r: 0, g: 210, b: 255 },
  to: RGB = { r: 189, g: 147, b: 249 }
): string {
  const chars = [...text];
  if (chars.length <= 1) {
    return `${rgb(from.r, from.g, from.b)}${text}${RESET}`;
  }

  let result = "";
  for (let i = 0; i < chars.length; i++) {
    const t = i / (chars.length - 1);
    const c = interpolate(from, to, t);
    result += `${rgb(c.r, c.g, c.b)}${chars[i]}`;
  }

  return result + RESET;
}

// ---------------------------------------------------------------------------
// Status icons
// ---------------------------------------------------------------------------

export const icons = {
  connected: "●",
  disconnected: "○",
  connecting: "◌",
  encrypted: "🔒",
  check: "✓",
  cross: "✗",
  arrow: "→",
  arrowRight: "▸",
  dot: "·",
  dash: "─",
  pipe: "│",
  info: "ℹ",
  warning: "⚠",
  key: "🔑",
  terminal: "❯",
} as const;
