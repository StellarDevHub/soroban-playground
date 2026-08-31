// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT
//
// Sandboxed Rust compilation engine (issue #1330).
//
// Compilation no longer invokes `cargo` directly on the host OS. Two isolated
// execution modes are supported:
//
//   * docker  — cargo runs inside an ephemeral rootless Docker container with
//               hard resource caps (512MB RAM, 2 CPU cores, pid + no-new-privs
//               limits) and no network. This is the production path.
//   * process — best-effort fallback used when Docker is unavailable (local
//               dev, CI). The cargo process is spawned in its own process
//               group so the whole tree can be SIGKILLed on timeout.
//
// Both modes enforce a strict compilation timeout with a SIGTERM -> SIGKILL
// escalation, and both run through the shared child-process manager so no
// orphaned processes survive a crash or shutdown.

import { spawn } from 'child_process';
import os from 'os';
import { trackChildProcess } from './childProcessManager.js';

const DOCKER_PROBE_TIMEOUT_MS = 3000;
const KILL_GRACE_MS = 2000;
const DOCKER_SANDBOX_IMAGE =
  process.env.COMPILE_SANDBOX_IMAGE || 'soroban-compile:latest';
const SANDBOX_MODE = (process.env.COMPILE_SANDBOX_MODE || 'auto').toLowerCase();
const SANDBOX_MEMORY_MB = Number.parseInt(
  process.env.COMPILE_SANDBOX_MEMORY_MB || '512',
  10
);
const SANDBOX_CPU_CORES = Number.parseInt(
  process.env.COMPILE_SANDBOX_CPU_CORES || '2',
  10
);
const SANDBOX_PIDS_LIMIT = Number.parseInt(
  process.env.COMPILE_SANDBOX_PIDS_LIMIT || '256',
  10
);
const SANDBOX_USER = process.env.COMPILE_SANDBOX_USER || '1000:1000';

let dockerProbe = null;

// Test-only hook: clears the cached docker-availability probe so each test
// starts from a clean slate.
export function resetSandboxStateForTests() {
  dockerProbe = null;
}

export function isDockerAvailable() {
  if (dockerProbe) return dockerProbe;
  dockerProbe = new Promise((resolve) => {
    const child = spawn(
      'docker',
      ['version', '--format', '{{.Server.Version}}'],
      {
        stdio: 'ignore',
        windowsHide: true,
      }
    );
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(false);
    }, DOCKER_PROBE_TIMEOUT_MS);
    child.once('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
  return dockerProbe;
}

export function resolveSandboxMode(configuredMode = SANDBOX_MODE) {
  const mode = String(configuredMode || 'auto').toLowerCase();
  if (mode === 'docker' || mode === 'process') return Promise.resolve(mode);
  return isDockerAvailable().then((available) =>
    available ? 'docker' : 'process'
  );
}

// Builds the `docker run` argv for the sandboxed compile. The crate workspace
// is bind-mounted at /build so the resulting .wasm lands on the host temp dir
// without any extra copy step.
export function buildDockerArgs({
  workspaceDir,
  image = DOCKER_SANDBOX_IMAGE,
  memoryMb = SANDBOX_MEMORY_MB,
  cpuCores = SANDBOX_CPU_CORES,
  pidsLimit = SANDBOX_PIDS_LIMIT,
  user = SANDBOX_USER,
}) {
  return [
    'run',
    '--rm',
    '--network',
    'none',
    '--memory',
    `${memoryMb}m`,
    '--memory-swap',
    `${memoryMb}m`,
    '--cpus',
    `${cpuCores}`,
    '--pids-limit',
    `${pidsLimit}`,
    '--read-only',
    '--tmpfs',
    '/tmp:rw,size=256m',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--user',
    user,
    '--env',
    'CARGO_HOME=/build/cargo-home',
    '--env',
    'CARGO_TARGET_DIR=/build/target',
    '--env',
    'RUSTFLAGS=',
    '--env',
    'CARGO_TERM_COLOR=never',
    '--volume',
    `${workspaceDir}:/build`,
    '--workdir',
    '/build/crate',
    image,
    'cargo',
    'build',
    '--target',
    'wasm32-unknown-unknown',
    '--release',
  ];
}

// POSIX resource-limit wrapper used by the process-mode fallback so untrusted
// builds can still be capped when Docker is not available. Returns the argv
// for `spawn('sh', ['-c', <command>])`.
export function buildProcessLimitWrapper({
  memoryMb = SANDBOX_MEMORY_MB,
  cpuCores = SANDBOX_CPU_CORES,
} = {}) {
  const limits = [
    `ulimit -v ${memoryMb * 1024} 2>/dev/null`,
    `ulimit -t ${cpuCores * 30} 2>/dev/null`,
  ];
  return `${limits.join('; ')}; exec cargo build --target wasm32-unknown-unknown --release`;
}

function parseContainerId(output) {
  const match = String(output).match(/^([a-f0-9]{12,64})$/m);
  return match ? match[1] : null;
}

function killProcessTree(child, signal = 'SIGKILL') {
  if (!child || typeof child.pid !== 'number') return;
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } catch {
      /* best effort */
    }
    return;
  }
  try {
    // Negative pid targets the whole process group created via `detached`.
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      /* best effort */
    }
  }
}

