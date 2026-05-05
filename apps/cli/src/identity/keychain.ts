/**
 * OS-native credential store integration for T-Bridge private keys.
 *
 * Supports:
 *   - macOS: Keychain via `security` CLI
 *   - Linux: libsecret via `secret-tool` CLI
 *   - Windows: Credential Manager via `cmdkey` / PowerShell
 *   - Fallback: in-file storage with 0o600 permissions + warning
 *
 * All operations are async and never throw — they return undefined on failure
 * so the caller can fall back gracefully.
 */

import { execFile } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const SERVICE_NAME = "t-bridge";
const ACCOUNT_PREFIX = "tbridge-device-";

type Platform = "darwin" | "linux" | "win32" | "other";

function currentPlatform(): Platform {
  const p = os.platform();
  if (p === "darwin" || p === "linux" || p === "win32") {
    return p;
  }
  return "other";
}

// ---------------------------------------------------------------------------
// macOS Keychain
// ---------------------------------------------------------------------------

async function macStoreKey(
  deviceId: string,
  privateKeyPem: string
): Promise<boolean> {
  try {
    // Delete any existing entry first (ignore errors)
    await execFileAsync("security", [
      "delete-generic-password",
      "-s", SERVICE_NAME,
      "-a", ACCOUNT_PREFIX + deviceId
    ]).catch(() => {});

    await execFileAsync("security", [
      "add-generic-password",
      "-s", SERVICE_NAME,
      "-a", ACCOUNT_PREFIX + deviceId,
      "-w", privateKeyPem,
      "-U" // update if exists
    ]);
    return true;
  } catch {
    return false;
  }
}

async function macLoadKey(deviceId: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("security", [
      "find-generic-password",
      "-s", SERVICE_NAME,
      "-a", ACCOUNT_PREFIX + deviceId,
      "-w"
    ]);
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function macDeleteKey(deviceId: string): Promise<boolean> {
  try {
    await execFileAsync("security", [
      "delete-generic-password",
      "-s", SERVICE_NAME,
      "-a", ACCOUNT_PREFIX + deviceId
    ]);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Linux libsecret
// ---------------------------------------------------------------------------

async function linuxStoreKey(
  deviceId: string,
  privateKeyPem: string
): Promise<boolean> {
  try {
    const child = execFileAsync("secret-tool", [
      "store",
      "--label", `T-Bridge device ${deviceId}`,
      "service", SERVICE_NAME,
      "account", ACCOUNT_PREFIX + deviceId
    ]);

    child.child.stdin?.write(privateKeyPem);
    child.child.stdin?.end();
    await child;
    return true;
  } catch {
    return false;
  }
}

async function linuxLoadKey(deviceId: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("secret-tool", [
      "lookup",
      "service", SERVICE_NAME,
      "account", ACCOUNT_PREFIX + deviceId
    ]);
    return stdout || undefined;
  } catch {
    return undefined;
  }
}

async function linuxDeleteKey(deviceId: string): Promise<boolean> {
  try {
    await execFileAsync("secret-tool", [
      "clear",
      "service", SERVICE_NAME,
      "account", ACCOUNT_PREFIX + deviceId
    ]);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Windows Credential Manager
// ---------------------------------------------------------------------------

const WIN_TARGET_PREFIX = "tbridge:";

async function winStoreKey(
  deviceId: string,
  privateKeyPem: string
): Promise<boolean> {
  try {
    const target = WIN_TARGET_PREFIX + deviceId;
    // Use cmdkey to store
    await execFileAsync("cmdkey", [
      "/add:" + target,
      "/user:" + ACCOUNT_PREFIX + deviceId,
      "/pass:" + privateKeyPem
    ]);
    return true;
  } catch {
    return false;
  }
}

async function winLoadKey(deviceId: string): Promise<string | undefined> {
  try {
    const target = WIN_TARGET_PREFIX + deviceId;
    // PowerShell to retrieve stored credential
    const script = `
      $cred = Get-StoredCredential -Target "${target}" -ErrorAction SilentlyContinue
      if ($cred) { $cred.GetNetworkCredential().Password } else { "" }
    `;
    const { stdout } = await execFileAsync("powershell", [
      "-NoProfile", "-Command", script
    ]);
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function winDeleteKey(deviceId: string): Promise<boolean> {
  try {
    await execFileAsync("cmdkey", [
      "/delete:" + WIN_TARGET_PREFIX + deviceId
    ]);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type KeychainBackend = "keychain" | "file";

/**
 * Store a private key in the OS credential store.
 * Returns the backend used, or "file" if all OS stores failed.
 */
export async function storePrivateKey(
  deviceId: string,
  privateKeyPem: string
): Promise<KeychainBackend> {
  const platform = currentPlatform();

  let stored = false;

  switch (platform) {
    case "darwin":
      stored = await macStoreKey(deviceId, privateKeyPem);
      break;
    case "linux":
      stored = await linuxStoreKey(deviceId, privateKeyPem);
      break;
    case "win32":
      stored = await winStoreKey(deviceId, privateKeyPem);
      break;
  }

  if (stored) {
    return "keychain";
  }

  if (platform !== "other") {
    process.stderr.write(
      "tbridge: could not store private key in OS credential store, using file fallback\n"
    );
  }

  return "file";
}

/**
 * Load a private key from the OS credential store.
 * Returns undefined if the key was not found or the store is unavailable.
 */
export async function loadPrivateKey(
  deviceId: string
): Promise<string | undefined> {
  const platform = currentPlatform();

  switch (platform) {
    case "darwin":
      return macLoadKey(deviceId);
    case "linux":
      return linuxLoadKey(deviceId);
    case "win32":
      return winLoadKey(deviceId);
    default:
      return undefined;
  }
}

/**
 * Delete a private key from the OS credential store.
 */
export async function deletePrivateKey(deviceId: string): Promise<boolean> {
  const platform = currentPlatform();

  switch (platform) {
    case "darwin":
      return macDeleteKey(deviceId);
    case "linux":
      return linuxDeleteKey(deviceId);
    case "win32":
      return winDeleteKey(deviceId);
    default:
      return false;
  }
}
