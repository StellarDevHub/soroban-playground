import * as Y from "yjs";
import {
  colorForPeer,
  mergePresence,
  presenceToPeers,
  pruneStalePresence,
  type CursorPosition,
  type PeerPresence,
  type TimedPeerPresence,
} from "./yjsPresence";

export type CollaborationStatus =
  | "connecting"
  | "connected"
  | "webrtc"
  | "disconnected";

export interface MonacoBindingLike {
  destroy(): void;
}

export interface MonacoBindingFactory {
  (doc: Y.Doc, text: Y.Text, peerId: string): MonacoBindingLike;
}

interface ProviderOptions {
  wsUrl: string;
  docId: string;
  userName: string;
  maxReconnectAttempts?: number;
  enableWebRtcFallback?: boolean;
}

type WireMessage =
  | { type: "join"; docId: string; peer: PeerPresence }
  | { type: "sync-request"; docId: string; from: string }
  | { type: "sync-update"; docId: string; from: string; update: number[] }
  | { type: "update"; docId: string; from: string; update: number[] }
  | { type: "presence"; docId: string; peer: PeerPresence };

type BroadcastMessage =
  | { type: "hello"; from: string }
  | { type: "presence"; from: string; peer: PeerPresence }
  | { type: "update"; from: string; update: number[] }
  | {
      type: "signal";
      from: string;
      description?: RTCSessionDescriptionInit;
      candidate?: RTCIceCandidateInit;
    };

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 8_000;

function encodeUpdate(update: Uint8Array): number[] {
  return Array.from(update);
}

function decodeUpdate(update: number[]): Uint8Array {
  return Uint8Array.from(update);
}

/**
 * Owns the Y.Doc and the lifecycle of the Monaco binding. Every reconnect
 * destroys the old binding before creating a new one, which is what prevents
 * duplicate text insertions after a WebSocket blip.
 */
export class YjsCollaborationProvider {
  readonly doc = new Y.Doc();
  readonly clientId: string;
  readonly text: Y.Text;

  private readonly presence = new Map<string, TimedPeerPresence>();
  private readonly listeners = new Set<() => void>();
  private readonly maxReconnectAttempts: number;
  private readonly enableWebRtcFallback: boolean;
  private readonly self: PeerPresence;

  private binding: MonacoBindingLike | null = null;
  private bindingFactory: MonacoBindingFactory | null = null;
  private socket: WebSocket | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private presenceTimer: ReturnType<typeof setInterval> | null = null;
  private channel: BroadcastChannel | null = null;
  private connection: RTCPeerConnection | null = null;
  private dataChannels = new Map<string, RTCDataChannel>();
  private status: CollaborationStatus = "disconnected";
  private destroyed = false;

