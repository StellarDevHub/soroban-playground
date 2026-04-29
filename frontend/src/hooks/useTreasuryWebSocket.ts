import { useEffect, useState, useCallback } from 'react';

export interface TreasuryEvent {
  type: string;
  data: any;
  timestamp: string;
}

export function useTreasuryWebSocket(url = 'ws://localhost:5000/ws') {
  const [events, setEvents] = useState<TreasuryEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  const connect = useCallback(() => {
    const ws = new WebSocket(url);

    ws.onopen = () => {
      console.log('Connected to Treasury WS');
      setIsConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'treasury-event') {
          setEvents((prev) => [data, ...prev].slice(0, 50)); // Keep last 50 events
        }
      } catch (e) {
        console.error('Failed to parse WS message:', e);
      }
    };

    ws.onclose = () => {
      console.log('Disconnected from Treasury WS');
      setIsConnected(false);
      setTimeout(connect, 3000); // Reconnect after 3s
    };

    return ws;
  }, [url]);

  useEffect(() => {
    const ws = connect();
    return () => {
      ws.close();
    };
  }, [connect]);

  return { events, isConnected };
}
