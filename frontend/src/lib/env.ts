/**
 * Type-safe Centralized Environment Configuration & Dynamic URL Resolution
 * FE-EPIC-30 / Issue #1521
 */

export interface AppEnv {
  apiUrl: string;
  wsUrl: string;
  stellarNetwork: 'testnet' | 'futurenet' | 'mainnet' | 'standalone';
  sorobanRpcUrl: string;
  isProduction: boolean;
}

const getEnvVar = (key: string, defaultValue: string): string => {
  if (typeof process !== 'undefined' && process.env && process.env[key]) {
    return process.env[key] as string;
  }
  return defaultValue;
};

export const env: AppEnv = {
  apiUrl: getEnvVar('NEXT_PUBLIC_API_URL', 'http://localhost:5000'),
  wsUrl: getEnvVar('NEXT_PUBLIC_WS_URL', 'ws://localhost:5000'),
  stellarNetwork: (getEnvVar('NEXT_PUBLIC_STELLAR_NETWORK', 'testnet') as AppEnv['stellarNetwork']),
  sorobanRpcUrl: getEnvVar('NEXT_PUBLIC_SOROBAN_RPC_URL', 'https://soroban-testnet.stellar.org'),
  isProduction: getEnvVar('NODE_ENV', 'development') === 'production',
};

export async function checkConnectionHealth(url: string = env.apiUrl): Promise<{ healthy: boolean; latencyMs: number }> {
  const start = Date.now();
  try {
    const res = await fetch(`${url}/health`, { method: 'GET', signal: AbortSignal.timeout(3000) });
    return { healthy: res.ok, latencyMs: Date.now() - start };
  } catch {
    return { healthy: false, latencyMs: Date.now() - start };
  }
}
