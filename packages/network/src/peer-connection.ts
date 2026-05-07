import { EventEmitter } from "node:events";
import {
  generateEphemeralKeyPair,
  createSessionCipher,
  type SessionCipher,
  type EncryptedChunk
} from "@tbridge/crypto";
import type { Payload, Envelope, PeerIdentity } from "@tbridge/protocol";
import type { NetworkManager } from "./network-manager.js";

export class PeerConnection extends EventEmitter {
  private cipher: SessionCipher | null = null;
  private readonly ephemeralKeyPair = generateEphemeralKeyPair();
  private peerPublicKey: Buffer | null = null;
  
  public status: "connecting" | "handshake" | "encrypted" | "disconnected" = "connecting";

  constructor(
    public readonly network: NetworkManager,
    public readonly peerUser: string,
    public readonly peerDevice: string,
    public readonly role: "host" | "guest",
    private readonly initialPeerPublicKey?: string // Base64 DER if provided in PAIR_REQUEST
  ) {
    super();

    // Listen to network manager for messages from this specific peer
    this.network.on("message", this.handleEnvelope);

    if (this.initialPeerPublicKey) {
      this.peerPublicKey = Buffer.from(this.initialPeerPublicKey, "base64");
    }
  }

  private handleEnvelope = (envelope: Envelope) => {
    // Ensure message is from our peer
    if (envelope.from.user !== this.peerUser || envelope.from.device !== this.peerDevice) {
      return;
    }

    const { payload } = envelope;

    if (payload.kind === "KEY_EXCHANGE") {
      this.handleKeyExchange(Buffer.from(payload.ephemeralPublicKey, "base64"));
      return;
    }

    if (payload.kind === "ENCRYPTED") {
      if (!this.cipher) {
        this.emit("error", new Error("Received encrypted payload before handshake completed"));
        return;
      }
      
      try {
        const decryptedStr = this.cipher.decrypt({
          ciphertext: payload.ciphertext,
          nonce: payload.nonce
        });
        const decryptedPayload = JSON.parse(decryptedStr) as Payload;
        this.emit("payload", decryptedPayload);
      } catch (err) {
        this.emit("error", new Error(`Failed to decrypt payload: ${err}`));
      }
      return;
    }

    if (payload.kind === "DISCONNECT") {
      this.disconnect();
      return;
    }

    // Unencrypted control payloads can be emitted directly
    this.emit("payload", payload);
  };

  public startHandshake() {
    this.status = "handshake";
    const pubKeyBase64 = this.ephemeralKeyPair.publicKey.toString("base64");
    this.network.sendToPeer(this.peerUser, this.peerDevice, {
      kind: "KEY_EXCHANGE",
      ephemeralPublicKey: pubKeyBase64
    });

    if (this.peerPublicKey) {
      this.finalizeHandshake(this.peerPublicKey);
    }
  }

  private handleKeyExchange(peerKey: Buffer) {
    this.peerPublicKey = peerKey;
    if (this.status === "handshake") {
      this.finalizeHandshake(peerKey);
    } else {
      // We haven't started our side of the handshake yet
      this.startHandshake();
      this.finalizeHandshake(peerKey);
    }
  }

  private finalizeHandshake(peerKey: Buffer) {
    try {
      this.cipher = createSessionCipher(
        this.ephemeralKeyPair.privateKey,
        peerKey,
        this.role
      );
      this.status = "encrypted";
      this.emit("ready");
    } catch (err) {
      this.status = "disconnected";
      this.emit("error", new Error(`Failed to initialize cipher: ${err}`));
    }
  }

  public send(payload: Payload) {
    if (this.status !== "encrypted" || !this.cipher) {
      throw new Error("Cannot send payload: peer connection not fully encrypted");
    }

    const plaintext = JSON.stringify(payload);
    const encrypted: EncryptedChunk = this.cipher.encrypt(plaintext);

    this.network.sendToPeer(this.peerUser, this.peerDevice, {
      kind: "ENCRYPTED",
      ciphertext: encrypted.ciphertext,
      nonce: encrypted.nonce
    });
  }

  public sendUnencrypted(payload: Payload) {
    this.network.sendToPeer(this.peerUser, this.peerDevice, payload);
  }

  public disconnect() {
    if (this.status === "disconnected") return;
    this.status = "disconnected";
    this.network.off("message", this.handleEnvelope);
    this.emit("close");
  }
}
