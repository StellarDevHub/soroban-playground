/**
 * WebSocket Hook for Real-time Updates
 * Handles price updates, liquidation alerts, and other real-time data
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
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 10;

  const wsUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/^http/, 'ws') || 'ws://localhost:3000';

  const connect = useCallback(() => {
    try {
      ws.current = new WebSocket(`${wsUrl}/ws`);

      ws.current.onopen = () => {
        setIsConnected(true);
        setError(null);
        reconnectAttempts.current = 0;

        // Resubscribe to previous subscriptions
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
      };

      ws.current.onclose = () => {
        setIsConnected(false);
        
        // Attempt to reconnect
        if (reconnectAttempts.current < maxReconnectAttempts) {
          reconnectAttempts.current += 1;
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
          setTimeout(connect, delay);
        }
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect');
    }
  }, [wsUrl]);

  useEffect(() => {
    connect();

    return () => {
      if (ws.current) {
        ws.current.close();
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
