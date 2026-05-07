import { describe, it, expect, vi, beforeEach } from "vitest";
import { PeerConnection } from "../src/peer-connection.js";
import { NetworkManager } from "../src/network-manager.js";
import type { Payload, PeerIdentity } from "@tbridge/protocol";

describe("PeerConnection", () => {
  let hostNetwork: NetworkManager;
  let guestNetwork: NetworkManager;

  beforeEach(() => {
    hostNetwork = new NetworkManager("hostUser", "hostDevice", { shells: [], canExecute: true, os: "mac", arch: "arm" }, "hostKey");
    guestNetwork = new NetworkManager("guestUser", "guestDevice", { shells: [], canExecute: true, os: "mac", arch: "arm" }, "guestKey");

    // Mock sendToPeer to route messages between the two NetworkManagers
    vi.spyOn(hostNetwork, "sendToPeer").mockImplementation((user, device, payload) => {
      if (user === "guestUser") {
        guestNetwork.emit("message", {
          from: { user: "hostUser", device: "hostDevice" },
          to: { kind: "peer", user, device },
          payload
        });
      }
      return "msg-id";
    });

    vi.spyOn(guestNetwork, "sendToPeer").mockImplementation((user, device, payload) => {
      if (user === "hostUser") {
        hostNetwork.emit("message", {
          from: { user: "guestUser", device: "guestDevice" },
          to: { kind: "peer", user, device },
          payload
        });
      }
      return "msg-id";
    });
  });

  it("should perform key exchange and allow encrypted communication", () => {
    const hostConn = new PeerConnection(hostNetwork, "guestUser", "guestDevice", "host");
    const guestConn = new PeerConnection(guestNetwork, "hostUser", "hostDevice", "guest");

    // Start handshake from host
    hostConn.startHandshake();
    
    // Handshake should trigger Guest to respond
    expect(hostConn.status).toBe("encrypted");
    expect(guestConn.status).toBe("encrypted");

    // Test sending encrypted data
    const guestOnPayload = vi.fn();
    guestConn.on("payload", guestOnPayload);

    hostConn.send({ kind: "PING" });

    expect(guestOnPayload).toHaveBeenCalledWith({ kind: "PING" });
  });
});
