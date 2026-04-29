// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { LRUCache } from 'lru-cache';

const ZERO_ROOT = '0'.repeat(64);
const CACHE_KEY = 'airdrop-snapshot';
const cache = new LRUCache({ max: 2, ttl: 60 * 1000 });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_PATH = path.join(__dirname, '..', 'data', 'airdrop.json');

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hashLeaf(address, amount) {
  return sha256(`${address}:${amount}`);
}

function hashPair(left, right) {
  const leftBytes = Buffer.from(left, 'hex');
  const rightBytes = Buffer.from(right, 'hex');
  return sha256(Buffer.concat([leftBytes, rightBytes]));
}

function buildLayers(leaves) {
  if (leaves.length === 0) {
    return [[ZERO_ROOT]];
  }

  const layers = [leaves];
  while (layers[layers.length - 1].length > 1) {
    const prev = layers[layers.length - 1];
    const next = [];
    for (let i = 0; i < prev.length; i += 2) {
      const left = prev[i];
      const right = i + 1 < prev.length ? prev[i + 1] : prev[i];
      next.push(hashPair(left, right));
    }
    layers.push(next);
  }
  return layers;
}

function buildProof(layers, index) {
  const proof = [];
  let idx = index;
  for (let level = 0; level < layers.length - 1; level += 1) {
    const layer = layers[level];
    const isRight = idx % 2 === 1;
    const siblingIdx = isRight ? idx - 1 : idx + 1;
    const sibling = siblingIdx < layer.length ? layer[siblingIdx] : layer[idx];
    proof.push({ hash: sibling, is_left: isRight });
    idx = Math.floor(idx / 2);
  }
  return proof;
}

function readDistributionFile() {
  const raw = fs.readFileSync(DATA_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || !Array.isArray(parsed.distribution)) {
    throw new Error('airdrop.json must include a distribution array');
  }
  return parsed;
}

function loadSnapshot() {
  const stats = fs.statSync(DATA_PATH);
  const cached = cache.get(CACHE_KEY);
  if (cached && cached.mtimeMs === stats.mtimeMs) {
    return cached;
  }

  const data = readDistributionFile();
  const allocations = data.distribution.map((entry) => ({
    address: entry.address,
    amount: BigInt(entry.amount).toString(),
  }));

  const leaves = allocations.map((entry) =>
    hashLeaf(entry.address, entry.amount)
  );
  const layers = buildLayers(leaves);
  const root = layers[layers.length - 1][0] || ZERO_ROOT;

  const allocationMap = new Map();
  allocations.forEach((entry, index) => {
    allocationMap.set(entry.address, {
      amount: entry.amount,
      leaf: leaves[index],
      proof: buildProof(layers, index),
    });
  });

  const totalAmount = allocations.reduce(
    (sum, entry) => sum + BigInt(entry.amount),
    0n
  );

  const topAllocations = [...allocations]
    .sort((a, b) => {
      const left = BigInt(a.amount);
      const right = BigInt(b.amount);
      if (right > left) return 1;
      if (right < left) return -1;
      return 0;
    })
    .slice(0, 5);

  const snapshot = {
    root,
    token: data.token || null,
    count: allocations.length,
    totalAmount: totalAmount.toString(),
    topAllocations,
    updatedAt: new Date().toISOString(),
  };

  const payload = {
    snapshot,
    allocationMap,
    mtimeMs: stats.mtimeMs,
  };
  cache.set(CACHE_KEY, payload);
  return payload;
}

export function getAirdropSnapshot() {
  return loadSnapshot().snapshot;
}

export function getEligibility(address) {
  const { snapshot, allocationMap } = loadSnapshot();
  const entry = allocationMap.get(address);
  if (!entry) {
    return {
      eligible: false,
      root: snapshot.root,
      token: snapshot.token,
    };
  }

  return {
    eligible: true,
    address,
    amount: entry.amount,
    leaf: entry.leaf,
    proof: entry.proof,
    root: snapshot.root,
    token: snapshot.token,
  };
}

export function verifyEligibility({ address, amount, proof }) {
  const { snapshot } = loadSnapshot();
  const leaf = hashLeaf(address, amount);
  let current = leaf;
  for (const node of proof || []) {
    const isLeft = node.is_left === true || node.isLeft === true;
    current = isLeft ? hashPair(node.hash, current) : hashPair(current, node.hash);
  }
  return {
    valid: current === snapshot.root,
    leaf,
    root: snapshot.root,
  };
}
