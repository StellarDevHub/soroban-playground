// DataLoader instances — created per-request to avoid cross-request cache pollution.
// Batches lookups for compile artifacts and deploy history to prevent N+1 queries.

import DataLoader from 'dataloader';
import { getCompileSnapshot } from '../services/compileService.js';

/**
 * Batch-loads compile artifacts by hash.
 * Fetches the full snapshot once and resolves all requested hashes from it.
 */
function createCompileArtifactLoader() {
  return new DataLoader(async (hashes) => {
    const snapshot = await getCompileSnapshot();
    const artifactList = snapshot?.artifacts ?? [];
    const byHash = new Map(artifactList.map((a) => [a.hash, a]));
    return hashes.map((h) => byHash.get(h) ?? null);
  });
}

/**
 * Batch-loads compile history items by id.
 * Fetches the full snapshot once and resolves all requested ids from it.
 */
function createCompileHistoryLoader() {
  return new DataLoader(async (ids) => {
    const snapshot = await getCompileSnapshot();
    const history = snapshot?.history ?? [];
    const byId = new Map(history.map((item) => [item.id ?? item.hash, item]));
    return ids.map((id) => byId.get(id) ?? null);
  });
}

/**
 * Batch-loads deploy history items by contractId.
 * Reads the deployments state file once per batch.
 */
function createDeployHistoryLoader() {
  return new DataLoader(async (contractIds) => {
    let history = [];
    try {
      const { readDeployHistory } =
        await import('../services/deployService.js');
      history = (await readDeployHistory()) ?? [];
    } catch {
      // deployService may not export readDeployHistory — graceful fallback
    }
    const byId = new Map(history.map((item) => [item.contractId, item]));
    return contractIds.map((id) => byId.get(id) ?? null);
  });
}

/**
 * Factory — call once per GraphQL request to get fresh loaders.
 */
export function createLoaders() {
  return {
    compileArtifact: createCompileArtifactLoader(),
    compileHistory: createCompileHistoryLoader(),
    deployHistory: createDeployHistoryLoader(),
  };
}
