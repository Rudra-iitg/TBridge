import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type AccessMode = "ask" | "trusted" | "blocked";

export type TrustedUserPolicy = {
  access: Exclude<AccessMode, "ask">;
  updatedAt: string;
};

export type PolicyFile = {
  defaultPolicy: "ask";
  users: Record<string, TrustedUserPolicy>;
};

export type PolicyDecision =
  | { action: "ask"; reason: string }
  | { action: "allow"; reason: string }
  | { action: "deny"; reason: string };

const DEFAULT_POLICY: PolicyFile = {
  defaultPolicy: "ask",
  users: {}
};

export function getPolicyPath(): string {
  if (process.env.TBRIDGE_POLICY_PATH) {
    return process.env.TBRIDGE_POLICY_PATH;
  }

  return path.join(os.homedir(), ".tbridge", "policy.json");
}

export async function loadPolicy(): Promise<PolicyFile> {
  try {
    const text = await readFile(getPolicyPath(), "utf8");
    return {
      ...DEFAULT_POLICY,
      ...JSON.parse(text)
    } as PolicyFile;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return DEFAULT_POLICY;
    }

    throw error;
  }
}

export async function savePolicy(policy: PolicyFile): Promise<void> {
  const policyPath = getPolicyPath();
  await mkdir(path.dirname(policyPath), { recursive: true });
  await writeFile(policyPath, `${JSON.stringify(policy, null, 2)}\n`, "utf8");
}

export async function setUserAccess(
  userId: string,
  access: Exclude<AccessMode, "ask">
): Promise<PolicyFile> {
  const policy = await loadPolicy();
  policy.users[userId] = {
    access,
    updatedAt: new Date().toISOString()
  };
  await savePolicy(policy);
  return policy;
}

export async function removeUserAccess(userId: string): Promise<PolicyFile> {
  const policy = await loadPolicy();
  delete policy.users[userId];
  await savePolicy(policy);
  return policy;
}

export async function decideAccess(userId: string): Promise<PolicyDecision> {
  const policy = await loadPolicy();
  const userPolicy = policy.users[userId];

  if (userPolicy?.access === "blocked") {
    return { action: "deny", reason: `${userId} is blocked` };
  }

  if (userPolicy?.access === "trusted") {
    return { action: "allow", reason: `${userId} is trusted` };
  }

  return { action: "ask", reason: "default policy is ask" };
}
