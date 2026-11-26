import { parentPort } from 'worker_threads';
import fs from 'fs/promises';
import path from 'path';
import {
  assertSandboxedOutputPath,
  createBuildSandboxPaths,
  createSandboxEnv,
  getCompileTempRoot,
  getCompileTempPrefix,
} from './buildSandbox.js';
import {
  assertNoBuildScriptInWorkspace,
  runSandboxedCargoBuild,
  getSandboxDefaults,
  sanitizeCargoTomlForSandbox,
} from './compileSandbox.js';
import { buildCargoToml } from '../routes/compile_utils.js';

const sandboxDefaults = getSandboxDefaults();

parentPort.on('message', async (job) => {
  const startedAt = Date.now();
  const tempDir = await fs.mkdtemp(
    path.join(getCompileTempRoot(), getCompileTempPrefix())
  );
  const sandbox = createBuildSandboxPaths(tempDir);
  await fs.mkdir(sandbox.sourceRoot, { recursive: true });
  await fs.mkdir(sandbox.cargoHome, { recursive: true });
  await fs.mkdir(sandbox.cargoTargetDir, { recursive: true });

  try {
    const rawCargoToml = job.cargoToml || buildCargoToml(job.dependencies || {});
    const cargoToml = sanitizeCargoTomlForSandbox(rawCargoToml);
    await fs.writeFile(
      path.join(sandbox.crateRoot, 'Cargo.toml'),
      cargoToml,
      'utf8'
    );
    await fs.writeFile(
      path.join(sandbox.sourceRoot, 'lib.rs'),
      job.code,
      'utf8'
    );
    await assertNoBuildScriptInWorkspace(sandbox.crateRoot);

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

    const result = await runSandboxedCargoBuild({
      crateRoot: sandbox.crateRoot,
      workspaceDir: tempDir,
      env: createSandboxEnv(process.env, sandbox),
      timeoutMs: job.timeoutMs || sandboxDefaults.timeoutMs,
    });
    const cacheRoot =
      job.cacheRoot ||
      process.env.WASM_CACHE_DIR ||
      path.join(process.cwd(), 'cache', 'wasm');
    await fs.mkdir(cacheRoot, { recursive: true });
    assertSandboxedOutputPath(sandbox, sandbox.wasmOutPath);
    const wasmPath = sandbox.wasmOutPath;
    const cachePath = path.join(cacheRoot, `${job.hash}.wasm`);
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
    const fallbackCacheRoot =
      job.cacheRoot ||
      process.env.WASM_CACHE_DIR ||
      path.join(process.cwd(), 'cache', 'wasm');
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
          path: path.join(fallbackCacheRoot, `${job.hash}.wasm`),
        },
        logs: error.message.split(/\r?\n/).filter(Boolean),
        memoryPeakBytes: 0,
      },
    });
  } finally {
    // RAII-style cleanup: always remove the temp workspace, even on failure,
    // timeout or an unexpected throw. Stale dirs left behind by a hard crash
    // are swept by cleanupWorker.js / temp-cleanup.service.ts.
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
});