  constructor(private readonly options: ProviderOptions) {
    this.clientId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `peer-${Math.random().toString(36).slice(2)}`;
    this.text = this.doc.getText("monaco");
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 3;
    this.enableWebRtcFallback = options.enableWebRtcFallback ?? true;
    this.self = {
      id: this.clientId,
      name: options.userName,
      color: colorForPeer(this.clientId),
      lastActive: Date.now(),
    };

    this.doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === this) return;
      const message: WireMessage = {
        type: "update",
        docId: options.docId,
        from: this.clientId,
        update: encodeUpdate(update),
      };
      this.sendToSocket(message);
      this.broadcastFallback({ type: "update", from: this.clientId, update: message.update });
    });

    this.presenceTimer = setInterval(() => {
      this.presence = pruneStalePresence(this.presence);
      this.emit();
    }, 5_000);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getStatus(): CollaborationStatus {
    return this.status;
  }

  getPeers(): PeerPresence[] {
    return presenceToPeers(this.presence, this.clientId);
  }

  attachBinding(factory: MonacoBindingFactory): void {
    this.bindingFactory = factory;
    this.rebind();
  }

  connect(): void {
    if (this.destroyed || this.socket) return;

    this.setStatus("connecting");
    if (typeof WebSocket === "undefined") {
      this.startWebRtcFallback();
      return;
    }

    try {
      const socket = new WebSocket(this.options.wsUrl);
      this.socket = socket;

      socket.onopen = () => {
        if (this.destroyed || this.socket !== socket) return;
        this.reconnectAttempts = 0;
        this.setStatus("connected");
        this.sendToSocket({
          type: "join",
          docId: this.options.docId,
          peer: this.self,
        });
        this.sendToSocket({
          type: "sync-request",
          docId: this.options.docId,
          from: this.clientId,
        });
        this.rebind();
      };

      socket.onmessage = (event) => {
        if (this.destroyed || typeof event.data !== "string") return;
        this.handleWireMessage(event.data);
      };

      socket.onclose = () => this.handleSocketLoss();
      socket.onerror = () => this.handleSocketLoss();
    } catch {
      this.handleSocketLoss();
    }
  }

  updateCursor(cursor: CursorPosition, selection?: string): void {
    this.self.cursor = cursor;
    this.self.selection = selection;
    this.self.lastActive = Date.now();
    this.presence = mergePresence(this.presence, this.self);
    this.emit();

    const message: WireMessage = {
      type: "presence",
      docId: this.options.docId,
      peer: this.self,
    };
    this.sendToSocket(message);
    this.broadcastFallback({
      type: "presence",
      from: this.clientId,
      peer: this.self,
    });
  }

  destroy(): void {
    this.destroyed = true;
    this.teardownBinding();

    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.presenceTimer) clearInterval(this.presenceTimer);
    this.reconnectTimer = null;
    this.presenceTimer = null;

    if (this.socket) {
      this.socket.onopen = null;
      this.socket.onmessage = null;
      this.socket.onclose = null;
      this.socket.onerror = null;
      this.socket.close();
      this.socket = null;
    }

    this.dataChannels.forEach((channel) => channel.close());
    this.dataChannels.clear();
    this.connection?.close();
    this.connection = null;
    this.channel?.close();
    this.channel = null;

    this.listeners.clear();
    this.doc.destroy();
  }

  private handleSocketLoss(): void {
    if (this.destroyed) return;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      try {
        socket.close();
      } catch {
        // Already closed by the remote peer.
      }
    }

    // Stop accepting editor input into a document nobody can sync until the
    // binding is recreated after the next successful connection.
    this.teardownBinding();
    this.reconnectAttempts += 1;

    if (
      this.enableWebRtcFallback &&
      this.reconnectAttempts >= this.maxReconnectAttempts
    ) {
      this.startWebRtcFallback();
      return;
    }

    this.setStatus("disconnected");
    const delay = Math.min(
      RECONNECT_BASE_MS * 2 ** (this.reconnectAttempts - 1),
      RECONNECT_MAX_MS,
    );
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private handleWireMessage(raw: string): void {
    let message: WireMessage;
    try {
      message = JSON.parse(raw) as WireMessage;
    } catch {
      return;
    }
    if (message.docId !== this.options.docId) return;

    if (message.type === "join" || message.type === "presence") {
      if (message.peer.id === this.clientId) return;
      this.presence = mergePresence(this.presence, message.peer);
      this.emit();
      return;
    }

    if (message.from === this.clientId) return;
    if (message.type === "sync-request") {
      const update = Y.encodeStateAsUpdate(this.doc);
      this.sendToSocket({
        type: "sync-update",
        docId: this.options.docId,
        from: this.clientId,
        update: encodeUpdate(update),
      });
      return;
    }

    if (message.type === "update" || message.type === "sync-update") {
      Y.applyUpdate(this.doc, decodeUpdate(message.update), message.type);
    }
  }

  private teardownBinding(): void {
    if (!this.binding) return;
    try {
      this.binding.destroy();
    } catch {
      // A partially disposed binding must not block reconnection.
    }
    this.binding = null;
  }

  private rebind(): void {
    const connected = this.status === "connected" || this.status === "webrtc";
    if (this.destroyed || !connected || !this.bindingFactory) return;

    this.teardownBinding();
    this.binding = this.bindingFactory(this.doc, this.text, this.clientId);
  }

  private setStatus(status: CollaborationStatus): void {
    this.status = status;
    this.emit();
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }

  private sendToSocket(message: WireMessage): void {
    if (
      this.socket &&
      this.socket.readyState === WebSocket.OPEN &&
      this.socket.protocol !== "fallback"
    ) {
      this.socket.send(JSON.stringify(message));
    }
  }

  private startWebRtcFallback(): void {
    if (this.destroyed || this.channel) return;
    this.setStatus("webrtc");
    this.rebind();

    if (typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel(`soroban-yjs-${this.options.docId}`);
      this.channel.onmessage = (event: MessageEvent<BroadcastMessage>) => {
        if (!event.data || event.data.from === this.clientId) return;
        this.handleBroadcastMessage(event.data);
      };
      this.broadcastFallback({ type: "hello", from: this.clientId });
      this.broadcastFallback({
        type: "presence",
        from: this.clientId,
        peer: this.self,
      });
    }
  }

  private ensurePeerConnection(withDataChannel: boolean): RTCPeerConnection | null {
    if (typeof RTCPeerConnection === "undefined") return null;
    if (!this.connection) {
      this.connection = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });
      this.connection.onicecandidate = (event) => {
        if (event.candidate) {
          this.broadcastFallback({
            type: "signal",
            from: this.clientId,
            candidate: event.candidate.toJSON(),
          });
        }
      };
    }

    if (withDataChannel && !this.dataChannels.has(this.clientId)) {
      const channel = this.connection.createDataChannel("yjs");
      channel.onopen = () => this.rebind();
      channel.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as BroadcastMessage;
          if (data.type === "update" && data.from !== this.clientId) {
            Y.applyUpdate(this.doc, decodeUpdate(data.update), "webrtc");
          }
        } catch {
          // Ignore malformed peer payloads.
        }
      };
      this.dataChannels.set(this.clientId, channel);

      this.connection.ondatachannel = (event) => {
        const remoteChannel = event.channel;
        remoteChannel.onmessage = (messageEvent) => {
          try {
            const data = JSON.parse(messageEvent.data) as BroadcastMessage;
            if (data.type === "update" && data.from !== this.clientId) {
              Y.applyUpdate(this.doc, decodeUpdate(data.update), "webrtc");
            }
          } catch {
            // Ignore malformed peer payloads.
          }
        };
        this.dataChannels.set(dataChannelId(remoteChannel), remoteChannel);
      };
    }

    return this.connection;
  }

  private async handleBroadcastMessage(message: BroadcastMessage): Promise<void> {
    if (message.type === "hello") {
      if (this.clientId < message.from) {
        this.ensurePeerConnection(true);
      }
      return;
    }

    if (message.type === "presence" && message.peer.id !== this.clientId) {
      this.presence = mergePresence(this.presence, message.peer);
      this.emit();
      return;
    }

    if (message.type === "update") {
      Y.applyUpdate(this.doc, decodeUpdate(message.update), "webrtc");
      return;
    }

    if (message.type === "signal") {
      await this.handleSignal(message);
    }
  }

  private async handleSignal(message: Extract<BroadcastMessage, { type: "signal" }>): Promise<void> {
    const connection = this.ensurePeerConnection(false);
    if (!connection) return;

    try {
      if (message.description?.type === "offer") {
        await connection.setRemoteDescription(message.description);
        const answer = await connection.createAnswer();
        await connection.setLocalDescription(answer);
        if (connection.localDescription) {
          this.broadcastFallback({
            type: "signal",
            from: this.clientId,
            description: connection.localDescription.toJSON(),
          });
        }
      } else if (message.description?.type === "answer") {
        await connection.setRemoteDescription(message.description);
      } else if (message.candidate) {
        await connection.addIceCandidate(message.candidate);
      }
    } catch {
      // A failed fallback negotiation leaves the Y.Doc usable over BroadcastChannel.
    }
  }

  private broadcastFallback(message: BroadcastMessage): void {
    if (!this.channel) return;

    if (message.type === "update" && this.dataChannels.size > 0) {
      this.dataChannels.forEach((channel) => {
        if (channel.readyState === "open") channel.send(JSON.stringify(message));
      });
      return;
    }

    this.channel.postMessage(message);
  }
}

function dataChannelId(channel: RTCDataChannel): string {
  return channel.id === 0 ? `remote-${channel.label}` : `remote-${channel.id}`;
}
