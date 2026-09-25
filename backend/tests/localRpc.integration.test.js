import { Keypair } from '@stellar/stellar-sdk';

// Issue #1572 — exercises the offline Stellar Quickstart node started with:
//   docker compose -f docker-compose.yml -f docker-compose.local-rpc.yml \
//     --profile local-rpc up -d --wait stellar-rpc
// Skipped unless STELLAR_LOCAL_RPC_URL is set (the CI local-rpc job sets it).

const rpcUrl = process.env.STELLAR_LOCAL_RPC_URL;
const describeRpc = rpcUrl ? describe : describe.skip;

async function rpc(method, params) {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  expect(res.ok).toBe(true);
  const body = await res.json();
  expect(body.error).toBeUndefined();
  return body.result;
}

describeRpc('local Stellar Quickstart RPC', () => {
  jest.setTimeout(60_000);

  it('reports healthy', async () => {
    const result = await rpc('getHealth');
    expect(result.status).toBe('healthy');
  });

  it('serves the standalone network passphrase', async () => {
    const result = await rpc('getNetwork');
    expect(result.passphrase).toBe('Standalone Network ; February 2017');
  });

  it('closes ledgers', async () => {
    const first = await rpc('getLatestLedger');
    await new Promise((resolve) => setTimeout(resolve, 6_000));
    const second = await rpc('getLatestLedger');
    expect(second.sequence).toBeGreaterThan(first.sequence);
  });

  it('funds accounts through Friendbot and exposes them via RPC', async () => {
    const { friendbotUrl } = await rpc('getNetwork');
    const account = Keypair.random().publicKey();
    const res = await fetch(`${friendbotUrl}?addr=${account}`);
    expect(res.ok).toBe(true);

    const { xdr } = await import('@stellar/stellar-sdk');
    const key = xdr.LedgerKey.account(
      new xdr.LedgerKeyAccount({
        accountId: Keypair.fromPublicKey(account).xdrAccountId(),
      })
    ).toXDR('base64');
    const result = await rpc('getLedgerEntries', { keys: [key] });
    expect(result.entries).toHaveLength(1);
  });
});
