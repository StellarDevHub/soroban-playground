// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import { monitorEventLoopDelay } from 'perf_hooks';
import { logger } from '../middleware/logger.js'; // assume logger exists, if not fallback to console

let monitor;

export function startWatchdog(thresholdMs = 200) {
  if (monitor) return; // already started
  try {
    monitor = monitorEventLoopDelay({ resolution: 20 });
    monitor.enable();
    setInterval(() => {
      const delay = monitor.mean / 1e6; // convert ns to ms
      if (delay > thresholdMs) {
        const msg = `Event loop lag detected: ${delay.toFixed(2)}ms (threshold ${thresholdMs}ms)`;
        if (logger && logger.warn) logger.warn(msg);
        else console.warn(msg);
      }
    }, 5000);
  } catch (e) {
    console.error('Watchdog could not start:', e.message);
  }
}

export function stopWatchdog() {
  if (monitor) {
    monitor.disable();
    monitor = null;
  }
}
