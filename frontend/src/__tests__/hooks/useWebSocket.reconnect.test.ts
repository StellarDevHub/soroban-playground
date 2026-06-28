/**
 * useWebSocket reconnect tests
 *
 * Verifies:
 *  1. Successful reconnect after an unexpected disconnect
 *  2. Multiple disconnect / reconnect cycles
 *  3. Exponential backoff delay progression
 *  4. Manual (intentional) disconnect does NOT reconnect
 *  5. Only one socket instance is active at any time (no duplicates)
 *  6. Event handlers remain functional after reconnect
 *  7. Subscriptions are replayed after reconnect
 */

import { renderHook, act } from '@testing-library/react';
import { useWebSocket } from '../../hooks/useWebSocket';

// ── Fake WebSocket ────────────────────────────────────────────────────────────

type WsInstance = {
  readyState: number;
  OPEN: number;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: ((e: unknown) => void) | null;
  onmessage: ((e: { data: string }) => void) | null;
  send: jest.Mock;
  close: jest.Mock;
};

let instances: WsInstance[] = [];

class FakeWebSocket {
  readyState = 0; // CONNECTING
  OPEN = 1;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  send = jest.fn();
  close = jest.fn(() => {
    this.readyState = 3; // CLOSING / CLOSED
    // Simulate the browser firing onclose when .close() is called.
    this.onclose?.();
  });

  constructor() {
    instances.push(this as unknown as WsInstance);
  }

  /** Helper: simulate the server accepting the connection. */
  triggerOpen() {
    this.readyState = 1; // OPEN
    this.onopen?.();
  }

  /** Helper: simulate an unexpected network drop. */
  triggerClose() {
    this.readyState = 3;
    this.onclose?.();
  }

  /** Helper: simulate a socket-level error followed by close. */
  triggerError() {
    this.onerror?.(new Event('error'));
    this.triggerClose();
  }
}

