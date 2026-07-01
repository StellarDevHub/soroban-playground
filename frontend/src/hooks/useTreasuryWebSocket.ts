/**
 * useTreasuryWebSocket
 *
 * React hook that maintains a resilient WebSocket connection to the backend's
 * /ws endpoint and surfaces treasury-event messages.
 *
 * Reconnect strategy
 * ──────────────────
 * When the connection closes *unexpectedly* (network drop, server restart,
 * etc.) the hook re-dials automatically using exponential backoff:
 *
 *   delay = min(30_000, 1000 × 2^attempt)   (ms)
 *
 * The attempt counter resets to 0 after every successful open.
 *
 * Intentional disconnects (component unmount) set `intentionalRef = true`
 * before calling closeSocket(), which prevents the onclose handler from
 * scheduling a reconnect.
 *
 * Cleanup
 * ───────
 * closeSocket() nulls out all event handlers before calling ws.close() so
 * stale onclose callbacks from a previous socket never fire after a reconnect.
 * The pending reconnect timer is stored in timerRef and cancelled on unmount
 * and at the start of every openSocket() call, preventing duplicate timers and
 * orphaned socket instances.
 */

import { useEffect, useRef, useState, useCallback } from 'react';

export interface TreasuryEvent {
  type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  timestamp: string;
}

/** Exponential backoff delay in ms, capped at 30 s. */
function backoffDelay(attempt: number): number {
  return Math.min(30_000, 1000 * Math.pow(2, attempt));
}

export function useTreasuryWebSocket(
  url = (
    process.env.NEXT_PUBLIC_BACKEND_URL || 'https://soroban-playground.onrender.com'
  )
    .replace('https://', 'wss://')
    .replace('http://', 'ws://') + '/ws',
) {
  const [events, setEvents] = useState<TreasuryEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  // Single active WebSocket instance.
  const wsRef = useRef<WebSocket | null>(null);

  // Pending reconnect timer handle — stored so it can be cancelled.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Number of consecutive failed attempts; reset to 0 on successful open.
  const attemptRef = useRef(0);

  // Set to true only during intentional teardown (unmount) so that onclose
  // does NOT schedule a reconnect.
  const intentionalRef = useRef(false);

  /** Cancel any pending reconnect timer. */
  const cancelTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /**
   * Null out all event handlers and close the current socket.
   * Nulling handlers first ensures a stale onclose from a previous connection
   * never fires after we have already moved on to a new socket.
   */
  const closeSocket = useCallback(() => {
    cancelTimer();
    if (!wsRef.current) return;
    wsRef.current.onopen = null;
    wsRef.current.onmessage = null;
    wsRef.current.onerror = null;
    wsRef.current.onclose = null;
    wsRef.current.close();
    wsRef.current = null;
  }, [cancelTimer]);

  /** Open a new WebSocket, wiring up reconnect-aware handlers. */
  const openSocket = useCallback(() => {
    // Tear down any existing socket cleanly before creating a new one.
    closeSocket();

    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch (err) {
      // Malformed URL or environments without WebSocket — schedule a retry.
      console.error('[TreasuryWS] Failed to create WebSocket:', err);
      if (!intentionalRef.current) {
        const delay = backoffDelay(attemptRef.current);
        attemptRef.current += 1;
        timerRef.current = setTimeout(openSocket, delay);
      }
      return;
    }

    wsRef.current = socket;

    socket.onopen = () => {
      console.log('[TreasuryWS] Connected');
      setIsConnected(true);
      // Reset backoff counter after a successful connection.
      attemptRef.current = 0;
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'treasury-event') {
          // Keep the last 50 events in state.
          setEvents((prev) => [data, ...prev].slice(0, 50));
        }
      } catch (e) {
        console.error('[TreasuryWS] Failed to parse message:', e);
      }
    };

    socket.onerror = () => {
      // onclose fires after onerror — reconnect logic lives there.
      console.warn('[TreasuryWS] Socket error');
    };

    socket.onclose = () => {
      console.log('[TreasuryWS] Disconnected');
      setIsConnected(false);

      // Null out handlers on this specific socket since it is now closed,
      // preventing any subsequent stale close events from scheduling extra reconnects.
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;

      if (wsRef.current === socket) {
        wsRef.current = null;
      }

      // Do not reconnect when the close was triggered on purpose (unmount).
      if (intentionalRef.current) return;

      const delay = backoffDelay(attemptRef.current);
      attemptRef.current += 1;
      timerRef.current = setTimeout(openSocket, delay);
    };
  }, [url, closeSocket]);

  useEffect(() => {
    // Reset intentional flag when (re-)mounting.
    intentionalRef.current = false;
    openSocket();

    return () => {
      // Mark the close as intentional so onclose does not reschedule.
      intentionalRef.current = true;
      closeSocket();
    };
    // openSocket / closeSocket are stable refs — exhaustive-deps would re-run
    // the effect only when `url` changes, which is the desired behaviour.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  return { events, isConnected };
}
