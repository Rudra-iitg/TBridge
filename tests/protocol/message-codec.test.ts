import { describe, expect, it } from "vitest";
import {
  decodeMessage,
  encodeMessage,
  type ClientMessage,
  type ServerMessage,
  type WireMessage
} from "../../packages/protocol/src/index.js";

describe("encodeMessage / decodeMessage", () => {
  it("round-trips a REGISTER_HOST message", () => {
    const original: ClientMessage = {
      type: "REGISTER_HOST",
      code: "123-456",
      identity: {
        userId: "alice",
        deviceId: "d1",
        deviceName: "mac-1",
        publicKey: "pk"
      }
    };

    const wire = encodeMessage(original);
    const decoded = decodeMessage(wire);
    expect(decoded).toEqual(original);
  });

  it("round-trips an ENCRYPTED_DATA message", () => {
    const original: ClientMessage = {
      type: "ENCRYPTED_DATA",
      ciphertext: "abc123==",
      nonce: "nonce123=="
    };

    const wire = encodeMessage(original);
    const decoded = decodeMessage(wire);
    expect(decoded).toEqual(original);
  });

  it("round-trips a KEY_EXCHANGE message", () => {
    const original: ClientMessage = {
      type: "KEY_EXCHANGE",
      ephemeralPublicKey: "pubkey-base64"
    };

    const wire = encodeMessage(original);
    const decoded = decodeMessage(wire);
    expect(decoded).toEqual(original);
  });

  it("round-trips a RECONNECT message", () => {
    const original: ClientMessage = {
      type: "RECONNECT",
      sessionId: "sess-123",
      identity: {
        userId: "bob",
        deviceId: "d2",
        deviceName: "linux-1",
        publicKey: "pk2"
      }
    };

    const wire = encodeMessage(original);
    const decoded = decodeMessage(wire);
    expect(decoded).toEqual(original);
  });

  it("round-trips a server ERROR message", () => {
    const original: ServerMessage = {
      type: "ERROR",
      message: "something went wrong"
    };

    const wire = encodeMessage(original);
    const decoded = decodeMessage(wire);
    expect(decoded).toEqual(original);
  });

  it("round-trips a PTY_OUTPUT message with binary-ish data", () => {
    const original: ServerMessage = {
      type: "PTY_OUTPUT",
      data: "\x1b[32mhello\x1b[0m\r\n"
    };

    const wire = encodeMessage(original);
    const decoded = decodeMessage(wire);
    expect(decoded).toEqual(original);
  });

  it("throws on empty input", () => {
    expect(() => decodeMessage("")).toThrow("empty message");
  });

  it("throws on null input", () => {
    expect(() => decodeMessage(null)).toThrow("empty message");
  });

  it("throws on invalid JSON", () => {
    expect(() => decodeMessage("{not json")).toThrow();
  });

  it("throws on JSON without type field", () => {
    expect(() => decodeMessage('{"data":"hello"}')).toThrow("invalid message");
  });

  it("throws on JSON with non-string type", () => {
    expect(() => decodeMessage('{"type":42}')).toThrow("invalid message");
  });

  it("handles all message types without crashing", () => {
    const messages: WireMessage[] = [
      { type: "REGISTER_HOST", code: "a", identity: { userId: "u", deviceId: "d", deviceName: "n", publicKey: "k" } },
      { type: "REGISTER_GUEST", code: "b", identity: { userId: "u", deviceId: "d", deviceName: "n", publicKey: "k" } },
      { type: "ACCESS_APPROVED" },
      { type: "ACCESS_REJECTED", reason: "no" },
      { type: "KEY_EXCHANGE", ephemeralPublicKey: "ek" },
      { type: "ENCRYPTED_DATA", ciphertext: "ct", nonce: "nc" },
      { type: "PTY_INPUT", data: "ls" },
      { type: "PTY_OUTPUT", data: "file.txt" },
      { type: "PTY_RESIZE", cols: 80, rows: 24 },
      { type: "PTY_EXIT", code: 0 },
      { type: "SESSION_TERMINATE", reason: "done" },
      { type: "RECONNECT", sessionId: "s", identity: { userId: "u", deviceId: "d", deviceName: "n", publicKey: "k" } },
      { type: "HOST_REGISTERED", code: "c" },
      { type: "SESSION_READY", sessionId: "s", role: "host" },
      { type: "RECONNECT_OK", sessionId: "s", role: "guest" },
      { type: "ERROR", message: "err" }
    ];

    for (const msg of messages) {
      const encoded = encodeMessage(msg);
      const decoded = decodeMessage(encoded);
      expect(decoded).toEqual(msg);
    }
  });
});
