import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';

const MAX_CONCURRENT = Number.parseInt(process.env.INVOKE_POOL_SIZE || '3', 10);
const INVOKE_TIMEOUT_MS = Number.parseInt(
  process.env.INVOKE_TIMEOUT_MS || '30000',
  10
);
const INVOKE_LOG_FILE =
  process.env.INVOKE_LOG_FILE || path.join(process.cwd(), 'logs', 'invoke.log');

const queue = [];
let activeCount = 0;

function ensureLogFile() {
  fs.mkdirSync(path.dirname(INVOKE_LOG_FILE), { recursive: true });
}

function logInvocation(entry) {
  ensureLogFile();
  fs.appendFileSync(INVOKE_LOG_FILE, `${JSON.stringify(entry)}\n`, 'utf8');
}

function createCliArgs(request) {
  const sourceAccount =
    request.sourceAccount || process.env.SOROBAN_SOURCE_ACCOUNT;
  if (!sourceAccount) {
    throw new Error(
      'SOROBAN_SOURCE_ACCOUNT is required to invoke a contract on testnet.'
    );
  }

  const cliArgs = [
    'contract',
    'invoke',
    '--id',
    request.contractId,
    '--source-account',
    sourceAccount,
    '--network',
    request.network || process.env.DEFAULT_NETWORK || 'testnet',
    '--',
    request.functionName,
  ];

  for (const [key, value] of Object.entries(request.args || {})) {
    cliArgs.push(`--${key}`);
    cliArgs.push(String(value));
  }

  return cliArgs;
}

function parseCliOutput(stdout = '') {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return { raw: '', parsed: null };
  }

  try {
    return { raw: trimmed, parsed: JSON.parse(trimmed) };
  } catch {
    return { raw: trimmed, parsed: trimmed };
  }
}

function runQueued(task) {
  return new Promise((resolve, reject) => {
    queue.push({ task, resolve, reject });
    pumpQueue();
  });
}

function pumpQueue() {
  while (activeCount < MAX_CONCURRENT && queue.length > 0) {
    const item = queue.shift();
    activeCount += 1;
    item
      .task()
      .then(item.resolve)
      .catch(item.reject)
      .finally(() => {
        activeCount -= 1;
        pumpQueue();
      });
  }
}

export class InvokeProgressBus extends EventEmitter {}

export const invokeProgressBus = new InvokeProgressBus();

export async function invokeSorobanContract(request, { signal } = {}) {
  const cliArgs = createCliArgs(request);

  return runQueued(
    () =>
      new Promise((resolve, reject) => {
        const startedAt = new Date().toISOString();
        const child = spawn(process.env.SOROBAN_CLI || 'soroban', cliArgs, {
          shell: false,
          windowsHide: true,
        });

        let stdout = '';
        let stderr = '';
        let finished = false;
        let timeout = null;

        const emit = (status, detail) => {
          const payload = {
            requestId: request.requestId,
            contractId: request.contractId,
            functionName: request.functionName,
            status,
            detail,
            timestamp: new Date().toISOString(),
          };
          invokeProgressBus.emit('progress', payload);
        };

        const cleanup = () => {
          if (timeout) {
            clearTimeout(timeout);
            timeout = null;
          }
          if (signal) {
            signal.removeEventListener('abort', onAbort);
          }
        };

        const complete = (err, result) => {
          if (finished) return;
          finished = true;
          cleanup();

          if (err) {
            reject(err);
          } else {
            resolve(result);
          }
        };

        const onAbort = () => {
          child.kill('SIGKILL');
          complete(new Error('Invocation cancelled'));
        };

        if (signal) {
          if (signal.aborted) {
            return onAbort();
          }
          signal.addEventListener('abort', onAbort, { once: true });
        }

        timeout = setTimeout(() => {
          child.kill('SIGKILL');
          complete(
            new Error(`Invocation timed out after ${INVOKE_TIMEOUT_MS}ms`)
          );
        }, INVOKE_TIMEOUT_MS);

        emit('invoking', 'spawned soroban CLI');

        child.stdout.on('data', (chunk) => {
          const text = chunk.toString();
          stdout += text;
          emit('executing', text.trim() || 'cli output');
        });

        child.stderr.on('data', (chunk) => {
          const text = chunk.toString();
          stderr += text;
          emit('executing', text.trim() || 'cli stderr');
        });

        child.on('error', (error) => {
          logInvocation({
            startedAt,
            endedAt: new Date().toISOString(),
            request,
            status: 'failed',
            error: error.message,
          });
          emit('failed', error.message);
          complete(error);
        });

        child.on('close', (code) => {
          const endedAt = new Date().toISOString();
          const output = parseCliOutput(stdout);
          const baseResult = {
            success: code === 0,
            status: code === 0 ? 'success' : 'failed',
            contractId: request.contractId,
            functionName: request.functionName,
            stdout: output.raw,
            parsed: output.parsed,
            stderr: stderr.trim() || undefined,
            startedAt,
            endedAt,
          };

          logInvocation({
            startedAt,
            endedAt,
            request,
            status: baseResult.status,
            code,
            stdout: output.raw,
            stderr: stderr.trim(),
          });

          if (code === 0) {
            emit('success', output.parsed ?? output.raw);
            complete(null, baseResult);
            return;
          }

          const error = new Error(
            stderr.trim() || `Soroban CLI exited with code ${code}`
          );
          error.code = code;
          error.stdout = output.raw;
          error.stderr = stderr.trim();
          emit('failed', error.message);
          complete(error);
        });
      })
  );
}
