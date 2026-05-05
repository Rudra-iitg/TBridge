/**
 * Structured JSON logger for the T-Bridge relay server.
 *
 * Each log line is a single JSON object written to stdout (info/warn) or
 * stderr (error). No external dependencies.
 */

export type LogLevel = "info" | "warn" | "error";

export type LogEvent =
  | "relay.start"
  | "host.register"
  | "guest.register"
  | "access.request"
  | "access.approve"
  | "access.reject"
  | "session.active"
  | "session.end"
  | "session.reconnect"
  | "code.expire"
  | "rate.limit"
  | "key.exchange"
  | "error";

export type LogFields = {
  event: LogEvent;
  sessionId?: string;
  code?: string;
  userId?: string;
  deviceId?: string;
  ip?: string;
  message?: string;
  durationMs?: number;
  [key: string]: unknown;
};

function write(level: LogLevel, fields: LogFields): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    ...fields
  };

  const line = JSON.stringify(entry) + "\n";

  if (level === "error") {
    process.stderr.write(line);
  } else {
    process.stdout.write(line);
  }
}

export const log = {
  info(fields: LogFields): void {
    write("info", fields);
  },

  warn(fields: LogFields): void {
    write("warn", fields);
  },

  error(fields: LogFields): void {
    write("error", fields);
  }
};
