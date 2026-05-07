/**
 * Session — wraps a single node-pty instance with lifecycle management.
 *
 * Each Session owns one PTY process and emits structured events for
 * data, exit, and errors. Sessions track metadata (title, owner,
 * timestamps) and support cancellation + timeouts.
 */

import { EventEmitter } from "node:events";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import type { SessionInfo, SessionStatus } from "@tbridge/protocol";
import type { ISession, SessionEvents } from "./types.js";

// node-pty is CJS-only — use createRequire for ESM compat
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pty: any = require("node-pty");

interface IPty {
  pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  pause(): void;
  resume(): void;
  kill(signal?: string): void;
  onData(handler: (data: string) => void): void;
  onExit(handler: (exit: { exitCode: number; signal: number }) => void): void;
}

// ─── Types ───────────────────────────────────────────────────────

export type SessionOptions = {
  shell: string;
  cwd?: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
  title?: string;
  timeout?: number;
  owner: string;
  deviceId: string;
};

// ─── Session ─────────────────────────────────────────────────────

export class Session extends EventEmitter implements ISession {
  public readonly id: string;
  public readonly owner: string;
  public readonly deviceId: string;
  public readonly shell: string;
  public readonly createdAt: number;

  private _title: string;
  private _status: SessionStatus = "active";
  private _cols: number;
  private _rows: number;
  private _pty: IPty | null = null;
  private _timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private _exitCode: number | null = null;
  private _isPaused = false;

  constructor(options: SessionOptions) {
    super();

    this.id = crypto.randomUUID();
    this.owner = options.owner;
    this.deviceId = options.deviceId;
    this.shell = options.shell;
    this.createdAt = Date.now();
    this._title = options.title ?? this.shell.split("/").pop() ?? "shell";
    this._cols = options.cols ?? 80;
    this._rows = options.rows ?? 24;

    this._spawn(options);

    if (options.timeout && options.timeout > 0) {
      this.setTimeout(options.timeout);
    }
  }

  // ─── Accessors ────────────────────────────────────────────

  get title(): string {
    return this._title;
  }

  set title(value: string) {
    this._title = value;
    this.emit("titleChange", value);
  }

  get status(): SessionStatus {
    return this._status;
  }

  get cols(): number {
    return this._cols;
  }

  get rows(): number {
    return this._rows;
  }

  get exitCode(): number | null {
    return this._exitCode;
  }

  get pid(): number | undefined {
    return this._pty?.pid;
  }

  // ─── PTY Interaction ──────────────────────────────────────

  /** Write data to the PTY stdin. */
  write(data: string): void {
    if (this._status !== "active" || !this._pty) return;
    this._pty.write(data);
  }

  /** Resize the PTY. */
  resize(cols: number, rows: number): void {
    if (this._status !== "active" || !this._pty) return;
    this._cols = cols;
    this._rows = rows;
    try {
      this._pty.resize(cols, rows);
    } catch {
      // PTY may have already exited
    }
  }

  /** Pause PTY output (backpressure). */
  pause(): void {
    if (this._isPaused || !this._pty) return;
    this._isPaused = true;
    this._pty.pause();
  }

  /** Resume PTY output. */
  resume(): void {
    if (!this._isPaused || !this._pty) return;
    this._isPaused = false;
    this._pty.resume();
  }

  // ─── Execution Control ────────────────────────────────────

  /** Send SIGINT to the PTY process. */
  cancel(): void {
    if (!this._pty || this._status !== "active") return;
    // Write Ctrl+C to PTY
    this._pty.write("\x03");
  }

  /** Forcefully kill the PTY process. */
  kill(signal: string = "SIGKILL"): void {
    if (!this._pty || this._status !== "active") return;
    this._clearTimeout();
    try {
      this._pty.kill(signal);
    } catch {
      // Already exited
    }
  }

  /** Set a timeout — kills the session after `ms` milliseconds. */
  setTimeout(ms: number): void {
    this._clearTimeout();
    this._timeoutTimer = setTimeout(() => {
      if (this._status === "active") {
        this.emit("error", new Error(`session timed out after ${ms}ms`));
        this.kill();
      }
    }, ms);
  }

  /** Clear any pending timeout. */
  clearTimeout(): void {
    this._clearTimeout();
  }

  /** Clean shutdown — sends exit to shell, waits briefly, then kills. */
  async close(): Promise<void> {
    if (this._status !== "active" || !this._pty) return;

    // Try graceful exit first
    this._pty.write("exit\n");

    // Wait up to 2s for clean exit
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.kill("SIGTERM");
        resolve();
      }, 2000);

      this.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /** Serialize to SessionInfo for protocol transmission. */
  toInfo(): SessionInfo {
    return {
      id: this.id,
      deviceId: this.deviceId,
      owner: this.owner,
      shell: this.shell,
      status: this._status,
      title: this._title,
      cols: this._cols,
      rows: this._rows,
      createdAt: this.createdAt,
    };
  }

  // ─── Internal ─────────────────────────────────────────────

  private _spawn(options: SessionOptions): void {
    try {
      // Build clean env — filter out undefined values which crash posix_spawnp
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) {
        if (v !== undefined) env[k] = v;
      }
      if (options.env) Object.assign(env, options.env);
      env.TBRIDGE = "1";
      env.TBRIDGE_SESSION = this.id;

      this._pty = pty.spawn(options.shell, [], {
        name: env.TERM || "xterm-256color",
        cols: this._cols,
        rows: this._rows,
        cwd: options.cwd ?? env.HOME ?? process.cwd(),
        env,
      });

      const spawned = this._pty!;

      spawned.onData((data: string) => {
        this.emit("data", data);
      });

      spawned.onExit((exit: { exitCode: number; signal: number }) => {
        this._exitCode = exit.exitCode;
        this._setStatus("exited");
        this._clearTimeout();
        this.emit("exit", exit.exitCode, exit.signal);
      });
    } catch (err) {
      this._setStatus("exited");
      this.emit(
        "error",
        err instanceof Error ? err : new Error(String(err))
      );
    }
  }

  private _setStatus(status: SessionStatus): void {
    if (this._status === status) return;
    this._status = status;
    this.emit("statusChange", status);
  }

  private _clearTimeout(): void {
    if (this._timeoutTimer) {
      clearTimeout(this._timeoutTimer);
      this._timeoutTimer = null;
    }
  }
}
