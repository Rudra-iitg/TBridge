import { chmod, access } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import process from "node:process";

const helperPaths = [
  path.join(
    process.cwd(),
    "node_modules",
    "node-pty",
    "prebuilds",
    `${process.platform}-${process.arch}`,
    "spawn-helper"
  )
];

for (const helperPath of helperPaths) {
  try {
    await access(helperPath, constants.F_OK);
    await chmod(helperPath, 0o755);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}
