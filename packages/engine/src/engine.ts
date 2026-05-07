/**
 * ExecutionEngine — manages multiple concurrent terminal sessions.
 *
 * This is the central orchestrator for all PTY processes. It creates,
 * tracks, and destroys sessions, forwarding events up to the TUI layer.
 */

import { EventEmitter } from "node:events";
import os from "node:os";
import type { SessionInfo } from "@tbridge/protocol";
import { Session, type SessionOptions } from "./session.js";
import type { ISession } from "./types.js";

// ─── Types ───────────────────────────────────────────────────────

export type CreateSessionOptions = Omit<SessionOptions, "owner" | "deviceId"> & {
  owner?: string;
  deviceId?: string;
};

export interface EngineEvents {
  "session:created": (session: Session) => void;
  "session:data": (sessionId: string, data: string) => void;
  "session:exit": (sessionId: string, code: number | null) => void;
  "session:error": (sessionId: string, error: Error) => void;
  "session:closed": (sessionId: string) => void;
  "session:statusChange": (sessionId: string, status: string) => void;
}

// ─── Engine ──────────────────────────────────────────────────────

export class ExecutionEngine extends EventEmitter {
  private readonly sessions = new Map<string, ISession>();
  private readonly defaultOwner: string;
  private readonly defaultDeviceId: string;

  constructor(owner?: string, deviceId?: string) {
    super();
    this.defaultOwner = owner ?? process.env.USER ?? "local";
    this.defaultDeviceId = deviceId ?? `${os.hostname()}-${os.platform()}`;
  }

  // ─── Session Lifecycle ────────────────────────────────────

  /** Create and spawn a new terminal session. */
  createSession(options: CreateSessionOptions): Session {
    const session = new Session({
      ...options,
      owner: options.owner ?? this.defaultOwner,
      deviceId: options.deviceId ?? this.defaultDeviceId,
    });

    this.sessions.set(session.id, session);
    this._bindSession(session);
    this.emit("session:created", session);

    return session;
  }

  /** Register an external session (like RemoteSession) */
  attachSession(session: ISession): void {
    this.sessions.set(session.id, session);
    this._bindSession(session);
    this.emit("session:created", session as any);
  }

  /** Get a session by ID. */
  getSession(sessionId: string): ISession | undefined {
    return this.sessions.get(sessionId);
  }

  /** List all sessions. */
  listSessions(): ISession[] {
    return Array.from(this.sessions.values());
  }

  /** List all sessions as protocol-compatible SessionInfo. */
  listSessionInfos(): SessionInfo[] {
    return this.listSessions().map((s) => s.toInfo());
  }

  /** Get the count of active sessions. */
  get activeCount(): number {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.status === "active") count++;
    }
    return count;
  }

  /** Get the total session count (including exited). */
  get totalCount(): number {
    return this.sessions.size;
  }

  // ─── PTY Interaction ──────────────────────────────────────

  /** Write data to a session's PTY. */
  write(sessionId: string, data: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== "active") return false;
    session.write(data);
    return true;
  }

  /** Resize a session's PTY. */
  resize(sessionId: string, cols: number, rows: number): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== "active") return false;
    session.resize(cols, rows);
    return true;
  }

  // ─── Execution Control ────────────────────────────────────

  /** Send SIGINT (Ctrl+C) to a session. */
  cancel(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== "active") return false;
    session.cancel();
    return true;
  }

  /** Kill a session's PTY process. */
  kill(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== "active") return false;
    session.kill();
    return true;
  }

  /** Close a session gracefully and remove it. */
  async closeSession(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    if (session.status === "active") {
      await session.close();
    }

    this.sessions.delete(sessionId);
    this.emit("session:closed", sessionId);
    return true;
  }

  /** Remove exited sessions from the list. */
  pruneExited(): number {
    let pruned = 0;
    for (const [id, session] of this.sessions) {
      if (session.status === "exited") {
        this.sessions.delete(id);
        pruned++;
      }
    }
    return pruned;
  }

  /** Shut down all sessions. */
  async shutdown(): Promise<void> {
    const closePromises: Promise<void>[] = [];

    for (const session of this.sessions.values()) {
      if (session.status === "active") {
        closePromises.push(session.close());
      }
    }

    await Promise.allSettled(closePromises);
    this.sessions.clear();
  }

  // ─── Helpers ──────────────────────────────────────────────

  /** Detect the default shell for the current platform. */
  static detectShell(): string {
    if (process.env.SHELL) return process.env.SHELL;
    if (process.platform === "win32") return "powershell.exe";
    return "/bin/sh";
  }

  // ─── Internal ─────────────────────────────────────────────

  private _bindSession(session: ISession): void {
    session.on("data", (data: string) => {
      this.emit("session:data", session.id, data);
    });

    session.on("exit", (code: number | null) => {
      this.emit("session:exit", session.id, code);
    });

    session.on("error", (error: Error) => {
      this.emit("session:error", session.id, error);
    });

    session.on("statusChange", (status: string) => {
      this.emit("session:statusChange", session.id, status);
    });
  }
}
