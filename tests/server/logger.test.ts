import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { log, type LogFields, type LogLevel } from "../../apps/server/src/logger.js";

describe("Structured Logger", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  function parseLastLog(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown> {
    const lastCall = spy.mock.calls[spy.mock.calls.length - 1]!;
    const line = lastCall[0] as string;
    return JSON.parse(line.trim());
  }

  describe("log.info", () => {
    it("writes JSON to stdout", () => {
      log.info({ event: "relay.start", message: "started" });

      expect(stdoutSpy).toHaveBeenCalledOnce();
      expect(stderrSpy).not.toHaveBeenCalled();

      const entry = parseLastLog(stdoutSpy);
      expect(entry.level).toBe("info");
      expect(entry.event).toBe("relay.start");
      expect(entry.message).toBe("started");
    });

    it("includes an ISO timestamp", () => {
      log.info({ event: "host.register" });

      const entry = parseLastLog(stdoutSpy);
      expect(entry.ts).toBeDefined();
      // Validate ISO format
      expect(new Date(entry.ts as string).toISOString()).toBe(entry.ts);
    });

    it("passes through all custom fields", () => {
      log.info({
        event: "session.active",
        sessionId: "sess-42",
        code: "123-456",
        userId: "alice",
        deviceId: "dev-1",
        ip: "127.0.0.1",
        durationMs: 1500
      });

      const entry = parseLastLog(stdoutSpy);
      expect(entry.sessionId).toBe("sess-42");
      expect(entry.code).toBe("123-456");
      expect(entry.userId).toBe("alice");
      expect(entry.deviceId).toBe("dev-1");
      expect(entry.ip).toBe("127.0.0.1");
      expect(entry.durationMs).toBe(1500);
    });

    it("supports extra arbitrary fields", () => {
      log.info({
        event: "key.exchange",
        custom1: "value1",
        custom2: 42
      });

      const entry = parseLastLog(stdoutSpy);
      expect(entry.custom1).toBe("value1");
      expect(entry.custom2).toBe(42);
    });
  });

  describe("log.warn", () => {
    it("writes JSON to stdout with warn level", () => {
      log.warn({ event: "rate.limit", ip: "10.0.0.1", message: "limit exceeded" });

      expect(stdoutSpy).toHaveBeenCalledOnce();
      expect(stderrSpy).not.toHaveBeenCalled();

      const entry = parseLastLog(stdoutSpy);
      expect(entry.level).toBe("warn");
      expect(entry.event).toBe("rate.limit");
    });
  });

  describe("log.error", () => {
    it("writes JSON to stderr", () => {
      log.error({ event: "error", message: "something broke" });

      expect(stderrSpy).toHaveBeenCalledOnce();
      expect(stdoutSpy).not.toHaveBeenCalled();

      const entry = parseLastLog(stderrSpy);
      expect(entry.level).toBe("error");
      expect(entry.event).toBe("error");
      expect(entry.message).toBe("something broke");
    });
  });

  describe("output format", () => {
    it("ends each line with a newline", () => {
      log.info({ event: "relay.start" });

      const raw = stdoutSpy.mock.calls[0]![0] as string;
      expect(raw.endsWith("\n")).toBe(true);
    });

    it("is valid single-line JSON (NDJSON compatible)", () => {
      log.info({ event: "host.register", message: "line\nbreak" });

      const raw = stdoutSpy.mock.calls[0]![0] as string;
      // JSON.stringify escapes newlines in values, so the output should be a single line
      const lines = raw.trim().split("\n");
      expect(lines).toHaveLength(1);
    });

    it("produces parseable JSON for all log events", () => {
      const events = [
        "relay.start", "host.register", "guest.register",
        "access.request", "access.approve", "access.reject",
        "session.active", "session.end", "session.reconnect",
        "code.expire", "rate.limit", "key.exchange", "error"
      ] as const;

      for (const event of events) {
        stdoutSpy.mockClear();
        stderrSpy.mockClear();

        const level = event === "error" ? "error" : "info";
        log[level as "info" | "error"]({ event });

        const spy = event === "error" ? stderrSpy : stdoutSpy;
        const parsed = parseLastLog(spy);
        expect(parsed.event).toBe(event);
        expect(parsed.level).toBe(level);
        expect(parsed.ts).toBeDefined();
      }
    });
  });
});
