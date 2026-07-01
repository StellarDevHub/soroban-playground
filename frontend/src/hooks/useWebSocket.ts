/**
 * WebSocket Hook for Real-time Updates
 * Handles price updates, liquidation alerts, and other real-time data
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
 * Intentional disconnects (component unmount or explicit manual close) set
 * `intentionalClose = true` before calling `ws.close()`, which prevents the
 * `onclose` handler from scheduling a reconnect.
 *
 * Cleanup
 * ───────
 * The pending reconnect timer handle is stored in `reconnectTimerRef` and
 * cancelled both on unmount and at the start of each `connect()` call so
 * duplicate timers are never queued.
 */

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

export interface WebSocketData {
  type: 'price_update' | 'liquidation_alert' | 'position_update' | 'error';
  assetSymbol?: string;
  price?: number;
  positionId?: number;
  message?: string;
  timestamp?: number;
}

export const useWebSocket = () => {
  const [data, setData] = useState<WebSocketData | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ws = useRef<WebSocket | null>(null);
  const subscriptions = useRef<Set<string>>(new Set());

  // Counts consecutive failed attempts; reset to 0 on successful open.
  const reconnectAttempts = useRef(0);

  // Handle to the pending reconnect setTimeout so we can cancel it on unmount
  // or before starting a fresh connect, preventing duplicate timers.
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // When true the close was intentional (unmount / manual disconnect) and
  // the onclose handler must NOT schedule a reconnect.
  const intentionalClose = useRef(false);

  const wsUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/^http/, 'ws') || 'ws://localhost:3000';

  const connect = useCallback(() => {
    // Cancel any previously queued reconnect before opening a new socket.
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    // Each new connect attempt is not intentional — allow reconnect on close.
    intentionalClose.current = false;

    try {
      ws.current = new WebSocket(`${wsUrl}/ws`);

      ws.current.onopen = () => {
        setIsConnected(true);
        setError(null);
        // Reset backoff counter after a successful connection.
        reconnectAttempts.current = 0;

        // Resubscribe to channels that were active before the reconnect.
        subscriptions.current.forEach(subscription => {
          ws.current?.send(JSON.stringify({
            type: 'subscribe',
            channel: subscription,
          }));
        });
      };

      ws.current.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as WebSocketData;
          setData(message);
        } catch (err) {
          console.error('Failed to parse WebSocket message:', err);
        }
      };

      ws.current.onerror = (event) => {
        setError('WebSocket error');
        console.error('WebSocket error:', event);
        // onclose fires after onerror — reconnect logic lives there.
      };

      const socket = ws.current;

      if (socket) {
        socket.onclose = () => {
          setIsConnected(false);

          // Null out handlers on this specific socket since it is now closed,
          // preventing any subsequent stale close events from scheduling extra reconnects.
          socket.onopen = null;
          socket.onmessage = null;
          socket.onerror = null;
          socket.onclose = null;

          if (ws.current === socket) {
            ws.current = null;
          }

          // Do not reconnect when the close was triggered on purpose (e.g. unmount).
          if (intentionalClose.current) return;

          // Exponential backoff with a 30 s ceiling to avoid tight reconnect loops.
          const delay = Math.min(30_000, 1000 * Math.pow(2, reconnectAttempts.current));
          reconnectAttempts.current += 1;

          reconnectTimerRef.current = setTimeout(connect, delay);
        };
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect');
    }
  }, [wsUrl]);

  useEffect(() => {
    connect();

    return () => {
      // Mark the close as intentional so onclose does not reschedule.
      intentionalClose.current = true;

      // Cancel any pending reconnect timer.
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }

      if (ws.current) {
        ws.current.close();
        ws.current = null;
      }
    };
  }, [connect]);

  const subscribe = useCallback((channel: string) => {
    subscriptions.current.add(channel);

    if (isConnected && ws.current) {
      ws.current.send(JSON.stringify({
        type: 'subscribe',
        channel,
      }));
    }
  }, [isConnected]);

  const unsubscribe = useCallback((channel: string) => {
    subscriptions.current.delete(channel);

    if (isConnected && ws.current) {
      ws.current.send(JSON.stringify({
        type: 'unsubscribe',
        channel,
      }));
    }
  }, [isConnected]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const send = useCallback((message: any) => {
    if (isConnected && ws.current) {
      ws.current.send(JSON.stringify(message));
    }
  }, [isConnected]);

  return {
    data,
    isConnected,
    error,
    subscribe,
    unsubscribe,
    send,
  };
};

export default useWebSocket;
