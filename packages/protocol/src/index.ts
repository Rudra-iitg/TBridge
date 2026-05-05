export type ClientRole = "host" | "guest";

export type PeerIdentity = {
  userId: string;
  deviceId: string;
  deviceName: string;
  publicKey: string;
};

export type ClientMessage =
  | { type: "REGISTER_HOST"; code: string; identity: PeerIdentity }
  | { type: "REGISTER_GUEST"; code: string; identity: PeerIdentity }
  | { type: "ACCESS_APPROVED" }
  | { type: "ACCESS_REJECTED"; reason?: string }
  | { type: "KEY_EXCHANGE"; ephemeralPublicKey: string }
  | { type: "ENCRYPTED_DATA"; ciphertext: string; nonce: string }
  | { type: "PTY_INPUT"; data: string }
  | { type: "PTY_OUTPUT"; data: string }
  | { type: "PTY_RESIZE"; cols: number; rows: number }
  | { type: "PTY_EXIT"; code: number | null }
  | { type: "SESSION_TERMINATE"; reason?: string }
  | { type: "RECONNECT"; sessionId: string; identity: PeerIdentity };

export type ServerMessage =
  | { type: "HOST_REGISTERED"; code: string }
  | { type: "ACCESS_REQUEST"; code: string; requester: PeerIdentity }
  | { type: "SESSION_READY"; sessionId: string; role: ClientRole }
  | { type: "ACCESS_REJECTED"; reason: string }
  | { type: "KEY_EXCHANGE"; ephemeralPublicKey: string }
  | { type: "ENCRYPTED_DATA"; ciphertext: string; nonce: string }
  | { type: "PTY_INPUT"; data: string }
  | { type: "PTY_OUTPUT"; data: string }
  | { type: "PTY_RESIZE"; cols: number; rows: number }
  | { type: "PTY_EXIT"; code: number | null }
  | { type: "SESSION_TERMINATE"; reason?: string }
  | { type: "RECONNECT_OK"; sessionId: string; role: ClientRole }
  | { type: "ERROR"; message: string };

export type WireMessage = ClientMessage | ServerMessage;

export function encodeMessage(message: WireMessage): string {
  return JSON.stringify(message);
}

export function decodeMessage(data: unknown): WireMessage {
  const text = typeof data === "string" ? data : data?.toString();
  if (!text) {
    throw new Error("empty message");
  }

  const parsed = JSON.parse(text) as Partial<WireMessage>;
  if (!parsed || typeof parsed.type !== "string") {
    throw new Error("invalid message");
  }

  return parsed as WireMessage;
}
