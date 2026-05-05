import { describe, expect, it, vi, afterEach } from "vitest";
import { getDefaultShell, generateShareCode } from "../../apps/cli/src/terminal/platform.js";

describe("getDefaultShell", () => {
  const originalShell = process.env.SHELL;
  const originalComSpec = process.env.ComSpec;

  afterEach(() => {
    // Restore original env
    if (originalShell !== undefined) {
      process.env.SHELL = originalShell;
    } else {
      delete process.env.SHELL;
    }
    if (originalComSpec !== undefined) {
      process.env.ComSpec = originalComSpec;
    } else {
      delete process.env.ComSpec;
    }
  });

  it("returns the explicit shell argument if provided", () => {
    expect(getDefaultShell("/usr/bin/fish")).toBe("/usr/bin/fish");
  });

  it("falls back to SHELL env when no argument given", () => {
    process.env.SHELL = "/usr/local/bin/zsh";
    expect(getDefaultShell()).toBe("/usr/local/bin/zsh");
  });

  it("falls back to /bin/sh when SHELL env is empty (non-win32)", () => {
    delete process.env.SHELL;
    // On macOS/Linux (which is what we're running), it should return /bin/sh
    if (process.platform !== "win32") {
      expect(getDefaultShell()).toBe("/bin/sh");
    }
  });

  it("prefers explicit argument over SHELL env", () => {
    process.env.SHELL = "/bin/bash";
    expect(getDefaultShell("/bin/zsh")).toBe("/bin/zsh");
  });
});

describe("generateShareCode", () => {
  it("returns a string in NNN-NNN format", () => {
    const code = generateShareCode();
    expect(code).toMatch(/^\d{3}-\d{3}$/);
  });

  it("generates 3-digit numbers on each side", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateShareCode();
      const [first, second] = code.split("-");
      const n1 = Number(first);
      const n2 = Number(second);

      expect(n1).toBeGreaterThanOrEqual(100);
      expect(n1).toBeLessThanOrEqual(999);
      expect(n2).toBeGreaterThanOrEqual(100);
      expect(n2).toBeLessThanOrEqual(999);
    }
  });

  it("generates different codes across multiple calls", () => {
    const codes = new Set<string>();
    for (let i = 0; i < 100; i++) {
      codes.add(generateShareCode());
    }

    // With 810k possible codes and 100 attempts, we should get at least 90 unique
    expect(codes.size).toBeGreaterThan(90);
  });

  it("always contains a hyphen separator", () => {
    for (let i = 0; i < 20; i++) {
      expect(generateShareCode()).toContain("-");
    }
  });
});
