import { EventEmitter } from "node:events";
import { WebSocket } from "ws";
import { encode, decode, createEnvelope, type Envelope, type Payload, type Destination, type DeviceCapabilities, type PeerIdentity } from "@tbridge/protocol";
import { PeerConnection } from "./peer-connection.js";

export type NetworkStatus = "disconnected" | "connecting" | "connected";

export class NetworkManager extends EventEmitter {
  private ws: WebSocket | null = null;
  private status: NetworkStatus = "disconnected";
  private reconnectAttempts = 0;
  private readonly maxReconnectDelay = 30000;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private pendingPromises = new Map<string, { resolve: (val: any) => void; reject: (err: any) => void; timeout: ReturnType<typeof setTimeout> }>();

  public sessionCode: string | null = null;
  public readonly connections = new Map<string, PeerConnection>();

  constructor(
    public readonly user: string,
    public readonly device: string,
    private readonly capabilities: DeviceCapabilities,
    private readonly publicKey: string
  ) {
    super();
  }

  public async connect(url: string): Promise<void> {
    if (this.status !== "disconnected") {
      return;
    }

    this.status = "connecting";
    this.emit("status", this.status);

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);

      this.ws.on("open", () => {
        this.status = "connected";
        this.reconnectAttempts = 0;
        this.emit("status", this.status);

        // Send HELLO to relay
        this.sendToRelay({
          kind: "HELLO",
          capabilities: this.capabilities,
          publicKey: this.publicKey
        });

        this.startPing();
        resolve();
      });

      this.ws.on("message", (data) => {
        try {
          const envelope = decode(data as Buffer);
          this.handleEnvelope(envelope);
        } catch (err) {
          // ignore
        }
      });

      this.ws.on("close", () => {
        this.cleanup();
        this.scheduleReconnect(url);
      });

      this.ws.on("error", (err) => {
        if (this.status === "connecting") {
          reject(err);
        }
      });
    });
  }

  public disconnect() {
    this.status = "disconnected";
    this.cleanup();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private cleanup() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.status !== "disconnected") {
      this.status = "disconnected";
      this.emit("status", this.status);
    }
  }

  private scheduleReconnect(url: string) {
    if (this.status === "connecting") return;
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), this.maxReconnectDelay);
    setTimeout(() => {
      if (this.status === "disconnected") {
        this.connect(url).catch(() => {});
      }
    }, delay);
  }

  private startPing() {
    this.pingInterval = setInterval(() => {
      this.sendToRelay({ kind: "PING" });
    }, 15000);
  }

  public send(to: Destination, payload: Payload): string {
    const envelope = createEnvelope({ user: this.user, device: this.device }, to, payload);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(encode(envelope));
    }
    return envelope.id;
  }

  public sendToRelay(payload: Payload): string {
    return this.send({ kind: "relay" }, payload);
  }

  public sendToPeer(user: string, device: string, payload: Payload): string {
    return this.send({ kind: "peer", user, device }, payload);
  }

  public broadcast(payload: Payload): string {
    return this.send({ kind: "broadcast" }, payload);
  }

  private handleEnvelope(envelope: Envelope) {
    const { payload } = envelope;

    if (envelope.from.user === "relay") {
      if (payload.kind === "HELLO_ACK") {
        this.sessionCode = payload.sessionCode;
        this.emit("shareCode", this.sessionCode);
      } else if (payload.kind === "PAIR_REJECT") {
        this.emit("error", new Error(payload.reason));
      }
      return;
    }

    if (payload.kind === "PAIR_REQUEST") {
      this.emit("pair_request", payload.identity, payload.sessionCode);
      return;
    }

    if (payload.kind === "PAIR_ACCEPT") {
      const peerId = `${envelope.from.user}:${envelope.from.device}`;
      let conn = this.connections.get(peerId);
      if (!conn) {
        // Guest receiving PAIR_ACCEPT from Host
        conn = new PeerConnection(this, envelope.from.user, envelope.from.device, "guest");
        this.connections.set(peerId, conn);
        this.emit("connection_established", conn);
      }
      if (conn.status === "connecting") {
        conn.startHandshake();
      }
      return;
    }

    // Pass the raw envelope to any registered PeerConnection
    // PeerConnection itself listens to the "message" event to pick up ENCRYPTED or KEY_EXCHANGE
    this.emit("message", envelope);
  }

  public acceptPairRequest(identity: PeerIdentity) {
    const peerId = `${identity.userId}:${identity.deviceId}`;
    const connection = new PeerConnection(this, identity.userId, identity.deviceId, "host", identity.publicKey);
    this.connections.set(peerId, connection);
    
    this.sendToPeer(identity.userId, identity.deviceId, {
      kind: "PAIR_ACCEPT"
    });
    
    connection.startHandshake();
    return connection;
  }

  public initiateConnection(peerId: string, connection: PeerConnection) {
    this.connections.set(peerId, connection);
  }

  public getConnection(userId: string, deviceId: string): PeerConnection | undefined {
    return this.connections.get(`${userId}:${deviceId}`);
  }

  public removeConnection(userId: string, deviceId: string) {
    this.connections.delete(`${userId}:${deviceId}`);
  }
}
