// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import crypto from 'crypto';
import http from 'http';
import https from 'https';
import { getDatabase } from '../database/connection.js';
import {
  generateSignature,
  buildDeliveryHeaders,
  nextAttemptAt,
  MAX_ATTEMPTS,
  TIMEOUT_MS,
} from './webhookUtils.js';

export { generateSignature } from './webhookUtils.js';

function newId() {
  return crypto.randomBytes(12).toString('hex');
}

function postJson(url, body, headers) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return reject(new Error(`Invalid webhook URL: ${url}`));
    }

    const isHttps = parsed.protocol === 'https:';
    const client = isHttps ? https : http;
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...headers,
      },
    };

    const req = client.request(options, (res) => {
      let text = '';
      res.on('data', (chunk) => {
        text += chunk;
        if (text.length > 1000) res.destroy();
      });
      res.on('end', () =>
        resolve({ status: res.statusCode, body: text.slice(0, 1000) })
      );
    });

    req.setTimeout(TIMEOUT_MS, () =>
      req.destroy(new Error('Webhook request timed out'))
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Subscriptions ──────────────────────────────────────────────────────────────

export async function createSubscription({ url, events = [], secret }) {
  if (!url || !secret) throw new Error('url and secret are required');
  const db = getDatabase();
  const id = newId();
  const eventsJson = JSON.stringify(Array.isArray(events) ? events : [events]);
  await db.run(
    `INSERT INTO webhook_subscriptions (id, url, events, secret)
     VALUES (?, ?, ?, ?)`,
    [id, url, eventsJson, secret]
  );
  return db.get(
    'SELECT id, url, events, active, created_at FROM webhook_subscriptions WHERE id = ?',
    [id]
  );
}

export async function listSubscriptions() {
  const db = getDatabase();
  const rows = await db.all(
    'SELECT id, url, events, active, created_at FROM webhook_subscriptions ORDER BY created_at DESC'
  );
  return rows.map((r) => ({ ...r, events: JSON.parse(r.events) }));
}

export async function deleteSubscription(id) {
  const db = getDatabase();
  const { changes } = await db.run(
    'DELETE FROM webhook_subscriptions WHERE id = ?',
    [id]
  );
  return changes > 0;
}

// ── Dispatch ───────────────────────────────────────────────────────────────────

// Enqueue a delivery job for every active subscription that listens to eventType.
export async function enqueueEvent(eventType, payload) {
  const db = getDatabase();
  const subs = await db.all(
    `SELECT id, events FROM webhook_subscriptions WHERE active = 1`
  );

  const deliveryIds = [];
  for (const sub of subs) {
    const events = JSON.parse(sub.events);
    if (events.length && !events.includes(eventType) && !events.includes('*')) {
      continue;
    }
    const id = newId();
    await db.run(
      `INSERT INTO webhook_deliveries (id, subscription_id, event_type, payload, next_attempt_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [id, sub.id, eventType, JSON.stringify(payload)]
    );
    deliveryIds.push(id);
  }
  return deliveryIds;
}

// ── Background delivery ────────────────────────────────────────────────────────

export async function processPendingDeliveries() {
  const db = getDatabase();
  const due = await db.all(
    `SELECT d.id, d.subscription_id, d.event_type, d.payload, d.attempt,
            s.url, s.secret
     FROM webhook_deliveries d
     JOIN webhook_subscriptions s ON s.id = d.subscription_id
     WHERE d.status IN ('pending', 'retrying')
       AND d.next_attempt_at <= CURRENT_TIMESTAMP
     LIMIT 50`
  );

  for (const row of due) {
    const attempt = row.attempt + 1;
    const payload = row.payload;
    const headers = buildDeliveryHeaders(payload, row.secret, row.id);

    let result;
    try {
      result = await postJson(row.url, payload, headers);
    } catch (err) {
      result = { status: null, body: err.message };
    }

    const success = result.status >= 200 && result.status < 300;

    if (success) {
      await db.run(
        `UPDATE webhook_deliveries
         SET status = 'success', attempt = ?, response_status = ?,
             response_body = ?, delivered_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [attempt, result.status, result.body, row.id]
      );
    } else if (attempt >= MAX_ATTEMPTS) {
      await db.run(
        `UPDATE webhook_deliveries
         SET status = 'failed', attempt = ?, response_status = ?, response_body = ?
         WHERE id = ?`,
        [attempt, result.status, result.body, row.id]
      );
    } else {
      await db.run(
        `UPDATE webhook_deliveries
         SET status = 'retrying', attempt = ?, response_status = ?,
             response_body = ?, next_attempt_at = ?
         WHERE id = ?`,
        [attempt, result.status, result.body, nextAttemptAt(attempt), row.id]
      );
    }
  }

  return due.length;
}

// ── Delivery history ──────────────────────────────────────────────────────────

export async function listDeliveries(subscriptionId = null, limit = 50) {
  const db = getDatabase();
  const params = [];
  let where = '';
  if (subscriptionId) {
    where = 'WHERE d.subscription_id = ?';
    params.push(subscriptionId);
  }
  params.push(limit);
  return db.all(
    `SELECT d.id, d.subscription_id, d.event_type, d.status,
            d.attempt, d.response_status, d.delivered_at, d.created_at
     FROM webhook_deliveries d
     ${where}
     ORDER BY d.created_at DESC
     LIMIT ?`,
    params
  );
}
