// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

const DEFAULT_API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, '') ||
  'http://localhost:5000';

export type FileMetadata = {
  owner: string;
  file_id: string;
  total_size: number;
  shard_count: number;
  redundancy_factor: number;
  shards: ShardInfo[];
  created_at: number;
  is_paused: boolean;
};

export type ShardInfo = {
  shard_index: number;
  shard_hash: string;
  nodes: string[];
  size_bytes: number;
};

export type CloudStorageHealth = {
  status: 'ok';
  contractId: string;
  network: string;
};

export type ApiError = {
  message: string;
  details?: any;
};

/**
 * Generic fetch wrapper for Cloud Storage API.
 */
async function cloudStorageFetch(path: string, options: RequestInit = {}) {
  const url = `${DEFAULT_API_BASE}/api/cloud-storage${path}`;
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  if (!res.ok) {
    let error: ApiError;
    try {
      const body = await res.json();
      error = { message: body.message || 'Request failed', details: body.details };
    } catch {
      error = { message: res.statusText || 'Request failed' };
    }
    throw error;
  }

  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Upload a file.
 */
export async function uploadFile(params: {
  fileId: string;
  totalSize: number;
  shardHashes: string[];
  redundancyFactor: number;
  owner?: string;
  sourceAccount?: string;
  network?: string;
}) {
  const body: any = {
    fileId: params.fileId,
    totalSize: params.totalSize,
    shardHashes: params.shardHashes,
    redundancyFactor: params.redundancyFactor,
  };
  if (params.owner) body.owner = params.owner;

  const headers: Record<string, string> = {};
  if (params.sourceAccount) headers['x-source-account'] = params.sourceAccount;
  if (params.network) headers['x-network'] = params.network;

  const result = await cloudStorageFetch('/files', {
    method: 'POST',
    body: JSON.stringify(body),
    headers,
  });
  return result?.data;
}

/**
 * Get file metadata by file ID.
 */
export async function getFile(params: { fileId: string; sourceAccount?: string; network?: string }) {
  const headers: Record<string, string> = {};
  if (params.sourceAccount) headers['x-source-account'] = params.sourceAccount;
  if (params.network) headers['x-network'] = params.network;

  const result = await cloudStorageFetch(`/files/${encodeURIComponent(params.fileId)}`, {
    headers,
  });
  return result?.data;
}

/**
 * Delete a file.
 */
export async function deleteFile(params: {
  fileId: string;
  caller: string;
  sourceAccount?: string;
  network?: string;
}) {
  const headers: Record<string, string> = {
    'x-caller-address': params.caller,
  };
  if (params.sourceAccount) headers['x-source-account'] = params.sourceAccount;
  if (params.network) headers['x-network'] = params.network;

  const result = await cloudStorageFetch(`/files/${encodeURIComponent(params.fileId)}`, {
    method: 'DELETE',
    headers,
  });
  return result;
}

/**
 * Register a storage node.
 */
export async function registerNode(params: {
  nodeAddress: string;
  capacityBytes: number;
  sourceAccount?: string;
  network?: string;
}) {
  const headers: Record<string, string> = {};
  if (params.network) headers['x-network'] = params.network;

  const body = {
    nodeAddress: params.nodeAddress,
    capacityBytes: params.capacityBytes,
  };

  // source account can be the node address itself (the node authenticates)
  // but we may not need to set header if node is invoker; the CLI expects source account from header.
  if (params.sourceAccount) headers['x-source-account'] = params.sourceAccount;

  const result = await cloudStorageFetch('/nodes', {
    method: 'POST',
    body: JSON.stringify(body),
    headers,
  });
  return result;
}

/**
 * Get list of file IDs stored on a node.
 */
export async function getNodeFiles(params: {
  nodeAddress: string;
  sourceAccount?: string;
  network?: string;
}) {
  const headers: Record<string, string> = {};
  if (params.sourceAccount) headers['x-source-account'] = params.sourceAccount;
  if (params.network) headers['x-network'] = params.network;

  const result = await cloudStorageFetch(`/nodes/${encodeURIComponent(params.nodeAddress)}/files`, {
    headers,
  });
  return result?.data;
}

/**
 * Rebalance shards for a file.
 */
export async function rebalanceShards(params: {
  fileId: string;
  caller: string;
  sourceAccount?: string;
  network?: string;
}) {
  const headers: Record<string, string> = {
    'x-caller-address': params.caller,
  };
  if (params.sourceAccount) headers['x-source-account'] = params.sourceAccount;
  if (params.network) headers['x-network'] = params.network;

  const result = await cloudStorageFetch(`/files/${encodeURIComponent(params.fileId)}/rebalance`, {
    method: 'POST',
    headers,
  });
  return result;
}

/**
 * Health check.
 */
export async function health(params: { contractId?: string } = {}) {
  const result = await cloudStorageFetch('/health');
  return result as CloudStorageHealth;
}
