// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import crypto from 'crypto';
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
const PONG_TIMEOUT_MS = 5000;
const RESUME_TOKEN_TTL_MS = 5 * 60 * 1000;
const MAX_CONNECTIONS_PER_IP = 10;
const BROADCAST_CHANNEL = 'ws:broadcast';
const PATCH_CHANNEL = 'ws:patch';

class WebSocketService {
  constructor(server, options = {}) {
    this.wss = new WebSocket.Server({ server, maxPayload: 1024 * 1024 });
    const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
    this.pub = new Redis(redisUrl, { lazyConnect: true });
    this.sub = new Redis(redisUrl, { lazyConnect: true });
    this.heartbeatIntervalMs =
      options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS;
    this.pongTimeoutMs = options.pongTimeoutMs ?? PONG_TIMEOUT_MS;
    this.resumeTokenTtlMs = options.resumeTokenTtlMs ?? RESUME_TOKEN_TTL_MS;
    this.resumeSecret =
      options.resumeSecret ||
      process.env.WS_RESUME_SECRET ||
      crypto.randomBytes(32).toString('hex');

    this.ipCounts = new Map();
    // Map of WebSocket -> attached PatchSyncSession.
    this.syncSessions = new Map();
    // Map of WebSocket -> Set of subscribed channel names.
    this.socketChannels = new Map();
    // Map of channel name -> Set of subscribed WebSockets.
    this.channelSubscribers = new Map();
    // Map of WebSocket -> active session metadata cache.
    this.sessionCache = new Map();
    // Map of resumeToken -> { userId, channels, expiresAt }.
    this.resumeTokens = new Map();
    // Authoritative server state for the patch sync protocol.
    this.state = {};
    this.sub.on('message', (channel, message) => {
      if (channel === BROADCAST_CHANNEL) this.handleRedisMessage(message);
      else if (channel === PATCH_CHANNEL) this.handleRedisPatch(message);
    });
    this.wss.on('connection', (ws, req) => this.handleConnection(ws, req));
    this.timer = setInterval(() => this.heartbeat(), this.heartbeatIntervalMs);
    this.timer.unref?.();
    this.wss.on('close', () => this.close());
  }

  async init() {
    await this.pub.connect();
    await this.sub.connect();
    await this.sub.subscribe(BROADCAST_CHANNEL);
    await this.sub.subscribe(PATCH_CHANNEL);
  }

  extractResumeToken(req) {
    if (!req) return null;
    const headerToken = req.headers?.['x-resume-token'];
    if (typeof headerToken === 'string' && headerToken.trim()) {
      return headerToken.trim();
    }
    const authHeader = req.headers?.authorization;
    if (typeof authHeader === 'string' && authHeader.startsWith('Resume ')) {
      return authHeader.slice('Resume '.length).trim() || null;
    }
    if (typeof req.url === 'string') {
      try {
        const parsed = new URL(req.url, 'http://localhost');
        const queryToken = parsed.searchParams.get('resumeToken');
        if (queryToken) return queryToken;
      } catch {
        // Ignore malformed URLs.
      }
    }
    return null;
  }

  issueResumeToken(ws, metadata = {}) {
    const id = crypto.randomBytes(24).toString('hex');
    const sig = crypto
      .createHmac('sha256', this.resumeSecret)
      .update(id)
      .digest('hex');
    const token = `${id}.${sig}`;
    const channels = Array.from(this.socketChannels.get(ws) || []);
    this.resumeTokens.set(token, {
      userId: metadata.userId ?? ws.userId ?? null,
      channels,
      expiresAt: Date.now() + this.resumeTokenTtlMs,
    });
    ws.resumeToken = token;
    return token;
  }

