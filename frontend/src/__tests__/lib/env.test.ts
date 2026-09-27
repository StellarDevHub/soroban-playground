import { env, checkConnectionHealth } from '../../lib/env';

describe('Centralized Environment Configuration (FE-EPIC-30)', () => {
  it('provides default environment values', () => {
    expect(env.apiUrl).toBeDefined();
    expect(env.wsUrl).toBeDefined();
    expect(env.stellarNetwork).toBe('testnet');
  });

  it('checks connection health', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    const health = await checkConnectionHealth('http://localhost:5000');
    expect(health.healthy).toBe(true);
    expect(health.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
