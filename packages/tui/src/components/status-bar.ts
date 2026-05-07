/**
 * StatusBar — top bar showing branding, identity, and connection status.
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  T-Bridge  v2.0    @rudra · macbook    ● 2 peers connected     │
 * └─────────────────────────────────────────────────────────────────┘
 */

import type { Screen } from "../screen.js";
import {
  gradient,
  bold,
  muted,
  primary,
  success,
  warning,
  padEnd,
  moveTo,
  clearToEOL,
  colors,
  icons,
} from "../theme.js";

export type StatusBarState = {
  version: string;
  userId: string;
  deviceName: string;
  peerCount: number;
  activeSessions: number;
  mode: "local" | "connected";
};

export class StatusBar {
  private _state: StatusBarState;
  private readonly _screen: Screen;

  constructor(screen: Screen, initialState: Partial<StatusBarState> = {}) {
    this._screen = screen;
    this._state = {
      version: initialState.version ?? "2.0.0",
      userId: initialState.userId ?? "local",
      deviceName: initialState.deviceName ?? "device",
      peerCount: initialState.peerCount ?? 0,
      activeSessions: initialState.activeSessions ?? 0,
      mode: initialState.mode ?? "local",
    };
  }

  get height(): number {
    return 1;
  }

  update(state: Partial<StatusBarState>): void {
    Object.assign(this._state, state);
    this.render();
  }

  render(): void {
    const s = this._state;
    const width = this._screen.cols;

    // Left section: branding
    const brand = gradient(" T-Bridge ", colors.primary, colors.secondary);
    const version = muted(` v${s.version}`);

    // Center section: identity
    const identity =
      primary(`@${s.userId}`) +
      muted(` ${icons.dot} `) +
      muted(s.deviceName);

    // Right section: connection status
    let statusIcon: string;
    let statusText: string;

    if (s.peerCount > 0) {
      statusIcon = success(icons.connected);
      statusText = success(`${s.peerCount} peer${s.peerCount > 1 ? "s" : ""}`);
    } else {
      statusIcon = muted(icons.disconnected);
      statusText = muted("no peers");
    }

    const sessions = muted(`${s.activeSessions} session${s.activeSessions !== 1 ? "s" : ""}`);
    const rightSection = `${statusIcon} ${statusText}  ${muted(icons.dot)}  ${sessions} `;

    // Compose the line with background
    const bg = `\x1b[48;2;${colors.bgSurface.r};${colors.bgSurface.g};${colors.bgSurface.b}m`;
    const reset = "\x1b[0m";

    // Build: brand + spacer + identity + spacer + right
    const leftPart = `${brand}${version}    ${identity}`;
    const line = padEnd(`${bg}${leftPart}`, width - 30) + padEnd(rightSection, 30);

    this._screen.writeAt(1, 1, `${bg}${padEnd("", width)}${reset}`);
    this._screen.writeAt(1, 1, `${bg}${leftPart}`);
    // Right-align status
    const rightStart = Math.max(width - 35, 50);
    this._screen.writeAt(rightStart, 1, `${bg}${rightSection}${reset}`);
  }
}
