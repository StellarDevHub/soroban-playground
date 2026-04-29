const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001/ws/events';

export function subscribeToCarbonEvents(callback: (event: any) => void) {
  const socket = new WebSocket(WS_URL);

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.contract === process.env.NEXT_PUBLIC_CARBON_CONTRACT_ID) {
        callback(data);
      }
    } catch (e) {
      console.error('Error parsing WS message', e);
    }
  };

  return () => socket.close();
}