  verifyResumeToken(token) {
    if (typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [id, sig] = parts;
    if (!id || !sig) return null;
    const expectedSig = crypto
      .createHmac('sha256', this.resumeSecret)
      .update(id)
      .digest('hex');
    const sigBuf = Buffer.from(sig, 'utf8');
    const expectedBuf = Buffer.from(expectedSig, 'utf8');
    if (
      sigBuf.length !== expectedBuf.length ||
      !crypto.timingSafeEqual(sigBuf, expectedBuf)
    ) {
      return null;
    }
    const record = this.resumeTokens.get(token);
    if (!record) return null;
    if (record.expiresAt <= Date.now()) {
      this.resumeTokens.delete(token);
      return null;
    }
    return record;
  }

  pruneExpiredResumeTokens() {
    const now = Date.now();
    for (const [token, record] of this.resumeTokens.entries()) {
      if (record.expiresAt <= now) {
        this.resumeTokens.delete(token);
      }
    }
  }

  subscribeChannel(ws, channel) {
    if (!channel || !this.socketChannels.has(ws)) return;
    this.socketChannels.get(ws).add(channel);
    if (!this.channelSubscribers.has(channel)) {
      this.channelSubscribers.set(channel, new Set());
    }
    this.channelSubscribers.get(channel).add(ws);
    if (ws.resumeToken && this.resumeTokens.has(ws.resumeToken)) {
      this.resumeTokens.get(ws.resumeToken).channels = Array.from(
        this.socketChannels.get(ws)
      );
    }
  }

  unsubscribeChannel(ws, channel) {
    const channels = this.socketChannels.get(ws);
    if (channels) {
      channels.delete(channel);
    }
    const subscribers = this.channelSubscribers.get(channel);
    if (subscribers) {
      subscribers.delete(ws);
      if (subscribers.size === 0) {
        this.channelSubscribers.delete(channel);
      }
    }
  }

  cleanupConnection(ws, ipOverride) {
    if (!ws || !ws.accepted || ws._cleanedUp) return;
    ws._cleanedUp = true;

    if (ws.pongTimeout) {
      clearTimeout(ws.pongTimeout);
      ws.pongTimeout = null;
    }

    const session = this.sessionCache.get(ws);
    const ip = ipOverride || session?.ip;
    if (ip) {
      const remaining = (this.ipCounts.get(ip) || 1) - 1;
      if (remaining <= 0) this.ipCounts.delete(ip);
      else this.ipCounts.set(ip, remaining);
    }

    const channels = this.socketChannels.get(ws);
    if (channels) {
      if (ws.resumeToken && this.resumeTokens.has(ws.resumeToken)) {
        this.resumeTokens.get(ws.resumeToken).channels = Array.from(channels);
      }
      for (const channel of channels) {
        const subscribers = this.channelSubscribers.get(channel);
        if (subscribers) {
          subscribers.delete(ws);
          if (subscribers.size === 0) {
            this.channelSubscribers.delete(channel);
          }
        }
      }
      this.socketChannels.delete(ws);
    }

    this.sessionCache.delete(ws);
    this.syncSessions.delete(ws);
  }

  handleConnection(ws, req) {
    const ip = req?.socket?.remoteAddress?.replace(/^::ffff:/, '') || 'unknown';
    const count = this.ipCounts.get(ip) || 0;
    if (count >= MAX_CONNECTIONS_PER_IP) {
      ws.close(1008, 'Too many connections');
      return;
    }

    const incomingResumeToken = this.extractResumeToken(req);
    let resumedRecord = null;
    if (incomingResumeToken) {
      resumedRecord = this.verifyResumeToken(incomingResumeToken);
      if (!resumedRecord) {
        ws.close(4001, 'Invalid or expired resume token');
        return;
      }
      // Single-use resume token rotation to prevent replay attacks.
      this.resumeTokens.delete(incomingResumeToken);
      ws.resumed = true;
      ws.userId = resumedRecord.userId;
    } else {
      ws.resumed = false;
      ws.userId = req?.headers?.['x-user-id'] || null;
    }

    this.ipCounts.set(ip, count + 1);
    ws.accepted = true;
    ws._cleanedUp = false;
    ws.isAlive = true;
    ws.pongTimeout = null;

    this.socketChannels.set(ws, new Set());
    this.sessionCache.set(ws, {
      userId: ws.userId,
      ip,
      connectedAt: Date.now(),
      resumed: ws.resumed,
    });

    this.issueResumeToken(ws, { userId: ws.userId });
    if (resumedRecord?.channels?.length) {
      for (const channel of resumedRecord.channels) {
        this.subscribeChannel(ws, channel);
      }
    }

    ws.on('pong', () => {
      ws.isAlive = true;
      if (ws.pongTimeout) {
        clearTimeout(ws.pongTimeout);
        ws.pongTimeout = null;
      }
    });
    ws.on('close', () => {
      this.cleanupConnection(ws, ip);
    });
    ws.on('error', () => {});

    // Attach the JSON Patch sync protocol. The client immediately receives a
    // SNAPSHOT frame and then incremental PATCH frames on every mutation.
    const session = attachPatchSync(ws, this.state);
    this.syncSessions.set(ws, session);
  }

  heartbeat() {
    this.pruneExpiredResumeTokens();
    for (const ws of this.wss.clients) {
      if (ws.readyState !== WebSocket.OPEN) {
        continue;
      }
      if (ws.pongTimeout) {
        clearTimeout(ws.pongTimeout);
        ws.pongTimeout = null;
      }
      ws.isAlive = false;
      ws.ping();
      ws.pongTimeout = setTimeout(() => {
        ws.pongTimeout = null;
        if (!ws.isAlive) {
          this.cleanupConnection(ws);
          ws.terminate();
        }
      }, this.pongTimeoutMs);
      ws.pongTimeout.unref?.();
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
    this.pub.publish(
      PATCH_CHANNEL,
      JSON.stringify({
        state: nextState,
        origin: this.instanceId || null,
      })
    );
  }

  /**
   * Legacy JSON broadcast -- kept for backward compatibility with existing
   * consumers. Prefer `mutate()` for the patch protocol.
   * @param {object} data
   */
  broadcast(data) {
    this.pub.publish(BROADCAST_CHANNEL, JSON.stringify({ data }));
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
    this.wss.clients.forEach((c) => {
      this.cleanupConnection(c);
      c.terminate();
    });
    this.wss.close();
    this.pub.disconnect();
    this.sub.disconnect();
  }
}

export default WebSocketService;
export { WebSocketService, MSG_TYPE, decodeMessage };
