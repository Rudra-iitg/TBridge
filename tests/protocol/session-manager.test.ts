import { describe, expect, it, vi, beforeEach } from "vitest";
import { SessionManager } from "../../apps/server/src/session-manager.js";
import type { PeerIdentity } from "../../packages/protocol/src/index.js";

// Minimal mock WebSocket that satisfies the SessionManager's usage
function mockSocket(id = "s1"): any {
  return {
    _id: id,
    readyState: 1,
    send: vi.fn(),
    close: vi.fn()
  };
}

function mockIdentity(userId = "alice", deviceId = "d1"): PeerIdentity {
  return {
    userId,
    deviceId,
    deviceName: "test-device",
    publicKey: "pk"
  };
}

describe("SessionManager", () => {
  let sm: SessionManager;

  beforeEach(() => {
    sm = new SessionManager(300_000); // 5 min TTL
  });

  describe("registerHost", () => {
    it("registers a host with a valid code", () => {
      const result = sm.registerHost(mockSocket(), "abc-123", mockIdentity());
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.room.code).toBe("abc-123");
        expect(result.room.state).toBe("waiting");
      }
    });

    it("rejects empty code", () => {
      const result = sm.registerHost(mockSocket(), "", mockIdentity());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toContain("required");
      }
    });

    it("rejects duplicate code", () => {
      sm.registerHost(mockSocket("s1"), "abc", mockIdentity());
      const result = sm.registerHost(mockSocket("s2"), "abc", mockIdentity());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toContain("already active");
      }
    });
  });

  describe("registerGuest", () => {
    it("registers a guest against a waiting room", () => {
      const hostSocket = mockSocket("host");
      sm.registerHost(hostSocket, "code-1", mockIdentity("host-user"));

      const guestSocket = mockSocket("guest");
      const result = sm.registerGuest(
        guestSocket,
        "code-1",
        mockIdentity("guest-user", "d2")
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.room.state).toBe("pending");
        expect(result.room.guest?.identity.userId).toBe("guest-user");
      }
    });

    it("rejects guest with unknown code", () => {
      const result = sm.registerGuest(
        mockSocket(),
        "nope",
        mockIdentity()
      );
      expect(result.ok).toBe(false);
    });

    it("rejects guest when room is already pending", () => {
      sm.registerHost(mockSocket("h"), "c", mockIdentity("h"));
      sm.registerGuest(mockSocket("g1"), "c", mockIdentity("g1", "d2"));

      const result = sm.registerGuest(
        mockSocket("g2"),
        "c",
        mockIdentity("g2", "d3")
      );
      expect(result.ok).toBe(false);
    });
  });

  describe("approve / reject", () => {
    it("approves and moves to active state", () => {
      const host = mockSocket("h");
      sm.registerHost(host, "c1", mockIdentity("h"));
      sm.registerGuest(mockSocket("g"), "c1", mockIdentity("g", "d2"));

      const result = sm.approve(host);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.room.state).toBe("active");
        expect(result.sessionId).toBeTruthy();
      }
    });

    it("rejects and moves to ended state", () => {
      const host = mockSocket("h");
      sm.registerHost(host, "c2", mockIdentity("h"));
      sm.registerGuest(mockSocket("g"), "c2", mockIdentity("g", "d2"));

      const result = sm.reject(host);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.room.state).toBe("ended");
      }
    });

    it("fails approval from non-host socket", () => {
      const host = mockSocket("h");
      const guest = mockSocket("g");
      sm.registerHost(host, "c3", mockIdentity("h"));
      sm.registerGuest(guest, "c3", mockIdentity("g", "d2"));

      const result = sm.approve(guest);
      expect(result.ok).toBe(false);
    });
  });

  describe("getPeer", () => {
    it("returns guest socket from host and vice versa", () => {
      const host = mockSocket("h");
      const guest = mockSocket("g");
      sm.registerHost(host, "c", mockIdentity("h"));
      sm.registerGuest(guest, "c", mockIdentity("g", "d2"));
      sm.approve(host);

      const fromHost = sm.getPeer(host);
      expect(fromHost.ok).toBe(true);
      if (fromHost.ok) {
        expect(fromHost.peer).toBe(guest);
      }

      const fromGuest = sm.getPeer(guest);
      expect(fromGuest.ok).toBe(true);
      if (fromGuest.ok) {
        expect(fromGuest.peer).toBe(host);
      }
    });

    it("fails for unknown socket", () => {
      const result = sm.getPeer(mockSocket("unknown"));
      expect(result.ok).toBe(false);
    });
  });

  describe("reconnect", () => {
    it("reconnects a host by deviceId", () => {
      const host = mockSocket("h");
      const guest = mockSocket("g");
      const hostId = mockIdentity("alice", "host-device");
      const guestId = mockIdentity("bob", "guest-device");

      sm.registerHost(host, "c", hostId);
      sm.registerGuest(guest, "c", guestId);
      const approval = sm.approve(host);
      expect(approval.ok).toBe(true);
      if (!approval.ok) return;

      const newHost = mockSocket("h2");
      const result = sm.reconnect(newHost, approval.sessionId, hostId);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.room.host.socket).toBe(newHost);
      }
    });

    it("reconnects a guest by deviceId", () => {
      const host = mockSocket("h");
      const guest = mockSocket("g");
      const hostId = mockIdentity("alice", "host-device");
      const guestId = mockIdentity("bob", "guest-device");

      sm.registerHost(host, "c", hostId);
      sm.registerGuest(guest, "c", guestId);
      const approval = sm.approve(host);
      expect(approval.ok).toBe(true);
      if (!approval.ok) return;

      const newGuest = mockSocket("g2");
      const result = sm.reconnect(newGuest, approval.sessionId, guestId);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.room.guest?.socket).toBe(newGuest);
      }
    });

    it("rejects reconnect with wrong identity", () => {
      const host = mockSocket("h");
      const guest = mockSocket("g");
      sm.registerHost(host, "c", mockIdentity("alice", "d1"));
      sm.registerGuest(guest, "c", mockIdentity("bob", "d2"));
      const approval = sm.approve(host);
      expect(approval.ok).toBe(true);
      if (!approval.ok) return;

      const intruder = mockSocket("intruder");
      const result = sm.reconnect(
        intruder,
        approval.sessionId,
        mockIdentity("eve", "d-evil")
      );
      expect(result.ok).toBe(false);
    });

    it("rejects reconnect for unknown session", () => {
      const result = sm.reconnect(
        mockSocket(),
        "nonexistent",
        mockIdentity()
      );
      expect(result.ok).toBe(false);
    });
  });

  describe("expireRooms", () => {
    it("expires rooms past their TTL", () => {
      const host = mockSocket("h");
      sm.registerHost(host, "c", mockIdentity(), 1000);

      // 5 minutes + 1ms later
      const expired = sm.expireRooms(1000 + 300_001);
      expect(expired).toHaveLength(1);
      expect(expired[0]!.state).toBe("ended");
    });

    it("does not expire active rooms", () => {
      const host = mockSocket("h");
      const guest = mockSocket("g");
      sm.registerHost(host, "c", mockIdentity(), 1000);
      sm.registerGuest(guest, "c", mockIdentity("g", "d2"), 1000);
      sm.approve(host);

      const expired = sm.expireRooms(1000 + 300_001);
      expect(expired).toHaveLength(0);
    });
  });

  describe("releaseSocket", () => {
    it("cleans up host and guest", () => {
      const host = mockSocket("h");
      const guest = mockSocket("g");
      sm.registerHost(host, "c", mockIdentity());
      sm.registerGuest(guest, "c", mockIdentity("g", "d2"));
      sm.approve(host);

      const room = sm.releaseSocket(host);
      expect(room?.state).toBe("ended");
      expect(sm.getRoom(guest)).toBeUndefined();
    });

    it("returns undefined for unknown socket", () => {
      expect(sm.releaseSocket(mockSocket())).toBeUndefined();
    });
  });
});
