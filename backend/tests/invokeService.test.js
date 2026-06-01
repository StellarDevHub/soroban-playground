import {
  createCliArgs,
  parseCliOutput,
  validateInvocationRequest,
} from '../src/services/invokeService.js';

const CONTRACT_ID = `C${'A'.repeat(55)}`;

describe('invoke service RPC proxy helpers', () => {
  it('validates contract id, function name, and args shape', () => {
    expect(
      validateInvocationRequest({
        contractId: CONTRACT_ID,
        functionName: 'increment_counter',
        args: { by: 1 },
      })
    ).toEqual([]);

    expect(
      validateInvocationRequest({
        contractId: 'bad',
        functionName: '1bad',
        args: [],
      })
    ).toEqual([
      'contractId must be a valid Stellar contract ID',
      'functionName must be a valid contract function identifier',
      'args must be an object',
    ]);
  });

  it('creates deterministic Soroban CLI args and supports repeated array args', () => {
    const cliArgs = createCliArgs({
      contractId: CONTRACT_ID,
      functionName: 'set_members',
      sourceAccount: 'alice',
      network: 'testnet',
      args: {
        member: ['G1', 'G2'],
        active: true,
        metadata: { role: 'admin' },
      },
    });

    expect(cliArgs).toEqual([
      'contract',
      'invoke',
      '--id',
      CONTRACT_ID,
      '--source-account',
      'alice',
      '--network',
      'testnet',
      '--',
      'set_members',
      '--member',
      'G1',
      '--member',
      'G2',
      '--active',
      'true',
      '--metadata',
      '{"role":"admin"}',
    ]);
  });

  it('rejects unsafe argument names before spawning the CLI', () => {
    expect(() =>
      createCliArgs({
        contractId: CONTRACT_ID,
        functionName: 'set',
        sourceAccount: 'alice',
        args: { 'bad-name': 'value' },
      })
    ).toThrow('Invalid invocation argument name');
  });

  it('parses JSON CLI output and preserves plain text output', () => {
    expect(parseCliOutput('{"ok":true}')).toEqual({
      raw: '{"ok":true}',
      parsed: { ok: true },
    });
    expect(parseCliOutput('hello')).toEqual({ raw: 'hello', parsed: 'hello' });
    expect(parseCliOutput('')).toEqual({ raw: '', parsed: null });
  });
});
