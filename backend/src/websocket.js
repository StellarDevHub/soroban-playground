import { WebSocketServer } from 'ws';
import { invokeProgressBus } from './services/invokeService.js';
import { deployProgressBus } from './services/deployService.js';
import { compileProgressBus } from './services/compileService.js';
import oracleProofQueueService from './services/oracleProofQueueService.js';
import redisService from './services/redisService.js';
import { sharedOracleEventBus } from './services/oracle/oracleEvents.js';

const clients = new Set();

export function setupWebsocketServer(httpServer) {
  const wss = new WebSocketServer({
    server: httpServer,
    path: '/ws',
  });

  wss.on('connection', (socket, request) => {
    const authHeader = request.headers.authorization || '';
    const tokenFromQuery = new URL(
      request.url,
      'http://localhost'
    ).searchParams.get('token');
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length)
      : tokenFromQuery;

    if (process.env.WS_AUTH_TOKEN && token !== process.env.WS_AUTH_TOKEN) {
      socket.close(1008, 'Unauthorized');
      return;
    }

    clients.add(socket);
    socket.send(
      JSON.stringify({
        type: 'connected',
        timestamp: new Date().toISOString(),
      })
    );

    socket.on('close', () => {
      clients.delete(socket);
    });
  });

  const forward = (type) => (event) => {
    const message = JSON.stringify({ type, ...event });
    for (const socket of clients) {
      if (socket.readyState === socket.OPEN) {
        socket.send(message);
      }
    }
  };

  invokeProgressBus.on('progress', forward('invoke-progress'));
  deployProgressBus.on('progress', forward('deploy-progress'));
  compileProgressBus.on('progress', forward('compile-progress'));
  oracleProofQueueService.on('progress', forward('oracle-proof-progress'));

  // Forward every oracle lifecycle event under a single ws message type
  // so the frontend can subscribe with one handler.
  sharedOracleEventBus.on('*', (payload) => {
    const message = JSON.stringify({ type: 'oracle-event', ...payload });
    for (const socket of clients) {
      if (socket.readyState === socket.OPEN) socket.send(message);
    }
  });

  // Broadcast analytics every 2 seconds
  setInterval(async () => {
    if (clients.size === 0 || redisService.isFallbackMode || !redisService.client) return;
    
    try {
      const topIps = await redisService.client.zrevrange('analytics:top_ips', 0, 9, 'WITHSCORES');
      const endpoints = ['compile', 'invoke', 'deploy', 'global'];
      const stats = {};
      
      for (const endpoint of endpoints) {
        stats[endpoint] = await redisService.client.hgetall(`analytics:endpoint:${endpoint}`);
      }

      const message = JSON.stringify({
        type: 'rate-limit-analytics',
        timestamp: new Date().toISOString(),
        topIps,
        stats
      });

      for (const socket of clients) {
        if (socket.readyState === socket.OPEN) {
          socket.send(message);
        }
      }
    } catch (err) {
      console.error('WS Analytics Broadcast Error:', err.message);
    }
  }, 2000);

  return wss;
}