// ── Jest setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
  instances = [];
  jest.useFakeTimers();
  // @ts-expect-error — override global WebSocket with fake
  global.WebSocket = FakeWebSocket;
  process.env.NEXT_PUBLIC_API_URL = 'http://localhost:3000';
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns the most recently constructed FakeWebSocket. */
function latest(): WsInstance {
  return instances[instances.length - 1];
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useWebSocket — reconnect behaviour', () => {
  // 1. Reconnects after unexpected disconnect
  it('reconnects automatically after an unexpected disconnect', () => {
    const { result } = renderHook(() => useWebSocket());

    // Initial connection established
    act(() => { latest().triggerOpen(); });
    expect(result.current.isConnected).toBe(true);
    const firstSocket = latest();

    // Simulate network drop (not an intentional close)
    act(() => { firstSocket.triggerClose(); });
    expect(result.current.isConnected).toBe(false);

    // After the backoff delay fires a new socket should be created
    act(() => { jest.runOnlyPendingTimers(); });
    expect(instances.length).toBe(2);

    // Confirm reconnected state after new socket opens
    act(() => { latest().triggerOpen(); });
    expect(result.current.isConnected).toBe(true);
  });

  // 2. Multiple disconnect / reconnect cycles
  it('handles multiple disconnect / reconnect cycles', () => {
    const { result } = renderHook(() => useWebSocket());

    for (let cycle = 0; cycle < 3; cycle++) {
      act(() => { latest().triggerOpen(); });
      expect(result.current.isConnected).toBe(true);

      act(() => { latest().triggerClose(); });
      expect(result.current.isConnected).toBe(false);

      act(() => { jest.runOnlyPendingTimers(); });
    }

    // After 3 cycles we should have 4 socket instances (1 initial + 3 reconnects)
    expect(instances.length).toBe(4);
  });

  // 3. Exponential backoff delay progression
  it('uses exponential backoff for reconnect delays', () => {
    jest.spyOn(global, 'setTimeout');
    const { result } = renderHook(() => useWebSocket());

    // First open → resets counter
    act(() => { latest().triggerOpen(); });
    (setTimeout as unknown as jest.Mock).mockClear();

    // First unexpected close → attempt 0 → delay = min(30000, 1000 * 2^0) = 1000 ms
    act(() => { latest().triggerClose(); });
    expect(setTimeout).toHaveBeenLastCalledWith(expect.any(Function), 1000);

    // Reconnect fires but immediately drops again → attempt 1 → delay = 2000 ms
    act(() => { jest.runOnlyPendingTimers(); });
    (setTimeout as unknown as jest.Mock).mockClear();
    act(() => { latest().triggerClose(); });
    expect(setTimeout).toHaveBeenLastCalledWith(expect.any(Function), 2000);

    // attempt 2 → delay = 4000 ms
    act(() => { jest.runOnlyPendingTimers(); });
    (setTimeout as unknown as jest.Mock).mockClear();
    act(() => { latest().triggerClose(); });
    expect(setTimeout).toHaveBeenLastCalledWith(expect.any(Function), 4000);

    void result; // suppress unused warning
  });

  // 3a. Backoff is capped at 30 s
  it('caps backoff delay at 30 000 ms', () => {
    jest.spyOn(global, 'setTimeout');
    const { result } = renderHook(() => useWebSocket());

    act(() => { latest().triggerOpen(); });
    (setTimeout as unknown as jest.Mock).mockClear();

    // Drive attempt counter to 5 (delay would be 32 000 ms without cap)
    for (let i = 0; i < 5; i++) {
      act(() => { latest().triggerClose(); });
      act(() => { jest.runOnlyPendingTimers(); });
    }

    (setTimeout as unknown as jest.Mock).mockClear();
    act(() => { latest().triggerClose(); });
    const [[, delay]] = (setTimeout as unknown as jest.Mock).mock.calls;
    expect(delay).toBeLessThanOrEqual(30_000);
    void result;
  });

  // 4. Manual disconnect does NOT reconnect
  it('does not reconnect after intentional unmount', () => {
    const { result, unmount } = renderHook(() => useWebSocket());

    act(() => { latest().triggerOpen(); });
    expect(result.current.isConnected).toBe(true);

    const socketCount = instances.length;

    // Unmount — closes the socket intentionally
    unmount();

    // Advance all timers; no new socket should be created
    act(() => { jest.runAllTimers(); });
    expect(instances.length).toBe(socketCount);
  });

  // 4a. close() inside FakeWebSocket fires onclose; make sure flag works
  it('does not reconnect when the socket is closed by the hook cleanup', () => {
    const { unmount } = renderHook(() => useWebSocket());
    act(() => { latest().triggerOpen(); });

    unmount();
    act(() => { jest.runAllTimers(); });

    // Still only the original socket
    expect(instances.length).toBe(1);
  });

  // 5. No duplicate sockets
  it('never creates more than one active socket at a time', () => {
    const { result } = renderHook(() => useWebSocket());

    act(() => { latest().triggerOpen(); });
    const s1 = latest();

    act(() => { s1.triggerClose(); });
    // Timer pending — don't fire yet
    expect(instances.length).toBe(1);

    // Fire timer → second socket created
    act(() => { jest.runOnlyPendingTimers(); });
    expect(instances.length).toBe(2);

    // Trigger open on second socket before first timer fires again
    act(() => { latest().triggerOpen(); });

    // Simulate another drop; only one pending timer should exist
    act(() => { latest().triggerClose(); });
    act(() => { jest.runOnlyPendingTimers(); });

    // Still incrementing by one each time (no duplicates)
    expect(instances.length).toBe(3);
    void result;
  });

  // 6. Message handler remains functional after reconnect
  it('receives messages correctly after a reconnect', () => {
    const { result } = renderHook(() => useWebSocket());

    act(() => { latest().triggerOpen(); });
    act(() => { latest().triggerClose(); });
    act(() => { jest.runOnlyPendingTimers(); });
    act(() => { latest().triggerOpen(); });

    const payload = JSON.stringify({
      type: 'price_update',
      assetSymbol: 'XLM',
      price: 0.12,
    });

    act(() => { latest().onmessage?.({ data: payload }); });

    expect(result.current.data).toEqual({
      type: 'price_update',
      assetSymbol: 'XLM',
      price: 0.12,
    });
  });

  // 7. Subscriptions are replayed after reconnect
  it('replays subscriptions on reconnect', () => {
    const { result } = renderHook(() => useWebSocket());

    act(() => { latest().triggerOpen(); });

    // Subscribe to a channel
    act(() => { result.current.subscribe('prices'); });
    expect(latest().send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'subscribe', channel: 'prices' }),
    );
    latest().send.mockClear();

    // Drop + reconnect
    act(() => { latest().triggerClose(); });
    act(() => { jest.runOnlyPendingTimers(); });
    act(() => { latest().triggerOpen(); });

    // Subscription should be replayed automatically
    expect(latest().send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'subscribe', channel: 'prices' }),
    );
  });

  // 8. Error followed by reconnect
  it('reconnects after a socket error', () => {
    const { result } = renderHook(() => useWebSocket());

    act(() => { latest().triggerOpen(); });
    expect(result.current.isConnected).toBe(true);

    // onerror then onclose (browser behaviour)
    act(() => { latest().triggerError(); });
    expect(result.current.isConnected).toBe(false);

    act(() => { jest.runOnlyPendingTimers(); });
    act(() => { latest().triggerOpen(); });
    expect(result.current.isConnected).toBe(true);
  });
});
