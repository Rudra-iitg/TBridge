import process from "node:process";
import {
  getPolicyPath,
  loadPolicy,
  removeUserAccess,
  setUserAccess
} from "./policy.js";

export async function allowUser(userId: string): Promise<void> {
  await setUserAccess(userId, "trusted");
  process.stdout.write(`Allowed ${userId}\nPolicy: ${getPolicyPath()}\n`);
}

export async function denyUser(userId: string): Promise<void> {
  await setUserAccess(userId, "blocked");
  process.stdout.write(`Denied ${userId}\nPolicy: ${getPolicyPath()}\n`);
}

export async function forgetUser(userId: string): Promise<void> {
  await removeUserAccess(userId);
  process.stdout.write(`Removed local policy for ${userId}\n`);
}

export async function showPolicy(): Promise<void> {
  const policy = await loadPolicy();
  process.stdout.write(`${JSON.stringify(policy, null, 2)}\n`);
  process.stdout.write(`Policy: ${getPolicyPath()}\n`);
}
