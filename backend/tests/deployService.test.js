import { EventEmitter } from 'events';
import { jest } from '@jest/globals';

let deploymentState = { activeDeployments: [], history: [] };

const mockFs = {
  mkdirSync: jest.fn(),
  existsSync: jest.fn(() => true),
  readFileSync: jest.fn(() => `${JSON.stringify(deploymentState)}\n`),
  writeFileSync: jest.fn((_filePath, contents) => {
    deploymentState = JSON.parse(contents);
  }),
  appendFileSync: jest.fn(),
};

const mockSpawn = jest.fn();

const mockSpan = {
  end: jest.fn(),
  setStatus: jest.fn(),
};

const mockAlertManager = {
  checkDeploymentFailure: jest.fn(),
};

jest.mock('fs', () => ({
  default: mockFs,
  ...mockFs,
}));

jest.mock('child_process', () => ({
  spawn: mockSpawn,
}));

jest.mock('../src/utils/tracing.js', () => ({
  createSpan: jest.fn(() => mockSpan),
  setSpanAttributes: jest.fn(),
  addSpanEvent: jest.fn(),
  injectTraceContext: jest.fn((env) => env),
}));

jest.mock('../src/utils/alerting.js', () => ({
  alertManager: mockAlertManager,
}));

const {
  deployBatchContracts,
  deployContract,
  getDeploymentState,
  validateDeployContract,
} = require('../src/services/deployService.js');

function createChildProcess() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = jest.fn();
  return child;
}

function queueSuccessfulClose(child, contractId) {
  setImmediate(() => {
    child.stdout.emit('data', Buffer.from(contractId));
    child.emit('close', 0);
  });
}

