import { WebSocketServer } from 'ws';
import { invokeProgressBus } from './services/invokeService.js';
import { deployProgressBus } from './services/deployService.js';
import { compileProgressBus } from './services/compileService.js';

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

  return wss;
}
