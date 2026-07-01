import { spawn } from 'child_process';

const DEFAULT_KILL_GRACE_MS = Number.parseInt(
  process.env.CHILD_KILL_GRACE_MS || '2000',
  10
);

const trackedChildren = new Map();
const shutdownHandlers = new Map();

function isRunning(child) {
  return child && child.exitCode === null && !child.killed;
}

function untrackChild(child) {
  if (!child) return;
  trackedChildren.delete(child.pid);
}

function ensureShutdownHooks() {
  if (shutdownHandlers.size > 0) return;

  const handler = () => {
    for (const child of trackedChildren.values()) {
      try {
        if (isRunning(child)) {
          child.kill('SIGTERM');
        }
      } catch {
        /* best effort */
      }
    }
  };

  const signals = ['SIGINT', 'SIGTERM', 'beforeExit', 'exit'];
  for (const signal of signals) {
    process.on(signal, handler);
    shutdownHandlers.set(signal, handler);
  }
}

function attachLifecycleCleanup(child) {
  const cleanup = () => untrackChild(child);
  child.once('close', cleanup);
  child.once('exit', cleanup);
  child.once('error', cleanup);
}

export function trackChildProcess(child) {
  if (!child || typeof child.pid !== 'number') return child;
  ensureShutdownHooks();
  trackedChildren.set(child.pid, child);
  attachLifecycleCleanup(child);
  return child;
}

export function spawnTracked(command, args, options) {
  return trackChildProcess(spawn(command, args, options));
}

export function terminateChildProcess(
  child,
  { graceMs = DEFAULT_KILL_GRACE_MS } = {}
) {
  if (!child || !isRunning(child)) return;

  try {
    child.kill('SIGTERM');
  } catch {
    return;
  }

  const timer = setTimeout(() => {
    if (isRunning(child)) {
      try {
        child.kill('SIGKILL');
      } catch {
        /* best effort */
      }
    }
  }, graceMs);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }
}

export function terminateTrackedChildren() {
  for (const child of trackedChildren.values()) {
    terminateChildProcess(child);
  }
}

export function getTrackedChildProcessCount() {
  return trackedChildren.size;
}

export function resetChildProcessManagerForTests() {
  for (const [signal, handler] of shutdownHandlers.entries()) {
    process.off(signal, handler);
  }
  shutdownHandlers.clear();
  trackedChildren.clear();
}
