import { WebSocketServer } from 'ws';
import { invokeProgressBus } from './services/invokeService.js';
import { deployProgressBus } from './services/deployService.js';
import { compileProgressBus } from './services/compileService.js';
import oracleProofQueueService from './services/oracleProofQueueService.js';
import redisService from './services/redisService.js';
import { sharedOracleEventBus } from './services/oracle/oracleEvents.js';

const clients = new Set();

const HEARTBEAT_INTERVAL_MS = 30_000; // ping every 30 s
const MAX_MISSED_PONGS = 2;           // terminate after 2 consecutive misses

function safeSend(socket, message) {
  try {
    if (socket.readyState === socket.OPEN) {
      socket.send(message);
    }
  } catch (err) {
    console.error('WS send error:', err.message);
    clients.delete(socket);
  }
}

function safeStringify(payload) {
  try {
    return JSON.stringify(payload);
  } catch (err) {
    console.error('WS serialize error:', err.message);
    return null;
  }
}

export function broadcastTreasuryEvent(event) {
  const message = safeStringify({ type: 'treasury-event', ...event });
  if (!message) return;
  for (const socket of clients) {
    safeSend(socket, message);
  }
}

export function setupWebsocketServer(httpServer) {
  const wss = new WebSocketServer({
    server: httpServer,
    path: '/ws',
  });

  wss.on('error', (err) => {
    console.error('WebSocketServer error:', err.message);
  });

  wss.on('connection', (socket, request) => {
    let url;
    try {
      url = new URL(request.url, 'http://localhost');
    } catch {
      socket.close(1008, 'Bad Request');
      return;
    }

    const authHeader = request.headers.authorization || '';
    const tokenFromQuery = url.searchParams.get('token');
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length)
      : tokenFromQuery;

    if (process.env.WS_AUTH_TOKEN && token !== process.env.WS_AUTH_TOKEN) {
      socket.close(1008, 'Unauthorized');
      return;
    }

    socket.missedPongs = 0;
    clients.add(socket);

    safeSend(
      socket,
      safeStringify({ type: 'connected', timestamp: new Date().toISOString() })
    );

    socket.on('pong', () => {
      socket.missedPongs = 0;
    });

    socket.on('error', (err) => {
      console.error('WS client error:', err.message);
      clients.delete(socket);
    });

    socket.on('close', () => {
      clients.delete(socket);
    });
  });

  const forward = (type) => (event) => {
    const message = safeStringify({ type, ...event });
    if (!message) return;
    for (const socket of clients) {
      safeSend(socket, message);
    }
  };

  invokeProgressBus.on('progress', forward('invoke-progress'));
  deployProgressBus.on('progress', forward('deploy-progress'));
  compileProgressBus.on('progress', forward('compile-progress'));
  oracleProofQueueService.on('progress', forward('oracle-proof-progress'));

  sharedOracleEventBus.on('*', (payload) => {
    const message = safeStringify({ type: 'oracle-event', ...payload });
    if (!message) return;
    for (const socket of clients) {
      safeSend(socket, message);
    }
  });

  // Heartbeat: ping all clients every 30 s; terminate after 2 missed pongs
  const heartbeatTimer = setInterval(() => {
    for (const socket of clients) {
      if (socket.missedPongs >= MAX_MISSED_PONGS) {
        console.warn('WS heartbeat: terminating stale connection');
        socket.terminate();
        clients.delete(socket);
        continue;
      }
      socket.missedPongs += 1;
      try {
        socket.ping();
      } catch (err) {
        console.error('WS ping error:', err.message);
        socket.terminate();
        clients.delete(socket);
      }
    }
  }, HEARTBEAT_INTERVAL_MS);

  wss.on('close', () => clearInterval(heartbeatTimer));

  // Broadcast analytics every 2 seconds
  setInterval(async () => {
    if (
      clients.size === 0 ||
      redisService.isFallbackMode ||
      !redisService.client
    )
      return;

    try {
      const topIps = await redisService.client.zrevrange(
        'analytics:top_ips',
        0,
        9,
        'WITHSCORES'
      );
      const endpoints = ['compile', 'invoke', 'deploy', 'global'];
      const stats = {};

      for (const endpoint of endpoints) {
        stats[endpoint] = await redisService.client.hgetall(
          `analytics:endpoint:${endpoint}`
        );
      }

      const message = safeStringify({
        type: 'rate-limit-analytics',
        timestamp: new Date().toISOString(),
        topIps,
        stats,
      });

      if (!message) return;

      for (const socket of clients) {
        safeSend(socket, message);
      }
    } catch (err) {
      console.error('WS Analytics Broadcast Error:', err.message);
    }
  }, 2000);

  return wss;
}

export function broadcast(payload) {
  const message = safeStringify(payload);
  if (!message) return;
  for (const socket of clients) {
    safeSend(socket, message);
  }
}
