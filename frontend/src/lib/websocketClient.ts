export interface ResilientWebSocketConfig {
  url?: string;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  maxReconnectAttempts?: number;
  initialReconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
  pingMessage?: string;
  pongMessage?: string;
}

export type WebSocketEventListener = (data: any) => void;

export class ResilientWebSocketClient {
  private url: string;
  private ws: WebSocket | null = null;
  private heartbeatIntervalMs: number;
  private heartbeatTimeoutMs: number;
  private maxReconnectAttempts: number;
  private initialReconnectDelayMs: number;
  private maxReconnectDelayMs: number;
  private pingMessage: string;
  private pongMessage: string;

  private reconnectAttempts = 0;
  private isExplicitlyClosed = false;
  private heartbeatTimer: any = null;
  private heartbeatTimeoutTimer: any = null;
  private messageBuffer: string[] = [];
  private listeners: Map<string, Set<WebSocketEventListener>> = new Map();

  constructor(config: ResilientWebSocketConfig = {}) {
    this.url = config.url || process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8080/ws';
    this.heartbeatIntervalMs = config.heartbeatIntervalMs ?? 15000;
    this.heartbeatTimeoutMs = config.heartbeatTimeoutMs ?? 5000;
    this.maxReconnectAttempts = config.maxReconnectAttempts ?? 10;
    this.initialReconnectDelayMs = config.initialReconnectDelayMs ?? 1000;
    this.maxReconnectDelayMs = config.maxReconnectDelayMs ?? 30000;
    this.pingMessage = config.pingMessage ?? JSON.stringify({ type: 'ping' });
    this.pongMessage = config.pongMessage ?? JSON.stringify({ type: 'pong' });
  }

  public connect(customUrl?: string): void {
    if (customUrl) {
      this.url = customUrl;
    }

    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
      return;
    }

    this.isExplicitlyClosed = false;

    try {
      this.ws = new WebSocket(this.url);
      this.setupHandlers();
    } catch (error) {
      this.emit('error', error);
      this.scheduleReconnect();
    }
  }

  private setupHandlers(): void {
    if (!this.ws) return;

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.startHeartbeat();
      this.flushBuffer();
      this.emit('open', { url: this.url });
    };

    this.ws.onmessage = (event: MessageEvent) => {
      this.resetHeartbeatTimeout();

      if (event.data === this.pongMessage) {
        return;
      }

      let parsedData: any;
      try {
        parsedData = JSON.parse(event.data);
      } catch {
        parsedData = event.data;
      }

      this.emit('message', parsedData);

      if (parsedData && parsedData.type) {
        this.emit(parsedData.type, parsedData);
      }
    };

    this.ws.onerror = (event: Event) => {
      this.emit('error', event);
    };

    this.ws.onclose = (event: CloseEvent) => {
      this.stopHeartbeat();
      this.emit('close', event);

      if (!this.isExplicitlyClosed) {
        this.scheduleReconnect();
      }
    };
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.sendRaw(this.pingMessage);
        this.heartbeatTimeoutTimer = setTimeout(() => {
          this.ws?.close();
        }, this.heartbeatTimeoutMs);
      }
    }, this.heartbeatIntervalMs);
  }

  private resetHeartbeatTimeout(): void {
    if (this.heartbeatTimeoutTimer) {
      clearTimeout(this.heartbeatTimeoutTimer);
      this.heartbeatTimeoutTimer = null;
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.resetHeartbeatTimeout();
  }

  private scheduleReconnect(): void {
    if (this.isExplicitlyClosed || this.reconnectAttempts >= this.maxReconnectAttempts) {
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(
      this.initialReconnectDelayMs * Math.pow(2, this.reconnectAttempts - 1),
      this.maxReconnectDelayMs
    );

    setTimeout(() => {
      if (!this.isExplicitlyClosed) {
        this.connect();
      }
    }, delay);
  }

  public send(data: any): boolean {
    const message = typeof data === 'string' ? data : JSON.stringify(data);

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return this.sendRaw(message);
    } else {
      this.messageBuffer.push(message);
      return false;
    }
  }

  private sendRaw(message: string): boolean {
    try {
      this.ws?.send(message);
      return true;
    } catch (err) {
      this.messageBuffer.push(message);
      return false;
    }
  }

  private flushBuffer(): void {
    while (this.messageBuffer.length > 0 && this.ws && this.ws.readyState === WebSocket.OPEN) {
      const msg = this.messageBuffer.shift();
      if (msg) {
        this.sendRaw(msg);
      }
    }
  }

  public on(event: string, listener: WebSocketEventListener): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
  }

  public off(event: string, listener: WebSocketEventListener): void {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(listener);
    }
  }

  private emit(event: string, data: any): void {
    const set = this.listeners.get(event);
    if (set) {
      set.forEach((listener) => {
        try {
          listener(data);
        } catch (err) {
          console.error(`Error in WebSocket listener for event "${event}":`, err);
        }
      });
    }
  }

  public close(): void {
    this.isExplicitlyClosed = true;
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  public getBufferedCount(): number {
    return this.messageBuffer.length;
  }

  public isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}

export const wsClient = new ResilientWebSocketClient();
