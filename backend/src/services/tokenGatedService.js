import { EventEmitter } from 'events';

class TokenGatedProgressBus extends EventEmitter {}

export const tokenGatedProgressBus = new TokenGatedProgressBus();

export function emitTokenGatedEvent(type, payload) {
  tokenGatedProgressBus.emit('progress', {
    type,
    ...payload,
    timestamp: new Date().toISOString()
  });
}
