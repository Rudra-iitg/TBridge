import process from "node:process";
import {
  createIdentity,
  getIdentityPath,
  loadIdentity,
  removeIdentity
} from "./identity-store.js";

export async function login(options: {
  deviceName?: string;
  userId?: string;
}): Promise<void> {
  const identity = await createIdentity(options);
  process.stdout.write(
    [
      `Logged in locally as ${identity.userId}`,
      `Device: ${identity.deviceName}`,
      `Device ID: ${identity.deviceId}`,
      `Identity: ${getIdentityPath()}`
    ].join("\n") + "\n"
  );
}

export async function showIdentity(): Promise<void> {
  const identity = await loadIdentity();
  if (!identity) {
    process.stdout.write("No local identity. Run `tbridge login`.\n");
    return;
  }

  const { privateKey: _privateKey, ...safeIdentity } = identity;
  process.stdout.write(`${JSON.stringify(safeIdentity, null, 2)}\n`);
  process.stdout.write(`Identity: ${getIdentityPath()}\n`);
}

export async function logout(): Promise<void> {
  await removeIdentity();
  process.stdout.write("Removed local T-Bridge identity.\n");
}
