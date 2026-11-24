import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import redisService from '../src/services/redisService.js';
import cacheService from '../src/services/cacheService.js';

// Opt in with an installed redis-server executable; this test owns its process
// and ephemeral port and never stops an externally supplied Redis instance.
const integration = process.env.REDIS_TEST_SERVER ? describe : describe.skip;
integration('Redis cache outage and recovery (real server)', () => {
  let server;
  let port;
  const originalUrl = process.env.REDIS_URL;
  async function waitFor(predicate) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (await predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Timed out waiting for Redis lifecycle transition');
  }
  async function startServer() {
    server = spawn(
      process.env.REDIS_TEST_SERVER,
      [
        '--bind',
        '127.0.0.1',
        '--port',
        String(port),
        '--save',
        '',
        '--appendonly',
        'no',
        '--protected-mode',
        'yes',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    let output = '';
    let spawnError;
    server.once('error', (err) => {
      spawnError = err;
    });
    server.stdout.on('data', (chunk) => {
      output += chunk;
    });
    server.stderr.on('data', (chunk) => {
      output += chunk;
    });
    await waitFor(() => {
      if (spawnError) throw spawnError;
      if (server.exitCode !== null) throw new Error(`Redis exited: ${output}`);
      return output.includes('Ready to accept connections');
    });
  }
  async function stopServer() {
    if (!server || server.exitCode !== null) return;
    const exited = once(server, 'exit');
    server.kill('SIGTERM');
    await exited;
  }
  beforeAll(async () => {
    const listener = createServer();
    listener.listen(0, '127.0.0.1');
    await once(listener, 'listening');
    port = listener.address().port;
    await new Promise((resolve) => listener.close(resolve));
    process.env.REDIS_URL = `redis://127.0.0.1:${port}`;
    await startServer();
    await redisService.initialize();
    await waitFor(() => redisService.isConnected);
  }, 20000);
  afterAll(async () => {
    await redisService.close();
    await stopServer();
    if (originalUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = originalUrl;
  }, 20000);

  test('shares Redis, falls back during outage, then reconnects without restarting the app', async () => {
    const client = redisService.client;
    await cacheService.set('integration:shared', { source: 'redis' }, 30);
    expect(JSON.parse(await client.get('integration:shared'))).toEqual({
      source: 'redis',
    });
    expect(await cacheService.healthCheck()).toMatchObject({
      status: 'connected',
      ping: 'PONG',
    });
    await stopServer();
    await waitFor(() => redisService.isFallbackMode);
    expect(await cacheService.healthCheck()).toMatchObject({
      status: 'fallback',
    });
    await cacheService.set('integration:offline', { source: 'memory' }, 30);
    expect(await cacheService.get('integration:offline')).toEqual({
      source: 'memory',
    });
    await startServer();
    await waitFor(() => redisService.isConnected);
    expect(redisService.client).toBe(client);
    expect(await cacheService.healthCheck()).toMatchObject({
      status: 'connected',
    });
    await cacheService.set(
      'integration:recovered',
      { source: 'redis-again' },
      30
    );
    expect(JSON.parse(await client.get('integration:recovered'))).toEqual({
      source: 'redis-again',
    });
    expect(redisService.circuitBreakerState).toBe('CLOSED');
  }, 40000);
});
