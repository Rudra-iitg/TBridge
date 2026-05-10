import { access, chmod } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import process from "node:process";

const helperPath = path.join(
  process.cwd(),
  "node_modules",
  "node-pty",
  "prebuilds",
  `${process.platform}-${process.arch}`,
  "spawn-helper"
);

try {
  await access(helperPath, constants.F_OK);
  await chmod(helperPath, 0o755);
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
    throw error;
  }
}
