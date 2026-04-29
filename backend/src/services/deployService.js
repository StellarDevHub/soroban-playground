import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import {
  normalizeBatchContract,
  topoSortContracts,
  validateBatchContractsInput,
} from './deployUtils.js';
import {
  createSpan,
  setSpanAttributes,
  addSpanEvent,
  injectTraceContext,
} from '../utils/tracing.js';
import { alertManager } from '../utils/alerting.js';

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_STATE_FILE =
  process.env.DEPLOYMENTS_STATE_FILE ||
  path.join(process.cwd(), 'data', 'deployments.json');
const DEFAULT_LOG_FILE =
  process.env.DEPLOY_LOG_FILE || path.join(process.cwd(), 'logs', 'deploy.log');

const deployProgressBus = new EventEmitter();

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(DEFAULT_STATE_FILE, 'utf8'));
  } catch {
    return { activeDeployments: [], history: [] };
  }
}

function writeState(state) {
  ensureDir(DEFAULT_STATE_FILE);
  fs.writeFileSync(DEFAULT_STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

function appendLog(entry) {
  ensureDir(DEFAULT_LOG_FILE);
  fs.appendFileSync(DEFAULT_LOG_FILE, `${JSON.stringify(entry)}\n`);
}

function emitProgress(event) {
  deployProgressBus.emit('progress', {
    ...event,
    timestamp: new Date().toISOString(),
  });
}

export function validateBatchContracts(contracts) {
  validateBatchContractsInput(contracts);
  const normalized = contracts.map((contract, index) =>
    normalizeBatchContract(contract, index)
  );
  const ids = new Set();
  for (const contract of normalized) {
    if (ids.has(contract.id)) {
      throw new Error(`Duplicate contract id "${contract.id}"`);
    }
    ids.add(contract.id);
  }

  return normalized;
}

function deployContract(contract, { signal, onProgress } = {}) {
  const span = createSpan('soroban.deploy', {
    'deploy.contract_name': contract.contractName,
    'deploy.contract_id': contract.id,
    'deploy.network': contract.network,
    'deploy.wasm_path': contract.wasmPath,
  });

  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    const child = spawn(
      process.env.SOROBAN_CLI || 'soroban',
      [
        'contract',
        'deploy',
        '--wasm',
        contract.wasmPath,
        '--source-account',
        contract.sourceAccount,
        '--network',
        contract.network,
      ],
      {
        shell: false,
        windowsHide: true,
        env: injectTraceContext(process.env),
      }
    );

    let stdout = '';
    let stderr = '';
    let done = false;
    const timeout = setTimeout(
      () => {
        addSpanEvent(span, 'deploy.timeout');
        child.kill('SIGKILL');
        done = true;
        reject(new Error(`Deployment timed out for ${contract.contractName}`));
      },
      Number.parseInt(
        process.env.DEPLOY_TIMEOUT_MS || `${DEFAULT_TIMEOUT_MS}`,
        10
      )
    );

    const finish = (err, result) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);

      const durationMs = Date.now() - startTime;
      setSpanAttributes(span, {
        'deploy.duration_ms': durationMs,
        'deploy.exit_code': err ? err.code || 1 : 0,
        'deploy.contract_id': result?.contractId,
      });

      if (err) {
        span.setStatus({ code: 2, message: err.message });
      }

      span.end();

      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
      if (err) reject(err);
      else resolve(result);
    };

    const onAbort = () => {
      addSpanEvent(span, 'deploy.cancelled');
      child.kill('SIGKILL');
      finish(new Error(`Deployment cancelled for ${contract.contractName}`));
    };

    if (signal) {
      if (signal.aborted) {
        return onAbort();
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      onProgress?.('deploying', chunk.toString());
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      onProgress?.('deploying', chunk.toString());
    });

    child.on('error', (error) => finish(error));

    child.on('close', (code) => {
      if (code === 0) {
        finish(null, {
          contractId:
            stdout.trim() || `C${contract.id.padEnd(55, '0').slice(0, 55)}`,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        });
        return;
      }
      const error = new Error(
        stderr.trim() || `Deploy exited with code ${code}`
      );
      error.code = code;
      error.stdout = stdout.trim();
      error.stderr = stderr.trim();
      finish(error);
    });
  });
}

async function rollbackContracts(deployed, context) {
  const rollbacked = [];
  for (const contract of [...deployed].reverse()) {
    emitProgress({
      requestId: context.requestId,
      batchId: context.batchId,
      contractId: contract.contractId,
      contractName: contract.contractName,
      status: 'rolling-back',
      detail: `Rolling back ${contract.contractName}`,
    });
    rollbacked.push(contract.contractName);
  }
  return rollbacked;
}

