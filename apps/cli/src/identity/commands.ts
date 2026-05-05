import process from "node:process";
import {
  createIdentity,
  getIdentityPath,
  loadIdentity,
  removeIdentity
} from "./identity-store.js";
import {
  success,
  error,
  dim,
  primary,
  bold,
  accent,
  icons,
  renderBox,
  renderInfoLine,
} from "../ui/index.js";

export async function login(options: {
  deviceName?: string;
  userId?: string;
}): Promise<void> {
  const identity = await createIdentity(options);

  const box = renderBox(
    [
      `${success(icons.check)} Logged in as ${primary(identity.userId)}`,
      "",
      renderInfoLine("Device", identity.deviceName),
      renderInfoLine("Device ID", dim(identity.deviceId)),
      renderInfoLine("Identity", dim(getIdentityPath())),
      renderInfoLine("Key", accent("🔒 Ed25519 keypair stored")),
    ],
    "Identity Created"
  );

  process.stdout.write(box + "\n");
}

export async function showIdentity(): Promise<void> {
  const identity = await loadIdentity();
  if (!identity) {
    process.stdout.write(
      `  ${error(icons.cross)} No local identity. Run ${bold("tbridge login")} first.\n`
    );
    return;
  }

  const box = renderBox(
    [
      renderInfoLine("User", primary(identity.userId)),
      renderInfoLine("Device", identity.deviceName),
      renderInfoLine("Device ID", dim(identity.deviceId)),
      renderInfoLine("Public Key", dim(identity.publicKey.slice(0, 24) + "…")),
      renderInfoLine("Path", dim(getIdentityPath())),
    ],
    "T-Bridge Identity"
  );

  process.stdout.write(box + "\n");
}

export async function logout(): Promise<void> {
  await removeIdentity();
  process.stdout.write(
    `  ${success(icons.check)} Removed local T-Bridge identity.\n`
  );
}
