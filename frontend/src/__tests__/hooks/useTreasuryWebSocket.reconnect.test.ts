/**
 * useTreasuryWebSocket reconnect tests
 *
 * Verifies:
 *  1. Successful reconnect after an unexpected disconnect
 *  2. Multiple disconnect / reconnect cycles
 *  3. Exponential backoff delay progression
 *  4. Backoff is capped at 30 s
 *  5. Manual (intentional) disconnect does NOT reconnect
 *  6. Only one socket instance is active at a time (no duplicates)
 *  7. Event handlers remain functional after reconnect
 *  8. Socket error triggers reconnect
 *  9. Stale onclose from an old socket does not trigger reconnect
 */

import { renderHook, act } from '@testing-library/react';
import { useTreasuryWebSocket } from '../../hooks/useTreasuryWebSocket';

// ── Fake WebSocket ────────────────────────────────────────────────────────────

type WsInstance = {
  url: string;
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
  url: string;
  readyState = 0;
  OPEN = 1;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  send = jest.fn();
  close = jest.fn(() => {
    this.readyState = 3;
    // Simulate browser firing onclose when .close() is called.
    // Note: the hook nulls handlers before calling close() so this will be
    // a no-op for intentional closes — which is exactly what we want to test.
    this.onclose?.();
  });

  constructor(url: string) {
    this.url = url;
    instances.push(this as unknown as WsInstance);
  }

  triggerOpen() {
    this.readyState = 1;
    this.onopen?.();
  }

  triggerClose() {
    this.readyState = 3;
    this.onclose?.();
  }

  triggerError() {
    this.onerror?.(new Event('error'));
    this.triggerClose();
  }
}

// ── Jest setup ────────────────────────────────────────────────────────────────

const TEST_URL = 'wss://localhost/ws';

