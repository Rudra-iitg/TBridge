import { describe, expect, it, afterEach } from "vitest";
import { existsSync, statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import crypto from "node:crypto";

// Point identity store to a temp file
const testDir = path.join(tmpdir(), `tbridge-test-${crypto.randomUUID()}`);
const testIdentityPath = path.join(testDir, "identity.json");
process.env.TBRIDGE_IDENTITY_PATH = testIdentityPath;

// Must import AFTER setting env var so the module picks it up
const { createIdentity, loadIdentity, removeIdentity, publicIdentity, getIdentityPath } =
  await import("../../apps/cli/src/identity/identity-store.js");

describe("identity-store", () => {
  afterEach(async () => {
    try {
      unlinkSync(testIdentityPath);
    } catch {
      // ok if file doesn't exist
    }
  });

  it("getIdentityPath respects TBRIDGE_IDENTITY_PATH env", () => {
    expect(getIdentityPath()).toBe(testIdentityPath);
  });

  it("createIdentity generates a new identity", async () => {
    const identity = await createIdentity({ userId: "test-user", deviceName: "test-box" });

    expect(identity.userId).toBe("test-user");
    expect(identity.deviceName).toBe("test-box");
    expect(identity.deviceId).toBeTruthy();
    expect(identity.publicKey).toContain("PUBLIC KEY");
    expect(identity.createdAt).toBeTruthy();
  });

  it("identity file is written with restricted permissions on unix", async () => {
    await createIdentity({ userId: "perm-test" });
    expect(existsSync(testIdentityPath)).toBe(true);

    if (process.platform !== "win32") {
      const stats = statSync(testIdentityPath);
      const mode = stats.mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });

  it("loadIdentity returns undefined when no file exists", async () => {
    const identity = await loadIdentity();
    expect(identity).toBeUndefined();
  });

  it("loadIdentity returns a previously created identity", async () => {
    const created = await createIdentity({ userId: "roundtrip" });
    const loaded = await loadIdentity();

    expect(loaded).toBeDefined();
    expect(loaded!.userId).toBe("roundtrip");
    expect(loaded!.deviceId).toBe(created.deviceId);
  });

  it("removeIdentity deletes the identity file", async () => {
    await createIdentity({ userId: "delete-me" });
    expect(existsSync(testIdentityPath)).toBe(true);

    await removeIdentity();
    expect(existsSync(testIdentityPath)).toBe(false);
  });

  it("removeIdentity is idempotent", async () => {
    await removeIdentity();
    await removeIdentity(); // should not throw
  });

  it("publicIdentity strips private key material", async () => {
    const identity = await createIdentity({ userId: "pub-test" });
    const pub = publicIdentity(identity);

    expect(pub.userId).toBe("pub-test");
    expect(pub.publicKey).toBeTruthy();
    expect((pub as any).privateKey).toBeUndefined();
    expect((pub as any).privateKeyStore).toBeUndefined();
    expect((pub as any).createdAt).toBeUndefined();
  });

  it("createIdentity generates unique deviceIds", async () => {
    const id1 = await createIdentity({ userId: "u1" });
    await removeIdentity();
    const id2 = await createIdentity({ userId: "u2" });

    expect(id1.deviceId).not.toBe(id2.deviceId);
  });
});
