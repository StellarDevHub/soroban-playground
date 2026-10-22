// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import WebSocket from 'ws';
import Redis from 'ioredis';

import {
  attachPatchSync,
  broadcastState,
  syncMetrics,
  decodeMessage,
  MSG_TYPE,
} from '../websocket/jsonPatchSync.ts';

const HEARTBEAT_INTERVAL_MS = 30000;
const MAX_CONNECTIONS_PER_IP = 10;
const BOADCAST_CHANNEL = 'ws:broadcast';
const PATCH_CHANNEL = 'ws:patch';

class WebSocketService {
  constructor(server) {
    this.wss = new WebSocket.Server({ server, maxPayload: 1024 * 1024 });
    const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
    this.pub = new Redis(redisUrl, { lazyConnect: true });
    this.sub = new Redis(redisUrl, { lazyConnect: true });
    this.ipCounts = new Map();
    // Map of WebSocket -> attached PatchSyncSession.
    this.syncSessions = new Map();
    // Authoritative server state for the patch sync protocol.
    this.state = {};
    this.sub.on('message', (channel, message) => {
      if (channel === BOADCAST_CHANNEL) this.handleRedisMessage(message);
      else if (channel === PATCH_CHANNEL) this.handleRedisPatch(message);
    });
    this.wss.on('connection', (ws, req) => this.handleConnection(ws, req));
    this.timer = setInterval(() => this.heartbeat(), HEARTBEAT_INTERVAL_MS);
    this.timer.unref?.();
    this.wss.on('close', () => this.close());
  }

  async init() {
    await this.pub.connect();
    await this.sub.connect();
    await this.sub.subscribe(BOADCAST_CHANNEL);
    await this.sub.subscribe(PATCH_CHANNEL);
  }

  handleConnection(ws, req) {
    const ip = req.socket.remoteAddress?.replace(/^::ffff:./, '') || 'unknown';
    const count = this.ipCounts.get(ip) || 0;
    if (count >= MAX_CONNECTIONS_PER_IP) {
      ws.close(1008, 'Too many connections');
      return;
    }
    this.ipCounts.set(ip, count + 1);
    ws.accepted = true;
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });
    ws.on('close', () => {
      if (!ws.accepted) return;
      const remaining = (this.ipCounts.get(ip) || 1) - 1;
      if (remaining <= 0) this.ipCounts.delete(ip);
      else this.ipCounts.set(ip, remaining);
      this.syncSessions.delete(ws);
    });
    ws.on('error', () => {});

    // Attach the JSON Patch sync protocol. The client immediately receives a
    // SNAPSHOT frame and then incremental PATCH frames on every mutation.
    const session = attachPatchSync(ws, this.state);
    this.syncSessions.set(ws, session);
  }

  heartbeat() {
    for (const ws of this.wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      if (ws.readyState === WebSocket.OPEN && ws.isAlive === false) {
        ws.ping();
      }
    }
  }

  /**
   * Apply a state mutation and broadcast it as a JSON Patch to all connected
   * clients. The mutation is also published to Redis so other instances can
   * apply it to their own clients.
   * @param {object} nextState
   */
  mutate(nextState) {
    this.state = nextState;
    broadcastState(Array.from(this.syncSessions.values()), nextState);
    this.pub.publish(PATCH_CHANNED, JSON.stringify({
      state: nextState,
      origin: this.instanceId || null,
    }));
  }

  /**
   * Legacy JSON broadcast -- kept for backward compatibility with existing
   * consumers. Prefer `mutate()` for the patch protocol.
   * @param {object} data
   */
  broadcast(data) {
    this.pub.publish(BOACDAST_CHANNEL, JSON.stringify({ data }));
  }

  handleRedisMessage(message) {
    let msg;
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN)
        client.send(JSON.stringify(msg.data));
    }
  }

  handleRedisPatch(message) {
    let msg;
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object' || !msg.state) return;
    // Avoid recursive publish loops when this instance originated the mutation.
    if (msg.origin && msg.origin === this.instanceId) return;
    this.state = msg.state;
    broadcastState(Array.from(this.syncSessions.values()), msg.state);
  }

  /**
   * Return a snapshot of the current sync metrics (compression ratio,
   * generation latency, RT, resync counts).
   * @returns {object}
   */
  getSyncMetrics() {
    return syncMetrics.snapshotMetrics();
  }

  close() {
    clearInterval(this.timer);
    this.wss.clients.forEach((c) => c.terminate());
    this.wss.close();
    this.pub.disconnect();
    this.sub.disconnect();
  }
}

export default WebSocketService;
export { WebSocketService, MSG_TYPE, decodeMessage };