beforeEach(() => {
  instances = [];
  jest.useFakeTimers();
  // @ts-expect-error — override global WebSocket with fake
  global.WebSocket = FakeWebSocket;
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function latest(): WsInstance {
  return instances[instances.length - 1];
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useTreasuryWebSocket — reconnect behaviour', () => {
  // 1. Reconnects after unexpected disconnect
  it('reconnects automatically after an unexpected disconnect', () => {
    const { result } = renderHook(() => useTreasuryWebSocket(TEST_URL));

    act(() => { latest().triggerOpen(); });
    expect(result.current.isConnected).toBe(true);

    const firstSocket = latest();
    act(() => { firstSocket.triggerClose(); });
    expect(result.current.isConnected).toBe(false);

    // Backoff timer fires → second socket created
    act(() => { jest.runOnlyPendingTimers(); });
    expect(instances.length).toBe(2);

    act(() => { latest().triggerOpen(); });
    expect(result.current.isConnected).toBe(true);
  });

  // 2. Multiple disconnect / reconnect cycles
  it('handles multiple disconnect / reconnect cycles', () => {
    const { result } = renderHook(() => useTreasuryWebSocket(TEST_URL));

    for (let cycle = 0; cycle < 4; cycle++) {
      act(() => { latest().triggerOpen(); });
      expect(result.current.isConnected).toBe(true);

      act(() => { latest().triggerClose(); });
      expect(result.current.isConnected).toBe(false);

      act(() => { jest.runOnlyPendingTimers(); });
    }

    // 1 initial + 4 reconnects
    expect(instances.length).toBe(5);
  });

  // 3. Exponential backoff delay progression
  it('uses exponential backoff for reconnect delays', () => {
    jest.spyOn(global, 'setTimeout');
    const { result } = renderHook(() => useTreasuryWebSocket(TEST_URL));

    act(() => { latest().triggerOpen(); });
    (setTimeout as unknown as jest.Mock).mockClear();

    // attempt 0 → 1 000 ms
    act(() => { latest().triggerClose(); });
    expect(setTimeout).toHaveBeenLastCalledWith(expect.any(Function), 1000);

    act(() => { jest.runOnlyPendingTimers(); });
    (setTimeout as unknown as jest.Mock).mockClear();

    // attempt 1 → 2 000 ms
    act(() => { latest().triggerClose(); });
    expect(setTimeout).toHaveBeenLastCalledWith(expect.any(Function), 2000);

    act(() => { jest.runOnlyPendingTimers(); });
    (setTimeout as unknown as jest.Mock).mockClear();

    // attempt 2 → 4 000 ms
    act(() => { latest().triggerClose(); });
    expect(setTimeout).toHaveBeenLastCalledWith(expect.any(Function), 4000);

    void result;
  });

  // 4. Backoff capped at 30 s
  it('caps reconnect delay at 30 000 ms', () => {
    jest.spyOn(global, 'setTimeout');
    const { result } = renderHook(() => useTreasuryWebSocket(TEST_URL));

    act(() => { latest().triggerOpen(); });
    (setTimeout as unknown as jest.Mock).mockClear();

    for (let i = 0; i < 6; i++) {
      act(() => { latest().triggerClose(); });
      act(() => { jest.runOnlyPendingTimers(); });
    }

    (setTimeout as unknown as jest.Mock).mockClear();
    act(() => { latest().triggerClose(); });
    const [[, delay]] = (setTimeout as unknown as jest.Mock).mock.calls;
    expect(delay).toBeLessThanOrEqual(30_000);
    void result;
  });

  // 5. Manual disconnect does NOT reconnect
  it('does not reconnect after intentional unmount', () => {
    const { unmount } = renderHook(() => useTreasuryWebSocket(TEST_URL));

    act(() => { latest().triggerOpen(); });
    const countBefore = instances.length;

    unmount();

    act(() => { jest.runAllTimers(); });

    // No new sockets should have been created
    expect(instances.length).toBe(countBefore);
  });

  // 6. No duplicate sockets
  it('never creates more than one active socket at a time', () => {
    const { result } = renderHook(() => useTreasuryWebSocket(TEST_URL));

    act(() => { latest().triggerOpen(); });
    act(() => { latest().triggerClose(); });

    // Only 1 socket while timer is pending
    expect(instances.length).toBe(1);

    act(() => { jest.runOnlyPendingTimers(); });
    // 2nd socket created
    expect(instances.length).toBe(2);

    act(() => { latest().triggerOpen(); });
    act(() => { latest().triggerClose(); });
    act(() => { jest.runOnlyPendingTimers(); });

    // 3rd socket — still only one new socket per cycle
    expect(instances.length).toBe(3);
    void result;
  });

  // 7. Event handler functional after reconnect
  it('surfaces treasury-event messages after a reconnect', () => {
    const { result } = renderHook(() => useTreasuryWebSocket(TEST_URL));

    act(() => { latest().triggerOpen(); });
    act(() => { latest().triggerClose(); });
    act(() => { jest.runOnlyPendingTimers(); });
    act(() => { latest().triggerOpen(); });

    const event = JSON.stringify({
      type: 'treasury-event',
      data: { proposalId: 42 },
      timestamp: '2026-01-01T00:00:00Z',
    });

    act(() => { latest().onmessage?.({ data: event }); });

    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0].data).toEqual({ proposalId: 42 });
  });

  // 8. Socket error triggers reconnect
  it('reconnects after a socket error', () => {
    const { result } = renderHook(() => useTreasuryWebSocket(TEST_URL));

    act(() => { latest().triggerOpen(); });
    expect(result.current.isConnected).toBe(true);

    act(() => { latest().triggerError(); });
    expect(result.current.isConnected).toBe(false);

    act(() => { jest.runOnlyPendingTimers(); });
    act(() => { latest().triggerOpen(); });
    expect(result.current.isConnected).toBe(true);
  });

  // 9. Stale onclose from old socket does not trigger an extra reconnect
  it('does not trigger extra reconnects from a stale old socket', () => {
    const { result } = renderHook(() => useTreasuryWebSocket(TEST_URL));

    act(() => { latest().triggerOpen(); });
    const staleSocket = latest();

    // Drop and let the hook reconnect
    act(() => { staleSocket.triggerClose(); });
    act(() => { jest.runOnlyPendingTimers(); });
    act(() => { latest().triggerOpen(); });

    expect(instances.length).toBe(2);

    // Manually call the stale socket's original close handler (simulates a
    // delayed OS-level close event from the old TCP connection).
    // Because closeSocket() nulled the handlers, this should be a no-op.
    act(() => { staleSocket.onclose?.(); });
    act(() => { jest.runAllTimers(); });

    // Still only 2 sockets — stale handler did not create a third
    expect(instances.length).toBe(2);
    void result;
  });

  // 10. Non-treasury messages are ignored
  it('ignores non-treasury-event messages', () => {
    const { result } = renderHook(() => useTreasuryWebSocket(TEST_URL));

    act(() => { latest().triggerOpen(); });

    act(() => {
      latest().onmessage?.({
        data: JSON.stringify({ type: 'other-event', data: {} }),
      });
    });

    expect(result.current.events).toHaveLength(0);
  });
});
