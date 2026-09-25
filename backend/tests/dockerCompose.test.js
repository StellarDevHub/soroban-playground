import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

// Issues #1571 / #1572 — static checks on the Compose stack so regressions
// are caught without a Docker daemon. CI additionally runs
// `docker compose config` and boots the stack.

const root = path.resolve(__dirname, '..', '..');
const load = (file) =>
  yaml.load(fs.readFileSync(path.join(root, file), 'utf8'));

const compose = load('docker-compose.yml');
const overlay = load('docker-compose.local-rpc.yml');
const { services, networks, volumes } = compose;

const envOf = (service) =>
  Object.fromEntries(
    (service.environment || []).map((entry) => {
      const idx = entry.indexOf('=');
      return [entry.slice(0, idx), entry.slice(idx + 1)];
    })
  );

describe('docker-compose.yml data stack (#1571)', () => {
  it.each([
    ['redis', /^redis:7-alpine$/],
    ['postgres', /^postgres:16-alpine$/],
  ])('%s uses the pinned alpine image', (name, image) => {
    expect(services[name].image).toMatch(image);
  });

  it.each(['redis', 'postgres'])('%s has a healthcheck', (name) => {
    const hc = services[name].healthcheck;
    expect(hc).toBeDefined();
    expect(hc.test.join(' ')).toMatch(/redis-cli ping|pg_isready/);
    expect(hc.retries).toBeGreaterThan(0);
  });

  it.each([
    ['redis', 'redis-data', '/data'],
    ['postgres', 'postgres-data', '/var/lib/postgresql/data'],
  ])('%s persists data in a named volume', (name, volume, mountPath) => {
    expect(volumes).toHaveProperty(volume);
    expect(services[name].volumes).toContain(`${volume}:${mountPath}`);
  });

  it('redis enables AOF persistence', () => {
    expect(services.redis.command).toEqual(
      expect.arrayContaining(['--appendonly', 'yes'])
    );
  });

  it('isolates data stores on an internal network with no host ports', () => {
    expect(networks['data-net']).toMatchObject({ internal: true });
    for (const name of ['redis', 'postgres']) {
      expect(services[name].networks).toEqual(['data-net']);
      expect(services[name].ports).toBeUndefined();
    }
    expect(services.frontend.networks).not.toContain('data-net');
  });

  it('backend and indexer wait for healthy data stores', () => {
    expect(services.backend.depends_on.redis.condition).toBe('service_healthy');
    expect(services.indexer.depends_on.postgres.condition).toBe(
      'service_healthy'
    );
    expect(services.backend.networks).toContain('data-net');
    expect(services.indexer.networks).toContain('data-net');
  });

  it('wires backend to redis and indexer to postgres', () => {
    expect(envOf(services.backend).REDIS_URL).toBe('redis://redis:6379');
    expect(envOf(services.indexer).SECONDARY_DATABASE_URL).toMatch(
      /^postgres:\/\/.+@postgres:5432\//
    );
  });

  it('every service restarts and rotates logs', () => {
    for (const [name, service] of Object.entries(services)) {
      expect([name, service.restart]).toEqual([name, 'unless-stopped']);
      expect(service.logging?.driver).toBe('json-file');
    }
  });
});

describe('Stellar Quickstart local RPC (#1572)', () => {
  const rpc = services['stellar-rpc'];

  it('runs a standalone quickstart node behind an opt-in profile', () => {
    expect(rpc.image).toMatch(/^stellar\/quickstart:/);
    expect(rpc.profiles).toEqual(['local-rpc']);
    expect(rpc.command).toContain('--local');
  });

  it('health-checks the Soroban RPC getHealth method', () => {
    expect(rpc.healthcheck.test.join(' ')).toMatch(/getHealth/);
  });

  it('binds the RPC port to localhost only', () => {
    expect(rpc.ports[0]).toMatch(/^127\.0\.0\.1:/);
  });

  it('overlay points the backend at the local node without public fallbacks', () => {
    const env = envOf(overlay.services.backend);
    expect(env.SOROBAN_RPC_URL).toBe('http://stellar-rpc:8000/rpc');
    expect(env.SOROBAN_RPC_FALLBACK_URLS).toBe('http://stellar-rpc:8000/rpc');
    expect(env.STELLAR_NETWORK_PASSPHRASE).toBe(
      'Standalone Network ; February 2017'
    );
    expect(overlay.services.backend.depends_on['stellar-rpc'].condition).toBe(
      'service_healthy'
    );
  });
});
