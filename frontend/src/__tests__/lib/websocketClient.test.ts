import { ResilientWebSocketClient } from '../../lib/websocketClient';

class MockWebSocket {
  public url: string;
  public readyState: number = 0; // CONNECTING
  public onopen: (() => void) | null = null;
  public onmessage: ((event: any) => void) | null = null;
  public onerror: ((event: any) => void) | null = null;
  public onclose: ((event: any) => void) | null = null;
  public sentMessages: string[] = [];

  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor(url: string) {
    this.url = url;
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose({ code: 1000, reason: 'Normal closure' });
    }
  }

  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    if (this.onopen) {
      this.onopen();
    }
  }

  simulateMessage(data: string) {
    if (this.onmessage) {
      this.onmessage({ data });
    }
  }
}

describe('ResilientWebSocketClient', () => {
  let originalWebSocket: any;

  beforeEach(() => {
    originalWebSocket = (global as any).WebSocket;
    (global as any).WebSocket = MockWebSocket;
  });

  afterEach(() => {
    (global as any).WebSocket = originalWebSocket;
  });

  it('buffers messages sent when disconnected and flushes on connection open', () => {
    const client = new ResilientWebSocketClient({ url: 'ws://localhost:8080' });
    client.connect();

    // Send while connecting (not open yet)
    const result = client.send({ type: 'SUBSCRIBE', channel: 'logs' });
    expect(result).toBe(false);
    expect(client.getBufferedCount()).toBe(1);

    // Get underlying mock websocket instance
    const mockWs = (client as any).ws as MockWebSocket;
    expect(mockWs).toBeDefined();

    // Trigger connection open
    mockWs.simulateOpen();

    expect(client.isConnected()).toBe(true);
    expect(client.getBufferedCount()).toBe(0);
    expect(mockWs.sentMessages).toContain(JSON.stringify({ type: 'SUBSCRIBE', channel: 'logs' }));
  });

  it('subscribes to events and receives emitted messages', () => {
    const client = new ResilientWebSocketClient({ url: 'ws://localhost:8080' });
    client.connect();

    const mockWs = (client as any).ws as MockWebSocket;
    mockWs.simulateOpen();

    const listener = jest.fn();
    client.on('CONTRACT_COMPILED', listener);

    mockWs.simulateMessage(JSON.stringify({ type: 'CONTRACT_COMPILED', contractId: 'abc' }));

    expect(listener).toHaveBeenCalledWith({ type: 'CONTRACT_COMPILED', contractId: 'abc' });
  });

  it('stops reconnecting when explicitly closed', () => {
    const client = new ResilientWebSocketClient({ url: 'ws://localhost:8080' });
    client.connect();

    client.close();
    expect(client.isConnected()).toBe(false);
  });
});