describe('deployService', () => {
  beforeEach(() => {
    deploymentState = { activeDeployments: [], history: [] };
    jest.clearAllMocks();
    mockFs.existsSync.mockReturnValue(true);
  });

  it('validates deploy contracts before spawning the CLI', () => {
    expect(() =>
      validateDeployContract({
        contractName: 'demo',
        wasmPath: '/tmp/demo.wasm',
        sourceAccount: 'GABC123',
      })
    ).not.toThrow();

    mockFs.existsSync.mockReturnValue(false);
    expect(() =>
      validateDeployContract({
        contractName: 'demo',
        wasmPath: '/missing/demo.wasm',
        sourceAccount: 'GABC123',
      })
    ).toThrow(/WASM file does not exist/);
  });

  it('captures stdout and emits progress during a successful deploy', async () => {
    const child = createChildProcess();
    mockSpawn.mockReturnValue(child);

    const onProgress = jest.fn();
    const promise = deployContract(
      {
        contractName: 'demo',
        id: 'demo-contract',
        wasmPath: '/tmp/demo.wasm',
        sourceAccount: 'GABC123',
        network: 'testnet',
      },
      { onProgress }
    );

    child.stdout.emit('data', Buffer.from('C'.repeat(56)));
    child.stderr.emit('data', Buffer.from('cli warning'));
    child.emit('close', 0);

    await expect(promise).resolves.toMatchObject({
      contractId: 'C'.repeat(56),
      stdout: 'C'.repeat(56),
      stderr: 'cli warning',
    });
    expect(onProgress).toHaveBeenCalledWith('deploying', 'C'.repeat(56));
    expect(onProgress).toHaveBeenCalledWith('deploying', 'cli warning');
  });

  it('surfaces CLI failures with captured output', async () => {
    const child = createChildProcess();
    mockSpawn.mockReturnValue(child);

    const promise = deployContract({
      contractName: 'demo',
      id: 'demo-contract',
      wasmPath: '/tmp/demo.wasm',
      sourceAccount: 'GABC123',
      network: 'testnet',
    });

    child.stderr.emit('data', Buffer.from('deployment exploded'));
    child.emit('close', 17);

    await expect(promise).rejects.toMatchObject({
      code: 17,
      stderr: 'deployment exploded',
    });
  });

  it('deploys a batch in dependency order and persists success state', async () => {
    mockSpawn
      .mockImplementationOnce(() => {
        const child = createChildProcess();
        queueSuccessfulClose(child, 'C'.repeat(56));
        return child;
      })
      .mockImplementationOnce(() => {
        const child = createChildProcess();
        queueSuccessfulClose(child, 'D'.repeat(56));
        return child;
      });

    const result = await deployBatchContracts({
      requestId: 'request-1',
      batchId: 'batch-1',
      contracts: [
        {
          id: 'base',
          contractName: 'base',
          wasmPath: '/tmp/base.wasm',
          sourceAccount: 'GABC123',
        },
        {
          id: 'derived',
          contractName: 'derived',
          wasmPath: '/tmp/derived.wasm',
          sourceAccount: 'GABC123',
          dependencies: ['base'],
        },
      ],
    });

    expect(result.contracts.map((contract) => contract.id)).toEqual([
      'base',
      'derived',
    ]);
    expect(mockSpawn).toHaveBeenCalledTimes(2);
    expect(getDeploymentState().history).toHaveLength(1);
    expect(getDeploymentState().history[0]).toMatchObject({
      deploymentId: 'batch-1',
      status: 'success',
    });
  });

  it('records failed batch deployments and notifies alerting', async () => {
    mockSpawn.mockImplementation(() => {
      const child = createChildProcess();
      setImmediate(() => {
        child.stderr.emit('data', Buffer.from('bad deploy'));
        child.emit('close', 1);
      });
      return child;
    });

    const promise = deployBatchContracts({
      requestId: 'request-2',
      batchId: 'batch-2',
      contracts: [
        {
          id: 'solo',
          contractName: 'solo',
          wasmPath: '/tmp/solo.wasm',
          sourceAccount: 'GABC123',
        },
      ],
    });

    await expect(promise).rejects.toThrow(/bad deploy/);
    expect(mockAlertManager.checkDeploymentFailure).toHaveBeenCalledWith(
      'batch-2',
      expect.objectContaining({ message: 'bad deploy' })
    );
    expect(getDeploymentState().history[0]).toMatchObject({
      deploymentId: 'batch-2',
      status: 'failed',
      error: 'bad deploy',
    });
  });

  it('automatically fee-bumps and resubmits a stalled CLI deployment', async () => {
    const firstChild = createChildProcess();
    const secondChild = createChildProcess();

    mockSpawn
      .mockReturnValueOnce(firstChild)
      .mockImplementationOnce(() => {
        queueSuccessfulClose(secondChild, 'E'.repeat(56));
        return secondChild;
      });

    let feeCalls = 0;
    const mockFetch = jest.fn().mockImplementation(async () => {
      feeCalls += 1;
      return {
        ok: true,
        json: async () => ({
          last_ledger_base_fee: '100',
          fee_charged: { p90: feeCalls === 1 ? '200' : '500' },
          max_fee: { p90: feeCalls === 1 ? '250' : '600' },
        }),
      };
    });

    const onProgress = jest.fn();
    const onFeeBump = jest.fn();

    const result = await deployContract(
      {
        contractName: 'stalled-demo',
        id: 'stalled-demo',
        wasmPath: '/tmp/stalled.wasm',
        sourceAccount: 'GABC123',
        network: 'testnet',
        feeBump: {
          stallTimeoutMs: 25,
          maxBumps: 2,
          fetchImpl: mockFetch,
          onFeeBump,
        },
      },
      { onProgress }
    );

    expect(result).toMatchObject({
      contractId: 'E'.repeat(56),
      fee: 600,
      feeBumps: 1,
    });
    expect(mockSpawn).toHaveBeenCalledTimes(2);
    expect(mockSpawn.mock.calls[0][1]).toContain('--fee');
    expect(mockSpawn.mock.calls[0][1]).toContain('250');
    expect(mockSpawn.mock.calls[1][1]).toContain('600');
    expect(onFeeBump).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledWith(
      'fee-bumping',
      expect.stringContaining('250 to 600')
    );
  });
});
