import { parentPort } from 'worker_threads';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';

parentPort.on('message', async (job) => {
  const startedAt = Date.now();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'soroban-compile-'));
  const sourceRoot = path.join(tempDir, 'src');
  await fs.mkdir(sourceRoot, { recursive: true });

  try {
    await fs.writeFile(path.join(tempDir, 'Cargo.toml'), job.cargoToml, 'utf8');
    await fs.writeFile(path.join(sourceRoot, 'lib.rs'), job.code, 'utf8');

    parentPort.postMessage({
      type: 'progress',
      payload: {
        requestId: job.requestId,
        status: 'compiling',
        queueLength: 0,
        activeWorkers: 0,
        etaMs: 0,
      },
    });

    const result = await runCargoBuild(tempDir, job.timeoutMs);
    const wasmPath = path.join(
      tempDir,
      'target',
      'wasm32-unknown-unknown',
      'release',
      'soroban_contract.wasm'
    );
    const cachePath = path.join(job.cacheRoot, `${job.hash}.wasm`);
    const stats = await fs.stat(wasmPath);
    await fs.copyFile(wasmPath, cachePath);

    parentPort.postMessage({
      type: 'result',
      payload: {
        success: true,
        cached: false,
        hash: job.hash,
        durationMs: Date.now() - startedAt,
        artifact: {
          name: 'soroban_contract.wasm',
          sizeBytes: stats.size,
          path: cachePath,
        },
        logs: result.logs,
        memoryPeakBytes: result.memoryPeakBytes,
      },
    });
  } catch (error) {
    parentPort.postMessage({
      type: 'result',
      payload: {
        success: false,
        cached: false,
        hash: job.hash,
        durationMs: Date.now() - startedAt,
        artifact: {
          name: 'soroban_contract.wasm',
          sizeBytes: 0,
          path: path.join(job.cacheRoot, `${job.hash}.wasm`),
        },
        logs: [error.message],
        memoryPeakBytes: 0,
      },
    });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
});

function runCargoBuild(cwd, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'cargo',
      ['build', '--target', 'wasm32-unknown-unknown', '--release'],
      {
        cwd,
        shell: false,
        windowsHide: true,
        env: { ...process.env, RUST_MIN_STACK: '268435456' },
      }
    );

    let stdout = '';
    let stderr = '';
    let memoryPeakBytes = 0;

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Compilation timed out'));
    }, timeoutMs);

    const interval = setInterval(() => {
      if (typeof child.pid === 'number') {
        memoryPeakBytes = Math.max(memoryPeakBytes, process.memoryUsage().rss);
      }
    }, 500);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      clearInterval(interval);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      clearInterval(interval);
      if (code !== 0) {
        reject(new Error(stderr || stdout || `cargo exited with code ${code}`));
        return;
      }
      resolve({
        logs: (stdout + '\n' + stderr).split('\n').filter(Boolean),
        memoryPeakBytes,
      });
    });
  });
}
