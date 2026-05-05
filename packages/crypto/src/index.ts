/**
 * @t-bridge/crypto — End-to-end encryption for T-Bridge terminal sessions.
 *
 * Uses X25519 ECDH for key exchange, HKDF-SHA256 for key derivation, and
 * AES-256-GCM for authenticated encryption. All operations use Node.js
 * built-in crypto, so no external dependencies are needed.
 *
 * Flow:
 *   1. Each peer calls generateEphemeralKeyPair() on SESSION_READY.
 *   2. Peers exchange public keys through the relay (KEY_EXCHANGE message).
 *   3. Each peer calls createSessionCipher(ownPrivateKey, peerPublicKey).
 *   4. All subsequent PTY data is encrypted/decrypted through the cipher.
 */

import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Key pair generation
// ---------------------------------------------------------------------------

export type EphemeralKeyPair = {
  publicKey: Buffer;
  privateKey: crypto.KeyObject;
};

/**
 * Generate an ephemeral X25519 key pair for a single session.
 */
export function generateEphemeralKeyPair(): EphemeralKeyPair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("x25519");

  return {
    publicKey: publicKey.export({ type: "spki", format: "der" }),
    privateKey
  };
}

/**
 * Import a peer's raw public key (DER/SPKI) into a KeyObject.
 */
export function importPublicKey(derBytes: Buffer): crypto.KeyObject {
  return crypto.createPublicKey({
    key: derBytes,
    type: "spki",
    format: "der"
  });
}

// ---------------------------------------------------------------------------
// Key derivation
// ---------------------------------------------------------------------------

const HKDF_HASH = "sha256";
const HKDF_SALT = Buffer.alloc(32, 0); // deterministic zero salt
const HKDF_INFO = Buffer.from("t-bridge-session-v1", "utf8");
const AES_KEY_BYTES = 32;

/**
 * Derive a 256-bit AES-GCM session key from an X25519 shared secret via HKDF.
 */
export function deriveSessionKey(
  ownPrivateKey: crypto.KeyObject,
  peerPublicKey: crypto.KeyObject
): Buffer {
  const sharedSecret = crypto.diffieHellman({
    publicKey: peerPublicKey,
    privateKey: ownPrivateKey
  });

  return Buffer.from(
    crypto.hkdfSync(HKDF_HASH, sharedSecret, HKDF_SALT, HKDF_INFO, AES_KEY_BYTES)
  );
}

// ---------------------------------------------------------------------------
// SessionCipher — encrypt/decrypt with nonce management
// ---------------------------------------------------------------------------

const NONCE_BYTES = 12; // AES-GCM standard
const TAG_BYTES = 16;

export type EncryptedChunk = {
  /** Base64-encoded ciphertext + auth tag */
  ciphertext: string;
  /** Base64-encoded 12-byte nonce */
  nonce: string;
};

/**
 * Stateful cipher for a single session. Maintains a monotonic nonce counter
 * for replay protection. Each direction (send/receive) should use its own
 * counter tracked by the cipher.
 */
export class SessionCipher {
  private readonly key: Buffer;
  private sendCounter: bigint = 0n;
  private readonly senderPrefix: Buffer;
  private lastReceivedCounter: bigint = -1n;

  /**
   * @param key 256-bit AES-GCM key from deriveSessionKey.
   * @param senderId 4-byte identifier to disambiguate sender nonces.
   *                 Use 0x00000001 for host and 0x00000002 for guest.
   */
  constructor(key: Buffer, senderId: number) {
    this.key = key;
    this.senderPrefix = Buffer.alloc(4);
    this.senderPrefix.writeUInt32BE(senderId);
  }

  /**
   * Encrypt a plaintext chunk. Returns base64-encoded ciphertext and nonce.
   */
  encrypt(plaintext: string): EncryptedChunk {
    const nonce = this.buildNonce(this.sendCounter);
    this.sendCounter += 1n;

    const cipher = crypto.createCipheriv("aes-256-gcm", this.key, nonce);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
      cipher.getAuthTag()
    ]);

    return {
      ciphertext: encrypted.toString("base64"),
      nonce: nonce.toString("base64")
    };
  }

  /**
   * Decrypt a ciphertext chunk. Validates the nonce is strictly increasing
   * to prevent replay attacks.
   */
  decrypt(chunk: EncryptedChunk): string {
    const nonce = Buffer.from(chunk.nonce, "base64");
    const data = Buffer.from(chunk.ciphertext, "base64");

    if (nonce.length !== NONCE_BYTES) {
      throw new Error("invalid nonce length");
    }

    if (data.length < TAG_BYTES) {
      throw new Error("ciphertext too short");
    }

    // Extract counter from nonce for replay check (bytes 4-12)
    const counterBytes = nonce.subarray(4, 12);
    const counter = counterBytes.readBigUInt64BE();

    if (counter <= this.lastReceivedCounter) {
      throw new Error("replay detected: nonce counter is not increasing");
    }

    this.lastReceivedCounter = counter;

    const ciphertext = data.subarray(0, data.length - TAG_BYTES);
    const authTag = data.subarray(data.length - TAG_BYTES);

    const decipher = crypto.createDecipheriv("aes-256-gcm", this.key, nonce);
    decipher.setAuthTag(authTag);

    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ]).toString("utf8");
  }

  private buildNonce(counter: bigint): Buffer {
    const nonce = Buffer.alloc(NONCE_BYTES);
    this.senderPrefix.copy(nonce, 0); // bytes 0-3: sender id
    nonce.writeBigUInt64BE(counter, 4); // bytes 4-11: counter
    return nonce;
  }
}

// ---------------------------------------------------------------------------
// High-level helpers
// ---------------------------------------------------------------------------

/** Sender IDs by role */
export const SENDER_ID = {
  host: 0x00000001,
  guest: 0x00000002
} as const;

/**
 * Create a SessionCipher from a key exchange.
 *
 * @param ownPrivateKey  Own ephemeral X25519 private key.
 * @param peerPublicDer  Peer's ephemeral public key (DER/SPKI bytes).
 * @param role           "host" or "guest".
 */
export function createSessionCipher(
  ownPrivateKey: crypto.KeyObject,
  peerPublicDer: Buffer,
  role: "host" | "guest"
): SessionCipher {
  const peerPublicKey = importPublicKey(peerPublicDer);
  const sessionKey = deriveSessionKey(ownPrivateKey, peerPublicKey);
  return new SessionCipher(sessionKey, SENDER_ID[role]);
}
