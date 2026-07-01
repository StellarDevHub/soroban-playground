import { EventEmitter } from 'events';
import { jest } from '@jest/globals';
import {
  getTrackedChildProcessCount,
  resetChildProcessManagerForTests,
  terminateChildProcess,
  trackChildProcess,
} from '../src/services/childProcessManager.js';

function makeFakeChild(pid, onKill) {
  const child = new EventEmitter();
  child.pid = pid;
  child.exitCode = null;
  child.killed = false;
  child.kill = jest.fn((signal) => {
    onKill?.(child, signal);
    return true;
  });
  return child;
}

describe('childProcessManager', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetChildProcessManagerForTests();
  });

  afterEach(() => {
    jest.useRealTimers();
    resetChildProcessManagerForTests();
  });

  it('tracks child processes and untracks them on close', () => {
    const child = makeFakeChild(1111);
    trackChildProcess(child);

    expect(getTrackedChildProcessCount()).toBe(1);
    child.emit('close', 0);
    expect(getTrackedChildProcessCount()).toBe(0);
  });

  it('escalates SIGTERM to SIGKILL for stuck process', () => {
    const child = makeFakeChild(2222, (proc, signal) => {
      if (signal === 'SIGKILL') {
        proc.killed = true;
        proc.exitCode = 137;
      }
    });

    terminateChildProcess(child, { graceMs: 100 });

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(child.kill).not.toHaveBeenCalledWith('SIGKILL');

    jest.advanceTimersByTime(120);

    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('does not SIGKILL if process exits after SIGTERM', () => {
    const child = makeFakeChild(3333, (proc, signal) => {
      if (signal === 'SIGTERM') {
        proc.exitCode = 0;
      }
    });

    terminateChildProcess(child, { graceMs: 100 });
    jest.advanceTimersByTime(120);

    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });
});
