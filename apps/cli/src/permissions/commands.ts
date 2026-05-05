import process from "node:process";
import {
  getPolicyPath,
  loadPolicy,
  removeUserAccess,
  setUserAccess
} from "./policy.js";
import {
  success,
  error,
  dim,
  primary,
  bold,
  icons,
  renderBox,
  renderInfoLine,
  userColor,
} from "../ui/index.js";

export async function allowUser(userId: string): Promise<void> {
  await setUserAccess(userId, "trusted");
  process.stdout.write(
    `  ${success(icons.check)} ${primary(userId)} is now ${success("trusted")}\n` +
    `  ${dim("Policy:")} ${dim(getPolicyPath())}\n`
  );
}

export async function denyUser(userId: string): Promise<void> {
  await setUserAccess(userId, "blocked");
  process.stdout.write(
    `  ${error(icons.cross)} ${primary(userId)} is now ${error("blocked")}\n` +
    `  ${dim("Policy:")} ${dim(getPolicyPath())}\n`
  );
}

export async function forgetUser(userId: string): Promise<void> {
  await removeUserAccess(userId);
  process.stdout.write(
    `  ${success(icons.check)} Removed policy for ${primary(userId)}\n`
  );
}

export async function showPolicy(): Promise<void> {
  const policy = await loadPolicy();
  const userIds = Object.keys(policy.users);

  if (userIds.length === 0) {
    const box = renderBox(
      [
        `${dim("No user policies configured.")}`,
        "",
        `${dim("Use")} ${bold("tbridge allow <user>")} ${dim("or")} ${bold("tbridge deny <user>")}`,
      ],
      "Access Policy"
    );
    process.stdout.write(box + "\n");
    return;
  }

  const lines: string[] = [];
  for (const userId of userIds) {
    const entry = policy.users[userId]!;
    const statusIcon = entry.access === "trusted" ? success(icons.check) : error(icons.cross);
    const statusLabel = entry.access === "trusted" ? success("trusted") : error("blocked");
    const date = dim(new Date(entry.updatedAt).toLocaleDateString());
    lines.push(`  ${statusIcon} ${primary(userId)}  ${statusLabel}  ${date}`);
  }

  const box = renderBox(
    [
      `${dim("Default:")} ${bold(policy.defaultPolicy)}`,
      "",
      ...lines,
      "",
      `${dim("Policy:")} ${dim(getPolicyPath())}`,
    ],
    "Access Policy"
  );
  process.stdout.write(box + "\n");
}
