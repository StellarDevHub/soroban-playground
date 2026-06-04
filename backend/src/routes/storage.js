// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import express from 'express';
import { spawn } from 'child_process';

const router = express.Router();

const CONTRACT_ID_RE = /^C[A-Z2-7]{55}$/;
const NETWORK_RE = /^(testnet|mainnet|futurenet|standalone)$/;

function validateContractId(id) {
  return typeof id === 'string' && CONTRACT_ID_RE.test(id);
}

/**
 * Runs `stellar contract read` and returns parsed storage entries.
 */
function readContractStorage(contractId, network = 'testnet') {
  return new Promise((resolve, reject) => {
    const args = [
      'contract',
      'read',
      '--id',
      contractId,
      '--network',
      network,
      '--output',
      'json',
    ];

    const child = spawn('stellar', args, {
      timeout: 30000,
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    child.on('error', (err) => reject(new Error(`stellar CLI error: ${err.message}`)));

    child.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(stderr.trim() || `stellar exited with code ${code}`));
      }
      try {
        // stellar contract read --output json returns one JSON object per line
        const entries = stdout
          .split('\n')
          .filter((line) => line.trim())
          .map((line) => JSON.parse(line));
        resolve(entries);
      } catch {
        reject(new Error(`Failed to parse stellar output: ${stdout.slice(0, 200)}`));
      }
    });
  });
}

/**
 * Detect the data type of a parsed SCVal value.
 */
function detectType(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return 'bool';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string') {
    if (/^G[A-Z2-7]{55}$/.test(value) || /^C[A-Z2-7]{55}$/.test(value)) return 'address';
    if (/^[0-9a-fA-F]+$/.test(value) && value.length % 2 === 0) return 'bytes';
    if (/^-?\d+$/.test(value)) return 'integer';
    return 'string';
  }
  if (Array.isArray(value)) return 'vec';
  if (typeof value === 'object') {
    if ('type' in value) return value.type;
    return 'map';
  }
  return 'unknown';
}

/**
 * Flatten SCVal entries from stellar contract read output.
 * Each entry has { key, value } where both are SCVal objects.
 */
function flattenEntries(rawEntries) {
  return rawEntries.map((entry, index) => {
    const key = entry.key ?? entry.Key ?? entry[0];
    const value = entry.value ?? entry.Value ?? entry[1];
    const keyStr = typeof key === 'string' ? key : JSON.stringify(key);
    return {
      id: index,
      key: keyStr,
      keyRaw: key,
      value,
      type: detectType(value),
    };
  });
}

// GET /api/storage/entries?contractId=C...&network=testnet
router.get('/entries', async (req, res) => {
  const { contractId, network = 'testnet' } = req.query;

  if (!validateContractId(contractId)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid contractId. Must be a valid Stellar contract address (C...).',
    });
  }

  if (!NETWORK_RE.test(network)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid network. Must be one of: testnet, mainnet, futurenet, standalone.',
    });
  }

  try {
    const raw = await readContractStorage(contractId, network);
    const entries = flattenEntries(raw);
    return res.json({ success: true, data: { contractId, network, entries, count: entries.length } });
  } catch (err) {
    const message = err.message ?? 'Unknown error reading contract storage';
    // Distinguish "contract not found" vs other errors
    const status = message.includes('not found') || message.includes('does not exist') ? 404 : 500;
    return res.status(status).json({ success: false, error: message });
  }
});

export default router;
