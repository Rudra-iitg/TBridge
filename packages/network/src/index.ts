import { Worker } from "node:worker_threads";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export { NetworkManager, type NetworkStatus } from "./network-manager.js";
export { PeerConnection } from "./peer-connection.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function startEmbeddedRelay(port: number = 8787): Promise<Worker> {
  return new Promise((resolvePromise, reject) => {
    // Note: Use the built output path `relay-worker.js`
    const worker = new Worker(resolve(__dirname, "./relay-worker.js"), {
      workerData: { port }
    });

    worker.on("message", (msg) => {
      if (msg.type === "READY") {
        resolvePromise(worker);
      }
    });

    worker.on("error", (err) => {
      reject(err);
    });
  });
}
