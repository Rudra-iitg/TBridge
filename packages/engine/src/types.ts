import type { EventEmitter } from "node:events";
import type { SessionInfo, SessionStatus } from "@tbridge/protocol";

export interface SessionEvents {
  data: (data: string) => void;
  exit: (code: number | null, signal: number | null) => void;
  error: (error: Error) => void;
  titleChange: (title: string) => void;
  statusChange: (status: SessionStatus) => void;
}

export interface ISession extends EventEmitter {
  readonly id: string;
  readonly owner: string;
  readonly deviceId: string;
  readonly shell: string;
  readonly createdAt: number;

  title: string;
  readonly status: SessionStatus;
  readonly cols: number;
  readonly rows: number;
  readonly exitCode: number | null;
  readonly pid?: number;

  write(data: string): void;
  resize(cols: number, rows: number): void;
  pause(): void;
  resume(): void;
  cancel(): void;
  kill(signal?: string): void;
  close(): Promise<void>;
  
  toInfo(): SessionInfo;
  
  // Strongly typed event emitter methods
  on<K extends keyof SessionEvents>(event: K, listener: SessionEvents[K]): this;
  emit<K extends keyof SessionEvents>(event: K, ...args: Parameters<SessionEvents[K]>): boolean;
}