async function runDockerCompile({
  workspaceDir,
  env,
  timeoutMs,
  memoryMb,
  cpuCores,
}) {
  const args = buildDockerArgs({ workspaceDir, memoryMb, cpuCores });

  return new Promise((resolve, reject) => {
    const child = trackChildProcess(
      spawn('docker', args, {
        env,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    );

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let containerId = null;
    let memoryPeakBytes = 0;

    const interval = setInterval(() => {
      memoryPeakBytes = Math.max(memoryPeakBytes, process.memoryUsage().rss);
    }, 500);

    const hardKill = () => {
      if (containerId) {
        try {
          const kill = spawn('docker', ['kill', containerId], {
            stdio: 'ignore',
            windowsHide: true,
          });
          kill.unref?.();
        } catch {
          /* best effort */
        }
      }
      killProcessTree(child, 'SIGKILL');
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child, 'SIGTERM');
      setTimeout(hardKill, KILL_GRACE_MS).unref?.();
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      containerId ||= parseContainerId(stdout);
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
      if (timedOut) {
        reject(new Error(`Compilation timed out after ${timeoutMs}ms`));
        return;
      }
      if (code !== 0) {
        reject(
          new Error(stderr || stdout || `docker run exited with code ${code}`)
        );
        return;
      }
      resolve({
        logs: (stdout + '\n' + stderr).split('\n').filter(Boolean),
        memoryPeakBytes,
      });
    });
  });
}

function runProcessCompile({
  crateRoot,
  env,
  timeoutMs,
  memoryMb,
  cpuCores,
  useLimitWrapper,
}) {
  const wrappedCommand = useLimitWrapper
    ? buildProcessLimitWrapper({ memoryMb, cpuCores })
    : null;

  const child = trackChildProcess(
    wrappedCommand
      ? spawn('sh', ['-c', wrappedCommand], {
          cwd: crateRoot,
          shell: false,
          windowsHide: true,
          detached: process.platform !== 'win32',
          env,
        })
      : spawn(
          'cargo',
          ['build', '--target', 'wasm32-unknown-unknown', '--release'],
          {
            cwd: crateRoot,
            shell: false,
            windowsHide: true,
            detached: process.platform !== 'win32',
            env,
          }
        )
  );

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let memoryPeakBytes = 0;

    const interval = setInterval(() => {
      memoryPeakBytes = Math.max(memoryPeakBytes, process.memoryUsage().rss);
    }, 500);

    const hardKill = () => killProcessTree(child, 'SIGKILL');

    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child, 'SIGTERM');
      setTimeout(hardKill, KILL_GRACE_MS).unref?.();
    }, timeoutMs);

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
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
      if (timedOut) {
        reject(new Error(`Compilation timed out after ${timeoutMs}ms`));
        return;
      }
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

/**
 * Runs `cargo build --target wasm32-unknown-unknown --release` inside the
 * chosen sandbox. Resolves `{ logs }` on success and rejects with the captured
 * output (or a timeout error) on failure.
 */
export async function runSandboxedCargoBuild({
  crateRoot,
  workspaceDir = crateRoot,
  env,
  timeoutMs = 30000,
  memoryMb = SANDBOX_MEMORY_MB,
  cpuCores = SANDBOX_CPU_CORES,
  mode,
  useLimitWrapper = process.platform !== 'win32',
}) {
  const resolvedMode = await resolveSandboxMode(mode);

  if (resolvedMode === 'docker') {
    return runDockerCompile({
      workspaceDir,
      env,
      timeoutMs,
      memoryMb,
      cpuCores,
    });
  }

  return runProcessCompile({
    crateRoot,
    env,
    timeoutMs,
    memoryMb,
    cpuCores,
    useLimitWrapper,
  });
}

export function getSandboxDefaults() {
  return {
    mode: SANDBOX_MODE,
    image: DOCKER_SANDBOX_IMAGE,
    memoryMb: SANDBOX_MEMORY_MB,
    cpuCores: SANDBOX_CPU_CORES,
    pidsLimit: SANDBOX_PIDS_LIMIT,
    user: SANDBOX_USER,
    timeoutMs: Number.parseInt(process.env.COMPILE_TIMEOUT_MS || '30000', 10),
    tempRoot: process.env.TMP_BUILD_DIR || os.tmpdir(),
    tempPrefix: process.env.COMPILE_TEMP_DIR_PREFIX || '.tmp_compile_',
  };
}
