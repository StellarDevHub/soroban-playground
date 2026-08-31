import { EventEmitter } from 'events';
import { jest } from '@jest/globals';

jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

import { spawn } from 'child_process';
import {
  buildDockerArgs,
  buildProcessLimitWrapper,
  resolveSandboxMode,
  resetSandboxStateForTests,
} from '../src/services/compileSandbox.js';

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
});
