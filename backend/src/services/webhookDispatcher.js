// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import { processPendingDeliveries } from './webhookService.js';

const POLL_INTERVAL_MS = 5_000;

let timer = null;

async function tick() {
  try {
    await processPendingDeliveries();
  } catch {
    // best-effort; individual delivery errors are tracked in the DB
  }
}

export function startWebhookDispatcher() {
  if (timer) return;
  timer = setInterval(tick, POLL_INTERVAL_MS);
  if (timer.unref) timer.unref();
}

export function stopWebhookDispatcher() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
