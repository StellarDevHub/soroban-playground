/**
 * Event Bus - Simple event emitter for component communication
 */

type EventCallback = (data: any) => void;

class EventBus {
  private events: Map<string, EventCallback[]> = new Map();

  on(event: string, callback: EventCallback): () => void {
    if (!this.events.has(event)) {
      this.events.set(event, []);
    }
    this.events.get(event)!.push(callback);

    // Return unsubscribe function
    return () => {
      const callbacks = this.events.get(event);
      if (callbacks) {
        const index = callbacks.indexOf(callback);
        if (index > -1) {
          callbacks.splice(index, 1);
        }
      }
    };
  }

  off(event: string, callback: EventCallback): void {
    const callbacks = this.events.get(event);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  emit(event: string, data?: any): void {
    const callbacks = this.events.get(event);
    if (callbacks) {
      callbacks.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`Error in event handler for ${event}:`, error);
        }
      });
    }
  }

  once(event: string, callback: EventCallback): void {
    const onceCallback = (data: any) => {
      this.off(event, onceCallback);
      callback(data);
    };
    this.on(event, onceCallback);
  }
}

// REIT-specific event bus
export const reitEventBus = new EventBus();

// WebSocket event types
export type ReitWebSocketEvent =
  | { type: 'reit-property'; propertyId: number; data: any }
  | { type: 'reit-transaction'; txHash: string; status: string }
  | { type: 'reit-dividend'; propertyId: number; amount: number }
  | { type: 'reit-stats'; stats: any };

export default EventBus;
