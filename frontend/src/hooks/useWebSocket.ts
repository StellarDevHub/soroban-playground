// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import { useEffect, useRef, useState, useCallback } from 'react';

interface WebSocketMessage {
  type: string;
  payload: any;
  timestamp: string;
}

interface UseWebSocketOptions {
  onOpen?: (event: Event) => void;
  onClose?: (event: CloseEvent) => void;
  onError?: (event: Event) => void;
  onMessage?: (message: WebSocketMessage) => void;
  reconnectAttempts?: number;
  reconnectInterval?: number;
}

interface UseWebSocketReturn {
  lastMessage: MessageEvent | null;
  sendMessage: (message: string | object) => void;
  isConnected: boolean;
  error: Error | null;
  reconnect: () => void;
}

export const useWebSocket = (url: string, options: UseWebSocketOptions = {}): UseWebSocketReturn => {
  const {
    onOpen,
    onClose,
    onError,
    onMessage,
    reconnectAttempts = 3,
    reconnectInterval = 3000,
  } = options;

  const [lastMessage, setLastMessage] = useState<MessageEvent | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectCountRef = useRef(0);

  const connect = useCallback(() => {
    try {
      // Close existing connection if any
      if (wsRef.current) {
        wsRef.current.close();
      }

      const wsUrl = url.startsWith('ws') ? url : `ws://${url}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = (event) => {
        console.log('WebSocket connected');
        setIsConnected(true);
        setError(null);
        reconnectCountRef.current = 0;
        onOpen?.(event);
      };

      ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          setLastMessage(event);
          onMessage?.(message);
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
          // Still pass the raw message if parsing fails
          onMessage?.({
            type: 'raw',
            payload: event.data,
            timestamp: new Date().toISOString(),
          });
        }
      };

      ws.onclose = (event) => {
        console.log('WebSocket disconnected:', event.code, event.reason);
        setIsConnected(false);
        wsRef.current = null;
        onClose?.(event);

        // Attempt to reconnect if not a normal closure
        if (event.code !== 1000 && reconnectCountRef.current < reconnectAttempts) {
          reconnectCountRef.current++;
          console.log(`Attempting to reconnect (${reconnectCountRef.current}/${reconnectAttempts})...`);
          
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, reconnectInterval);
        }
      };

      ws.onerror = (event) => {
        console.error('WebSocket error:', event);
        const wsError = new Error('WebSocket connection error');
        setError(wsError);
        onError?.(event);
      };

    } catch (error) {
      console.error('Failed to create WebSocket connection:', error);
      const wsError = error instanceof Error ? error : new Error('Unknown WebSocket error');
      setError(wsError);
    }
  }, [url, onOpen, onClose, onError, onMessage, reconnectAttempts, reconnectInterval]);

  const sendMessage = useCallback((message: string | object) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const data = typeof message === 'string' ? message : JSON.stringify(message);
      wsRef.current.send(data);
    } else {
      console.warn('WebSocket is not connected. Message not sent:', message);
    }
  }, []);

  const reconnect = useCallback(() => {
    reconnectCountRef.current = 0;
    connect();
  }, [connect]);

  // Initial connection
  useEffect(() => {
    connect();

    return () => {
      // Cleanup
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  return {
    lastMessage,
    sendMessage,
    isConnected,
    error,
    reconnect,
  };
};

// Hook for subscription-specific WebSocket functionality
export const useSubscriptionWebSocket = (userId?: string) => {
  const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001';
  const subscriptionUrl = userId ? `${wsUrl}/ws/subscription?userId=${userId}` : `${wsUrl}/ws/subscription`;

  const { lastMessage, sendMessage, isConnected, error, reconnect } = useWebSocket(subscriptionUrl, {
    onOpen: () => {
      console.log('Subscription WebSocket connected');
      // Send initial subscription to updates
      sendMessage({
        type: 'subscribe',
        payload: { userId, channels: ['subscriptions', 'plans', 'stats'] },
      });
    },
    onClose: () => {
      console.log('Subscription WebSocket disconnected');
    },
    onError: (event) => {
      console.error('Subscription WebSocket error:', event);
    },
    reconnectAttempts: 5,
    reconnectInterval: 5000,
  });

  return {
    lastMessage,
    sendMessage,
    isConnected,
    error,
    reconnect,
  };
};

// Hook for real-time subscription updates
export const useRealtimeSubscriptions = (userId?: string) => {
  const { lastMessage, sendMessage, isConnected } = useSubscriptionWebSocket(userId);
  const [updates, setUpdates] = useState<any[]>([]);

  useEffect(() => {
    if (lastMessage) {
      try {
        const data = JSON.parse(lastMessage.data);
        if (data.type === 'subscription_update' || data.type === 'plan_update' || data.type === 'stats_update') {
          setUpdates(prev => [...prev, data]);
        }
      } catch (error) {
        console.error('Failed to parse subscription update:', error);
      }
    }
  }, [lastMessage]);

  const clearUpdates = useCallback(() => {
    setUpdates([]);
  }, []);

  return {
    updates,
    clearUpdates,
    isConnected,
    sendMessage,
  };
};

export default useWebSocket;
