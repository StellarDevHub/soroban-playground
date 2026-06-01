import { EventEmitter } from 'events';
import { jest } from '@jest/globals';

let deploymentState = { activeDeployments: [], history: [] };

const fsMock = {
  mkdirSync: jest.fn(),
  existsSync: jest.fn(() => true),
  readFileSync: jest.fn(() => `${JSON.stringify(deploymentState)}\n`),
  writeFileSync: jest.fn((_filePath, contents) => {
    deploymentState = JSON.parse(contents);
  }),
  appendFileSync: jest.fn(),
};

const spawnMock = jest.fn();

const span = {
  end: jest.fn(),
  setStatus: jest.fn(),
};

const alertManager = {
  checkDeploymentFailure: jest.fn(),
};

jest.unstable_mockModule('fs', () => ({
  default: fsMock,
  ...fsMock,
}));

jest.unstable_mockModule('child_process', () => ({
  spawn: spawnMock,
}));

jest.unstable_mockModule('../src/utils/tracing.js', () => ({
  createSpan: jest.fn(() => span),
  setSpanAttributes: jest.fn(),
  addSpanEvent: jest.fn(),
  injectTraceContext: jest.fn((env) => env),
}));

jest.unstable_mockModule('../src/utils/alerting.js', () => ({
  alertManager,
}));

const {
  deployBatchContracts,
  deployContract,
  getDeploymentState,
  validateDeployContract,
} = await import('../src/services/deployService.js');

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
    fsMock.existsSync.mockReturnValue(true);
  });

  it('validates deploy contracts before spawning the CLI', () => {
    expect(() =>
      validateDeployContract({
        contractName: 'demo',
        wasmPath: '/tmp/demo.wasm',
        sourceAccount: 'GABC123',
      })
    ).not.toThrow();

    fsMock.existsSync.mockReturnValue(false);
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
    spawnMock.mockReturnValue(child);

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
    spawnMock.mockReturnValue(child);

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
    spawnMock
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
    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect(getDeploymentState().history).toHaveLength(1);
    expect(getDeploymentState().history[0]).toMatchObject({
      deploymentId: 'batch-1',
      status: 'success',
    });
  });

  it('records failed batch deployments and notifies alerting', async () => {
    const child = createChildProcess();
    spawnMock.mockReturnValue(child);

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

    child.stderr.emit('data', Buffer.from('bad deploy'));
    child.emit('close', 1);

    await expect(promise).rejects.toThrow(/bad deploy/);
    expect(alertManager.checkDeploymentFailure).toHaveBeenCalledWith(
      'batch-2',
      expect.objectContaining({ message: 'bad deploy' })
    );
    expect(getDeploymentState().history[0]).toMatchObject({
      deploymentId: 'batch-2',
      status: 'failed',
      error: 'bad deploy',
    });
  });
});