export async function deployBatchContracts(request, { signal } = {}) {
  const span = createSpan('soroban.deploy.batch', {
    'deploy.batch_id': request.batchId || `batch-${Date.now()}`,
    'deploy.contracts_count': request.contracts?.length || 0,
    'deploy.request_id': request.requestId,
  });

  try {
    const normalized = validateBatchContracts(request.contracts || []);
    const ordered = topoSortContracts(normalized);
    const state = readState();
    const deploymentId = request.batchId || `batch-${Date.now()}`;
    const startedAt = new Date().toISOString();

    state.activeDeployments.push({
      deploymentId,
      startedAt,
      contracts: ordered.map((contract) => contract.id),
    });
    writeState(state);

    appendLog({
      deploymentId,
      startedAt,
      status: 'started',
      contracts: ordered,
    });
    emitProgress({
      requestId: request.requestId,
      batchId: deploymentId,
      status: 'deploying',
      detail: `Starting batch deployment of ${ordered.length} contracts`,
    });

    const deployed = [];

    try {
      for (const contract of ordered) {
        let attempt = 0;
        let lastError = null;
        while (attempt < 3) {
          attempt += 1;
          emitProgress({
            requestId: request.requestId,
            batchId: deploymentId,
            contractId: contract.id,
            contractName: contract.contractName,
            status: 'deploying',
            detail: `Deploying ${contract.contractName} attempt ${attempt}/3`,
          });
          try {
            const result = await deployContract(contract, {
              signal,
              onProgress: (_status, detail) =>
                emitProgress({
                  requestId: request.requestId,
                  batchId: deploymentId,
                  contractId: contract.id,
                  contractName: contract.contractName,
                  status: 'deploying',
                  detail,
                }),
            });

            const record = {
              ...contract,
              contractId: result.contractId,
              status: 'deployed',
              deployedAt: new Date().toISOString(),
            };
            deployed.push(record);
            emitProgress({
              requestId: request.requestId,
              batchId: deploymentId,
              contractId: contract.id,
              contractName: contract.contractName,
              status: 'deployed',
              detail: `Deployed ${contract.contractName}`,
            });
            lastError = null;
            break;
          } catch (error) {
            lastError = error;
            if (attempt >= 3) {
              throw error;
            }
          }
        }

        if (lastError) {
          throw lastError;
        }
      }

      state.activeDeployments = state.activeDeployments.filter(
        (item) => item.deploymentId !== deploymentId
      );
      state.history.push({
        deploymentId,
        startedAt,
        endedAt: new Date().toISOString(),
        status: 'success',
        contracts: deployed,
      });
      writeState(state);
      appendLog({ deploymentId, status: 'success', contracts: deployed });
      emitProgress({
        requestId: request.requestId,
        batchId: deploymentId,
        status: 'success',
        detail: 'Batch deployment completed successfully',
      });

      const completedAt = new Date().toISOString();
      setSpanAttributes(span, {
        'deploy.completed_at': completedAt,
        'deploy.deployed_count': deployed.length,
      });

      return {
        success: true,
        status: 'success',
        batchId: deploymentId,
        contracts: deployed,
        startedAt,
        completedAt,
      };
    } catch (error) {
      setSpanAttributes(span, {
        error: true,
        'error.message': error.message,
      });
      span.setStatus({ code: 2, message: error.message });

      alertManager.checkDeploymentFailure(deploymentId, error);

      await rollbackContracts(deployed, {
        requestId: request.requestId,
        batchId: deploymentId,
      });
      state.activeDeployments = state.activeDeployments.filter(
        (item) => item.deploymentId !== deploymentId
      );
      state.history.push({
        deploymentId,
        startedAt,
        endedAt: new Date().toISOString(),
        status: 'failed',
        error: error.message,
        contracts: deployed,
      });
      writeState(state);
      appendLog({
        deploymentId,
        status: 'failed',
        error: error.message,
        contracts: deployed,
      });
      emitProgress({
        requestId: request.requestId,
        batchId: deploymentId,
        status: 'failed',
        detail: error.message,
      });
      throw error;
    }
  } catch (error) {
    span.setStatus({ code: 2, message: error.message });
    throw error;
  } finally {
    span.end();
  }
}

export function getDeploymentState() {
  return readState();
}

export { deployProgressBus, topoSortContracts };
