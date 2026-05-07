import { EventEmitter } from "node:events";
import crypto from "node:crypto";
import type { SessionInfo, SessionStatus, Payload } from "@tbridge/protocol";
import type { ISession, SessionEvents } from "./types.js";
import type { PeerConnection } from "@tbridge/network";

export class RemoteSession extends EventEmitter implements ISession {
  public readonly id: string;
  public readonly createdAt: number;
  public title: string = "Remote Session";
  public status: SessionStatus = "active";
  public exitCode: number | null = null;
  public readonly pid?: number = undefined;

  constructor(
    public readonly owner: string,
    public readonly deviceId: string,
    public readonly shell: string,
    public cols: number,
    public rows: number,
    private readonly connection: PeerConnection,
    remoteId?: string
  ) {
    super();
    this.id = remoteId || crypto.randomUUID();
    this.createdAt = Date.now();

    // Listen for PTY data from the remote peer
    this.connection.on("payload", (payload: Payload) => {
      if (payload.kind === "PTY_DATA" && payload.sessionId === this.id) {
        this.emit("data", payload.data);
      } else if (payload.kind === "PTY_RESIZE" && payload.sessionId === this.id) {
        this.cols = payload.cols;
        this.rows = payload.rows;
      }
    });

    this.connection.on("close", () => {
      this.status = "exited";
      this.exitCode = 0;
      this.emit("statusChange", this.status);
      this.emit("exit", 0, null);
    });
  }

  public write(data: string): void {
    if (this.status !== "active") return;
    this.connection.send({
      kind: "PTY_DATA",
      sessionId: this.id,
      data
    });
  }

  public resize(cols: number, rows: number): void {
    if (this.status !== "active") return;
    this.cols = cols;
    this.rows = rows;
    this.connection.send({
      kind: "PTY_RESIZE",
      sessionId: this.id,
      cols,
      rows
    });
  }

  public pause(): void {
    this.status = "idle";
    this.emit("statusChange", this.status);
  }

  public resume(): void {
    this.status = "active";
    this.emit("statusChange", this.status);
  }

  public cancel(): void {
    this.kill();
  }

  public kill(signal?: string): void {
    if (this.status === "exited") return;
    this.status = "exited";
    this.exitCode = 130; // typically SIGINT
    this.emit("statusChange", this.status);
    this.emit("exit", this.exitCode, null);
    // Potentially send a kill payload to the peer if supported
  }

  public async close(): Promise<void> {
    this.kill();
  }

  public toInfo(): SessionInfo {
    return {
      id: this.id,
      title: this.title,
      owner: this.owner,
      deviceId: this.deviceId,
      shell: this.shell,
      status: this.status,
      createdAt: this.createdAt,
      cols: this.cols,
      rows: this.rows
    };
  }
}
