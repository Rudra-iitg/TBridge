import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const logDir = path.join(os.homedir(), ".tbridge");
const logFile = path.join(logDir, "tbridge.log");

// Ensure directory exists
try {
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
} catch (e) {
  // Ignore
}

/**
 * Structured JSON Logger
 */
export const logger = {
  info(event: string, data?: any) {
    log("info", event, data);
  },
  warn(event: string, data?: any) {
    log("warn", event, data);
  },
  error(event: string, err: Error, data?: any) {
    log("error", event, { ...data, error: err.message, stack: err.stack });
  }
};

function log(level: "info" | "warn" | "error", event: string, data: any) {
  try {
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      event,
      ...data
    }) + "\n";
    
    fs.appendFileSync(logFile, entry);
  } catch (err) {
    // Failsafe: logging should never crash the app
  }
}
