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
import { recordTamperEvidentAuditLog } from './tamperEvidentAuditLogger.js';
import { spawnTracked, terminateChildProcess } from './childProcessManager.js';
import {
  DEFAULT_STALL_TIMEOUT_MS,
  DEFAULT_MAX_BUMPS,
  calculateIncrementedFee,
  getDynamicBaseFee,
  submitWithAutoFeeBump,
} from './stellar/feeBumpService.js';

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
  } catch (error) {
    if (error.code !== 'ENOENT') {
      try {
        appendLog({
          status: 'state-read-failed',
          file: DEFAULT_STATE_FILE,
          error: error.message,
          timestamp: new Date().toISOString(),
        });
      } catch (logError) {
        console.error(
          'Failed to record deployment state read error:',
          logError
        );
      }
    }
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

export function validateDeployContract(contract) {
  const errors = [];
  if (!contract.sourceAccount) {
    errors.push(
      `sourceAccount is required for ${contract.contractName}; set SOROBAN_SOURCE_ACCOUNT or pass sourceAccount`
    );
  }
  if (!fs.existsSync(contract.wasmPath)) {
    errors.push(`WASM file does not exist: ${contract.wasmPath}`);
  }
  if (errors.length > 0) {
    throw new Error(errors.join('; '));
  }
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

function spawnCliDeployAttempt(
  contract,
  { fee, timeoutMs, signal, onProgress, span }
) {
  return new Promise((resolve, reject) => {
    const cliArgs = [
      'contract',
      'deploy',
      '--wasm',
      contract.wasmPath,
      '--source-account',
      contract.sourceAccount,
      ...(fee ? ['--fee', String(fee)] : []),
      ...(contract.preflight
        ? [
            '--rpc-url',
            contract.preflight.rpcUrl,
            '--network-passphrase',
            contract.preflight.passphrase,
            '--salt',
            contract.preflight.salt,
            '--optimize=false',
          ]
        : ['--network', contract.network]),
    ];

    const child = spawnTracked(process.env.SOROBAN_CLI || 'soroban', cliArgs, {
      shell: false,
      windowsHide: true,
      env: injectTraceContext(process.env),
    });

    let stdout = '';
    let stderr = '';
    let done = false;

    const timeout = setTimeout(() => {
      addSpanEvent(span, 'deploy.timeout');
      terminateChildProcess(child);
      const err = new Error(`Deployment timed out for ${contract.contractName}`);
      err.code = 'DEPLOY_TIMEOUT';
      finish(err);
    }, timeoutMs);

    const finish = (err, result) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);

      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
      if (err) reject(err);
      else resolve(result);
    };

    const onAbort = () => {
      addSpanEvent(span, 'deploy.cancelled');
      terminateChildProcess(child);
      const err = new Error(`Deployment cancelled for ${contract.contractName}`);
      err.code = 'DEPLOY_CANCELLED';
      finish(err);
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
        const contractId =
          stdout.trim() || `C${contract.id.padEnd(55, '0').slice(0, 55)}`;
        if (
          contract.preflight &&
          contractId !== contract.preflight.contractId
        ) {
          finish(
            new Error(
              'CLI returned a contract address different from the pre-flight preview'
            )
          );
          return;
        }
        finish(null, {
          contractId,
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

export async function deployContract(contract, { signal, onProgress } = {}) {
  const startTime = Date.now();
  const span = createSpan('soroban.deploy', {
    'deploy.contract_name': contract.contractName,
    'deploy.contract_id': contract.id,
    'deploy.network': contract.network,
    'deploy.wasm_path': contract.wasmPath,
  });

  try {
    // Direct Stellar transaction submission path with SEP-0029 automated fee bumping
    if (contract.transaction || contract.transactionXdr) {
      const feeBumpConfig =
        typeof contract.feeBump === 'object' ? contract.feeBump : {};
      const txResult = await submitWithAutoFeeBump({
        innerTransaction: contract.transaction,
        innerTransactionXdr: contract.transactionXdr,
        feeSource: feeBumpConfig.feeSource || contract.sourceAccount,
        feeSourceKeypair: feeBumpConfig.feeSourceKeypair,
        feeBumpSigner: feeBumpConfig.feeBumpSigner,
        network: contract.network,
        horizonUrl: feeBumpConfig.horizonUrl,
        networkPassphrase: feeBumpConfig.networkPassphrase,
        submitTransaction: feeBumpConfig.submitTransaction,
        checkTransactionStatus: feeBumpConfig.checkTransactionStatus,
        stallTimeoutMs:
          feeBumpConfig.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS,
        pollIntervalMs: feeBumpConfig.pollIntervalMs,
        maxBumps: feeBumpConfig.maxBumps ?? DEFAULT_MAX_BUMPS,
        feeIncrementMultiplier: feeBumpConfig.feeIncrementMultiplier,
        percentile: feeBumpConfig.percentile,
        maxFee: feeBumpConfig.maxFee,
        fetchImpl: feeBumpConfig.fetchImpl,
        signal,
        onFeeBump: (bumpInfo) => {
          addSpanEvent(span, 'deploy.fee_bump', {
            attempt: bumpInfo.attempt,
            previous_fee: bumpInfo.previousFee,
            new_fee: bumpInfo.newFee,
            hash: bumpInfo.hash,
          });
          onProgress?.(
            'fee-bumping',
            `Bumping fee from ${bumpInfo.previousFee} to ${bumpInfo.newFee} stroops (attempt ${bumpInfo.attempt})`
          );
          feeBumpConfig.onFeeBump?.(bumpInfo);
        },
      });

      const contractId =
        txResult.result?.contractId ||
        contract.preflight?.contractId ||
        `C${(contract.id || 'contract').padEnd(55, '0').slice(0, 55)}`;

      recordTamperEvidentAuditLog({
        action: 'contract_deploy',
        contractId,
        ledgerSequence:
          contract.ledgerSequence || contract.ledger_sequence || 1,
        sessionId: contract.sessionId || contract.session_id || 'sess-deploy',
        userId: contract.userId || contract.user_id,
        metadata: {
          contractName: contract.contractName,
          network: contract.network,
          fee: txResult.fee,
          feeBumps: txResult.bumps,
          txHash: txResult.hash,
        },
      }).catch(() => {});

      const durationMs = Date.now() - startTime;
      setSpanAttributes(span, {
        'deploy.duration_ms': durationMs,
        'deploy.exit_code': 0,
        'deploy.contract_id': contractId,
        'deploy.fee': txResult.fee,
        'deploy.fee_bumps': txResult.bumps,
      });

      return {
        contractId,
        hash: txResult.hash,
        fee: txResult.fee,
        feeBumps: txResult.bumps,
        bumpHistory: txResult.bumpHistory,
        result: txResult.result,
      };
    }

    validateDeployContract(contract);

    const feeBumpEnabled = Boolean(contract.feeBump);
    const feeBumpConfig =
      typeof contract.feeBump === 'object' ? contract.feeBump : {};
    const useDynamicFee = Boolean(contract.dynamicFee || feeBumpEnabled);

    let currentFee = contract.fee || null;
    if (useDynamicFee && !currentFee) {
      const dynamic = await getDynamicBaseFee({
        network: contract.network,
        horizonUrl: feeBumpConfig.horizonUrl,
        percentile: feeBumpConfig.percentile,
        maxFee: feeBumpConfig.maxFee,
        fetchImpl: feeBumpConfig.fetchImpl,
        signal,
      });
      currentFee = dynamic.fee;
    }

    const baseTimeoutMs = Number.parseInt(
      process.env.DEPLOY_TIMEOUT_MS || `${DEFAULT_TIMEOUT_MS}`,
      10
    );
    const stallTimeoutMs = feeBumpEnabled
      ? (feeBumpConfig.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS)
      : baseTimeoutMs;
    const maxBumps = feeBumpEnabled
      ? (feeBumpConfig.maxBumps ?? DEFAULT_MAX_BUMPS)
      : 0;
    const bumpHistory = [];

    for (let bumpAttempt = 0; bumpAttempt <= maxBumps; bumpAttempt += 1) {
      try {
        const result = await spawnCliDeployAttempt(contract, {
          fee: currentFee,
          timeoutMs: stallTimeoutMs,
          signal,
          onProgress,
          span,
        });

        recordTamperEvidentAuditLog({
          action: 'contract_deploy',
          contractId: result.contractId,
          ledgerSequence:
            contract.ledgerSequence || contract.ledger_sequence || 1,
          sessionId: contract.sessionId || contract.session_id || 'sess-deploy',
          userId: contract.userId || contract.user_id,
          metadata: {
            contractName: contract.contractName,
            network: contract.network,
            ...(currentFee ? { fee: currentFee } : {}),
            ...(bumpHistory.length > 0
              ? { feeBumps: bumpHistory.length }
              : {}),
          },
        }).catch(() => {});

        const durationMs = Date.now() - startTime;
        setSpanAttributes(span, {
          'deploy.duration_ms': durationMs,
          'deploy.exit_code': 0,
          'deploy.contract_id': result.contractId,
          ...(currentFee ? { 'deploy.fee': currentFee } : {}),
          ...(bumpHistory.length > 0
            ? { 'deploy.fee_bumps': bumpHistory.length }
            : {}),
        });

        return {
          ...result,
          ...(currentFee ? { fee: currentFee } : {}),
          ...(feeBumpEnabled
            ? { feeBumps: bumpHistory.length, bumpHistory }
            : {}),
        };
      } catch (error) {
        const isStallTimeout = error.code === 'DEPLOY_TIMEOUT';
        if (!feeBumpEnabled || !isStallTimeout || bumpAttempt >= maxBumps) {
          throw error;
        }

        const latestDynamic = await getDynamicBaseFee({
          network: contract.network,
          horizonUrl: feeBumpConfig.horizonUrl,
          percentile: feeBumpConfig.percentile,
          maxFee: feeBumpConfig.maxFee,
          fetchImpl: feeBumpConfig.fetchImpl,
          signal,
        });

        const previousFee = currentFee || latestDynamic.fee;
        currentFee = calculateIncrementedFee(previousFee, latestDynamic.fee, {
          multiplier: feeBumpConfig.feeIncrementMultiplier,
          maxFee: feeBumpConfig.maxFee,
        });

        const bumpRecord = {
          attempt: bumpAttempt + 1,
          previousFee,
          newFee: currentFee,
          dynamicP90Fee: latestDynamic.fee,
          timestamp: new Date().toISOString(),
        };
        bumpHistory.push(bumpRecord);

        addSpanEvent(span, 'deploy.fee_bump', {
          attempt: bumpRecord.attempt,
          previous_fee: previousFee,
          new_fee: currentFee,
        });
        onProgress?.(
          'fee-bumping',
          `Deployment stalled; bumping fee from ${previousFee} to ${currentFee} stroops (attempt ${bumpRecord.attempt})`
        );
        feeBumpConfig.onFeeBump?.(bumpRecord);
      }
    }

    throw new Error(`Deployment failed for ${contract.contractName}`);
  } catch (err) {
    const durationMs = Date.now() - startTime;
    setSpanAttributes(span, {
      'deploy.duration_ms': durationMs,
      'deploy.exit_code': err.code || 1,
    });
    span.setStatus({ code: 2, message: err.message });
    throw err;
  } finally {
    span.end();
  }
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
        deployments: deployed,
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
  } finally {
    span.end();
  }
}

export function getDeploymentState() {
  return readState();
}

export { deployProgressBus, topoSortContracts };
