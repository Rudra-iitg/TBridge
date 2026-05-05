import { describe, expect, it } from "vitest";
import {
  createSessionCipher,
  generateEphemeralKeyPair,
  importPublicKey,
  deriveSessionKey,
  SessionCipher,
  SENDER_ID
} from "../../packages/crypto/src/index.js";

describe("generateEphemeralKeyPair", () => {
  it("generates a key pair with a public key buffer", () => {
    const kp = generateEphemeralKeyPair();
    expect(kp.publicKey).toBeInstanceOf(Buffer);
    expect(kp.publicKey.length).toBeGreaterThan(0);
    expect(kp.privateKey).toBeDefined();
  });

  it("generates unique key pairs each time", () => {
    const kp1 = generateEphemeralKeyPair();
    const kp2 = generateEphemeralKeyPair();
    expect(kp1.publicKey.equals(kp2.publicKey)).toBe(false);
  });
});

describe("key exchange + shared secret", () => {
  it("derives the same session key for both peers", () => {
    const hostKp = generateEphemeralKeyPair();
    const guestKp = generateEphemeralKeyPair();

    const hostPeerPub = importPublicKey(guestKp.publicKey);
    const guestPeerPub = importPublicKey(hostKp.publicKey);

    const hostKey = deriveSessionKey(hostKp.privateKey, hostPeerPub);
    const guestKey = deriveSessionKey(guestKp.privateKey, guestPeerPub);

    expect(hostKey.equals(guestKey)).toBe(true);
    expect(hostKey.length).toBe(32); // AES-256
  });
});

describe("SessionCipher encrypt/decrypt", () => {
  function createPair(): [SessionCipher, SessionCipher] {
    const hostKp = generateEphemeralKeyPair();
    const guestKp = generateEphemeralKeyPair();

    const hostCipher = createSessionCipher(
      hostKp.privateKey,
      guestKp.publicKey,
      "host"
    );
    const guestCipher = createSessionCipher(
      guestKp.privateKey,
      hostKp.publicKey,
      "guest"
    );

    return [hostCipher, guestCipher];
  }

  it("round-trips a simple string (host → guest)", () => {
    const [host, guest] = createPair();
    const encrypted = host.encrypt("hello world");
    const decrypted = guest.decrypt(encrypted);
    expect(decrypted).toBe("hello world");
  });

  it("round-trips a simple string (guest → host)", () => {
    const [host, guest] = createPair();
    const encrypted = guest.encrypt("ping");
    const decrypted = host.decrypt(encrypted);
    expect(decrypted).toBe("ping");
  });

  it("round-trips terminal escape sequences", () => {
    const [host, guest] = createPair();
    const ansi = "\x1b[32mgreen text\x1b[0m\r\n";
    const encrypted = host.encrypt(ansi);
    const decrypted = guest.decrypt(encrypted);
    expect(decrypted).toBe(ansi);
  });

  it("handles empty string", () => {
    const [host, guest] = createPair();
    const encrypted = host.encrypt("");
    const decrypted = guest.decrypt(encrypted);
    expect(decrypted).toBe("");
  });

  it("handles large payload", () => {
    const [host, guest] = createPair();
    const bigPayload = "A".repeat(100_000);
    const encrypted = host.encrypt(bigPayload);
    const decrypted = guest.decrypt(encrypted);
    expect(decrypted).toBe(bigPayload);
  });

  it("encrypts multiple messages with increasing nonces", () => {
    const [host, guest] = createPair();

    for (let i = 0; i < 100; i++) {
      const msg = `message-${i}`;
      const encrypted = host.encrypt(msg);
      const decrypted = guest.decrypt(encrypted);
      expect(decrypted).toBe(msg);
    }
  });

  it("rejects decryption with wrong key", () => {
    const hostKp1 = generateEphemeralKeyPair();
    const guestKp = generateEphemeralKeyPair();
    const hostKp2 = generateEphemeralKeyPair(); // different key pair

    const realCipher = createSessionCipher(
      hostKp1.privateKey,
      guestKp.publicKey,
      "host"
    );
    const wrongCipher = createSessionCipher(
      hostKp2.privateKey,
      guestKp.publicKey,
      "guest"
    );

    const encrypted = realCipher.encrypt("secret");
    expect(() => wrongCipher.decrypt(encrypted)).toThrow();
  });

  it("detects replay (same nonce reused)", () => {
    const [host, guest] = createPair();
    const encrypted1 = host.encrypt("first");
    const encrypted2 = host.encrypt("second");

    // Decrypt in order works
    guest.decrypt(encrypted1);
    guest.decrypt(encrypted2);

    // Replaying encrypted1 should fail (nonce counter went backwards)
    expect(() => guest.decrypt(encrypted1)).toThrow("replay");
  });

  it("rejects tampered ciphertext", () => {
    const [host, guest] = createPair();
    const encrypted = host.encrypt("original");

    // Tamper with ciphertext
    const tamperedBytes = Buffer.from(encrypted.ciphertext, "base64");
    tamperedBytes[0] = tamperedBytes[0]! ^ 0xff;
    const tampered = {
      ...encrypted,
      ciphertext: tamperedBytes.toString("base64")
    };

    expect(() => guest.decrypt(tampered)).toThrow();
  });

  it("rejects invalid nonce length", () => {
    const [host, guest] = createPair();
    const encrypted = host.encrypt("test");

    const badNonce = { ...encrypted, nonce: Buffer.alloc(5).toString("base64") };
    expect(() => guest.decrypt(badNonce)).toThrow("nonce length");
  });

  it("rejects ciphertext that is too short", () => {
    const [, guest] = createPair();

    const short = {
      ciphertext: Buffer.alloc(4).toString("base64"),
      nonce: Buffer.alloc(12).toString("base64")
    };
    expect(() => guest.decrypt(short)).toThrow("too short");
  });
});

describe("SENDER_ID", () => {
  it("has distinct IDs for host and guest", () => {
    expect(SENDER_ID.host).not.toBe(SENDER_ID.guest);
  });
});
