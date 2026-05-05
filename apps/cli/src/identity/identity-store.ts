import crypto from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { PeerIdentity } from "@t-bridge/protocol";

export type LocalIdentity = PeerIdentity & {
  privateKey: string;
  createdAt: string;
};

export type CreateIdentityOptions = {
  deviceName?: string;
  userId?: string;
};

export function getIdentityPath(): string {
  if (process.env.TBRIDGE_IDENTITY_PATH) {
    return process.env.TBRIDGE_IDENTITY_PATH;
  }

  return path.join(os.homedir(), ".tbridge", "identity.json");
}

export async function loadIdentity(): Promise<LocalIdentity | undefined> {
  try {
    return JSON.parse(await readFile(getIdentityPath(), "utf8")) as LocalIdentity;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

export async function loadOrCreateIdentity(
  options: CreateIdentityOptions = {}
): Promise<LocalIdentity> {
  const existing = await loadIdentity();
  if (existing && (!options.userId || existing.userId === options.userId)) {
    return existing;
  }

  return createIdentity(options);
}

export async function createIdentity(
  options: CreateIdentityOptions = {}
): Promise<LocalIdentity> {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" }
  });

  const identity: LocalIdentity = {
    userId: options.userId ?? defaultUserId(),
    deviceId: crypto.randomUUID(),
    deviceName: options.deviceName ?? defaultDeviceName(),
    publicKey,
    privateKey,
    createdAt: new Date().toISOString()
  };

  await saveIdentity(identity);
  return identity;
}

export async function saveIdentity(identity: LocalIdentity): Promise<void> {
  const identityPath = getIdentityPath();
  await mkdir(path.dirname(identityPath), { recursive: true });
  await writeFile(identityPath, `${JSON.stringify(identity, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
}

export async function removeIdentity(): Promise<void> {
  try {
    await unlink(getIdentityPath());
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return;
    }

    throw error;
  }
}

export function publicIdentity(identity: LocalIdentity): PeerIdentity {
  return {
    userId: identity.userId,
    deviceId: identity.deviceId,
    deviceName: identity.deviceName,
    publicKey: identity.publicKey
  };
}

function defaultUserId(): string {
  return process.env.TBRIDGE_USER_ID || process.env.USER || "local-user";
}

function defaultDeviceName(): string {
  return `${os.hostname()}-${os.platform()}`;
}
