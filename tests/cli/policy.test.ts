import { describe, expect, it, afterEach } from "vitest";
import { existsSync, unlinkSync, mkdirSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import crypto from "node:crypto";

// Point policy to a temp file
const testDir = path.join(tmpdir(), `tbridge-policy-test-${crypto.randomUUID()}`);
const testPolicyPath = path.join(testDir, "policy.json");
process.env.TBRIDGE_POLICY_PATH = testPolicyPath;

// Must import AFTER setting env var so the module picks it up
const {
  getPolicyPath,
  loadPolicy,
  savePolicy,
  setUserAccess,
  removeUserAccess,
  decideAccess
} = await import("../../apps/cli/src/permissions/policy.js");

describe("permissions/policy", () => {
  afterEach(() => {
    try {
      unlinkSync(testPolicyPath);
    } catch {
      // ok if file doesn't exist
    }
  });

  describe("getPolicyPath", () => {
    it("respects TBRIDGE_POLICY_PATH env", () => {
      expect(getPolicyPath()).toBe(testPolicyPath);
    });
  });

  describe("loadPolicy", () => {
    it("returns default policy when no file exists", async () => {
      const policy = await loadPolicy();

      expect(policy.defaultPolicy).toBe("ask");
      expect(policy.users).toEqual({});
    });

    it("returns saved policy from file", async () => {
      const original = {
        defaultPolicy: "ask" as const,
        users: {
          alice: { access: "trusted" as const, updatedAt: "2026-01-01T00:00:00Z" }
        }
      };

      await savePolicy(original);
      const loaded = await loadPolicy();

      expect(loaded.defaultPolicy).toBe("ask");
      expect(loaded.users.alice).toBeDefined();
      expect(loaded.users.alice!.access).toBe("trusted");
    });
  });

  describe("savePolicy", () => {
    it("creates the policy file and parent directory", async () => {
      const policy = {
        defaultPolicy: "ask" as const,
        users: {}
      };

      await savePolicy(policy);
      expect(existsSync(testPolicyPath)).toBe(true);
    });

    it("saves valid JSON", async () => {
      const policy = {
        defaultPolicy: "ask" as const,
        users: { bob: { access: "blocked" as const, updatedAt: "2026-01-01T00:00:00Z" } }
      };

      await savePolicy(policy);
      const loaded = await loadPolicy();
      expect(loaded.users.bob!.access).toBe("blocked");
    });
  });

  describe("setUserAccess", () => {
    it("adds a trusted user", async () => {
      const policy = await setUserAccess("alice", "trusted");

      expect(policy.users.alice).toBeDefined();
      expect(policy.users.alice!.access).toBe("trusted");
      expect(policy.users.alice!.updatedAt).toBeTruthy();
    });

    it("adds a blocked user", async () => {
      const policy = await setUserAccess("eve", "blocked");

      expect(policy.users.eve).toBeDefined();
      expect(policy.users.eve!.access).toBe("blocked");
    });

    it("overwrites existing access", async () => {
      await setUserAccess("alice", "trusted");
      const updated = await setUserAccess("alice", "blocked");

      expect(updated.users.alice!.access).toBe("blocked");
    });

    it("preserves other users when updating one", async () => {
      await setUserAccess("alice", "trusted");
      await setUserAccess("bob", "blocked");

      const policy = await loadPolicy();
      expect(policy.users.alice!.access).toBe("trusted");
      expect(policy.users.bob!.access).toBe("blocked");
    });

    it("sets a valid ISO timestamp on update", async () => {
      const policy = await setUserAccess("alice", "trusted");
      const ts = new Date(policy.users.alice!.updatedAt);

      expect(ts.toISOString()).toBe(policy.users.alice!.updatedAt);
    });
  });

  describe("removeUserAccess", () => {
    it("removes a user from the policy", async () => {
      await setUserAccess("alice", "trusted");
      const policy = await removeUserAccess("alice");

      expect(policy.users.alice).toBeUndefined();
    });

    it("is idempotent for non-existent users", async () => {
      const policy = await removeUserAccess("nobody");
      expect(policy.users.nobody).toBeUndefined();
    });

    it("leaves other users intact", async () => {
      await setUserAccess("alice", "trusted");
      await setUserAccess("bob", "blocked");
      await removeUserAccess("alice");

      const policy = await loadPolicy();
      expect(policy.users.alice).toBeUndefined();
      expect(policy.users.bob!.access).toBe("blocked");
    });
  });

  describe("decideAccess", () => {
    it("returns 'ask' for unknown users", async () => {
      const decision = await decideAccess("stranger");

      expect(decision.action).toBe("ask");
      expect(decision.reason).toContain("ask");
    });

    it("returns 'allow' for trusted users", async () => {
      await setUserAccess("alice", "trusted");
      const decision = await decideAccess("alice");

      expect(decision.action).toBe("allow");
      expect(decision.reason).toContain("alice");
      expect(decision.reason).toContain("trusted");
    });

    it("returns 'deny' for blocked users", async () => {
      await setUserAccess("eve", "blocked");
      const decision = await decideAccess("eve");

      expect(decision.action).toBe("deny");
      expect(decision.reason).toContain("eve");
      expect(decision.reason).toContain("blocked");
    });

    it("reflects updated access after policy change", async () => {
      await setUserAccess("alice", "trusted");
      expect((await decideAccess("alice")).action).toBe("allow");

      await setUserAccess("alice", "blocked");
      expect((await decideAccess("alice")).action).toBe("deny");

      await removeUserAccess("alice");
      expect((await decideAccess("alice")).action).toBe("ask");
    });
  });
});
