import { EventEmitter } from 'events';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { jest } from '@jest/globals';

jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

import { spawn } from 'child_process';
import {
  assertNoBuildScriptInWorkspace,
  buildDockerArgs,
  buildProcessLimitWrapper,
  getSandboxDefaults,
  resolveSandboxMode,
  resetSandboxStateForTests,
  sanitizeCargoTomlForSandbox,
} from '../src/services/compileSandbox.js';
import {
  assertSandboxedOutputPath,
  createBuildSandboxPaths,
  createSandboxEnv,
} from '../src/services/buildSandbox.js';
import { buildCargoToml } from '../src/routes/compile_utils.js';

function makeFakeChild() {
  const child = new EventEmitter();
  child.pid = 999;
  child.kill = jest.fn();
  child.unref = jest.fn();
  return child;
}

describe('compileSandbox', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetSandboxStateForTests();
  });

  describe('buildDockerArgs', () => {
    it('applies hard resource caps and disables networking', () => {
      const args = buildDockerArgs({
        workspaceDir: '/tmp/sandbox-1',
        memoryMb: 512,
        cpuCores: 2,
        pidsLimit: 256,
        user: '1000:1000',
      });

      const argString = args.join(' ');
      expect(argString).toContain('--network none');
      expect(argString).toContain('--memory 512m');
      expect(argString).toContain('--memory-swap 512m');
      expect(argString).toContain('--cpus 2');
      expect(argString).toContain('--pids-limit 256');
      expect(argString).toContain('--cap-drop ALL');
      expect(argString).toContain('--security-opt no-new-privileges');
      expect(argString).toContain('--read-only');
      expect(argString).toContain('--user 1000:1000');
      expect(argString).toContain('--volume /tmp/sandbox-1:/build');
      expect(argString).toContain(
        'cargo build --target wasm32-unknown-unknown --release'
      );
    });

    it('runs as a non-root user by default', () => {
      const args = buildDockerArgs({ workspaceDir: '/tmp/sandbox-2' });
      const argString = args.join(' ');
      expect(argString).toContain('--user 1000:1000');
      expect(argString).not.toContain('--user 0:0');
    });
  });

  describe('buildProcessLimitWrapper', () => {
    it('caps address space and CPU time for the fallback path', () => {
      const command = buildProcessLimitWrapper({ memoryMb: 512, cpuCores: 2 });
      expect(command).toContain('ulimit -v 524288');
      expect(command).toContain('ulimit -t 60');
      expect(command).toContain(
        'exec cargo build --target wasm32-unknown-unknown --release'
      );
    });
  });

  describe('resolveSandboxMode', () => {
    it('honors an explicit docker mode', async () => {
      await expect(resolveSandboxMode('docker')).resolves.toBe('docker');
    });

    it('honors an explicit process mode', async () => {
      await expect(resolveSandboxMode('process')).resolves.toBe('process');
    });

    it('resolves to docker when the docker daemon is reachable', async () => {
      const child = makeFakeChild();
      spawn.mockReturnValue(child);
      const result = resolveSandboxMode('auto');
      child.emit('close', 0);
      await expect(result).resolves.toBe('docker');
    });

    it('falls back to process mode when docker is unavailable', async () => {
      const child = makeFakeChild();
      spawn.mockReturnValue(child);
      const result = resolveSandboxMode('auto');
      child.emit('error', new Error('ENOENT'));
      await expect(result).resolves.toBe('process');
    });
  });

  describe('security and sandbox escape prevention', () => {
    it('enforces default 512MB RAM, 1 vCPU, 30s timeout, and offline network isolation', () => {
      const defaults = getSandboxDefaults();
      expect(defaults.memoryMb).toBe(512);
      expect(defaults.cpuCores).toBe(1);
      expect(defaults.timeoutMs).toBe(30000);

      const args = buildDockerArgs({ workspaceDir: '/tmp/sandbox-sec' });
      const argString = args.join(' ');
      expect(argString).toContain('--rm');
      expect(argString).toContain('--network none');
      expect(argString).toContain('--memory 512m');
      expect(argString).toContain('--memory-swap 512m');
      expect(argString).toContain('--cpus 1');
      expect(argString).toContain('--env CARGO_NET_OFFLINE=true');
      expect(argString).toContain('--env CARGO_BUILD_JOBS=1');
      expect(argString).toContain(
        'cargo build --target wasm32-unknown-unknown --release --offline'
      );
    });

    it('disables network access in process fallback wrapper', () => {
      const command = buildProcessLimitWrapper();
      expect(command).toContain('ulimit -v 524288');
      expect(command).toContain('ulimit -t 30');
      expect(command).toContain('--offline');
    });

    it('disables build.rs in generated Cargo.toml', () => {
      const toml = buildCargoToml({});
      expect(toml).toMatch(/^\s*build\s*=\s*false\s*$/m);
    });

    it('rejects Cargo.toml with custom build scripts or build-dependencies', () => {
      expect(() =>
        sanitizeCargoTomlForSandbox(
          '[package]\nname = "evil"\nbuild = "build.rs"\n'
        )
      ).toThrow(/build scripts/i);

      expect(() =>
        sanitizeCargoTomlForSandbox('[package]\nname = "evil"\nbuild = true\n')
      ).toThrow(/build scripts/i);

      expect(() =>
        sanitizeCargoTomlForSandbox(
          '[package]\nname = "evil"\n\n[build-dependencies]\ncc = "1.0"\n'
        )
      ).toThrow(/build-dependencies/i);
    });

    it('injects build = false when omitted from Cargo.toml', () => {
      const sanitized = sanitizeCargoTomlForSandbox(
        '[package]\nname = "safe"\nversion = "0.1.0"\n'
      );
      expect(sanitized).toMatch(/^\s*build\s*=\s*false\s*$/m);
    });

    it('rejects workspaces containing a build.rs file', async () => {
      const tmpDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'sandbox-sec-test-')
      );
      try {
        await expect(
          assertNoBuildScriptInWorkspace(tmpDir)
        ).resolves.toBeUndefined();

        await fs.writeFile(
          path.join(tmpDir, 'build.rs'),
          'fn main() { std::process::Command::new("id").status().unwrap(); }',
          'utf8'
        );
        await expect(assertNoBuildScriptInWorkspace(tmpDir)).rejects.toThrow(
          /build\.rs is forbidden/i
        );
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });

    it('strips dangerous override env vars and enforces offline mode', () => {
      const sandboxPaths = createBuildSandboxPaths('/tmp/sandbox-env');
      const env = createSandboxEnv(
        {
          PATH: '/usr/bin',
          LD_PRELOAD: '/tmp/evil.so',
          RUSTC_WRAPPER: '/tmp/evil-wrapper',
          RUSTFLAGS: '-C linker=/tmp/evil',
          CARGO_NET_OFFLINE: 'false',
        },
        sandboxPaths
      );

      expect(env.LD_PRELOAD).toBeUndefined();
      expect(env.RUSTC_WRAPPER).toBeUndefined();
      expect(env.RUSTFLAGS).toBeUndefined();
      expect(env.CARGO_NET_OFFLINE).toBe('true');
      expect(env.CARGO_BUILD_JOBS).toBe('1');
    });

    it('blocks build output path traversal outside sandbox target dir', () => {
      const sandboxPaths = createBuildSandboxPaths('/tmp/sandbox-path');
      expect(() =>
        assertSandboxedOutputPath(
          sandboxPaths,
          path.join(sandboxPaths.cargoTargetDir, '..', '..', 'etc', 'passwd')
        )
      ).toThrow(/escaped compile sandbox/i);
    });
  });
});
