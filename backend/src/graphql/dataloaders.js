// Per-request DataLoader instances (issue #724).
// Created fresh for each GraphQL request so caches never leak across requests.
// Each batch function maps to a single SQL query, so an N+1 fan-out collapses
// to 2 queries total (1 for the parent list + 1 batched IN-clause lookup).

import DataLoader from 'dataloader';
import { getCompileSnapshot } from '../services/compileService.js';
import { getDeploymentState } from '../services/deployService.js';
import { getProjectsByIds } from '../services/projectService.js';
import {
  getFilesByIds,
  getFilesByProjectIds,
  getFilesByTemplateIds,
} from '../services/fileService.js';
import { getTemplatesByIds } from '../services/templateService.js';

// ── Compile / deploy loaders (existing) ──────────────────────────────────────

function idKey(id) {
  return String(id);
}

function mapGetById(map, id, fallback) {
  return map.get(idKey(id)) ?? map.get(id) ?? fallback;
}

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
 * Reads deployment state once per batch and indexes by contractId.
 */
function createDeployHistoryLoader() {
  return new DataLoader(async (contractIds) => {
    let history = [];
    try {
      history = getDeploymentState()?.history ?? [];
    } catch {
      history = [];
    }
    const byId = new Map(history.map((item) => [item.contractId, item]));
    return contractIds.map((id) => byId.get(id) ?? null);
  });
}

// ── Project / file / template loaders (new — issue #724) ──────────────────────

/**
 * Batch-loads projects by id via `WHERE id IN (...)`.
 */
function createProjectLoader() {
  return new DataLoader(
    async (ids) => {
      const byId = await getProjectsByIds(ids);
      return ids.map((id) => mapGetById(byId, id, null));
    },
    { cacheKeyFn: idKey }
  );
}

/**
 * Batch-loads files by id via `WHERE id IN (...)`.
 */
function createFileLoader() {
  return new DataLoader(
    async (ids) => {
      const byId = await getFilesByIds(ids);
      return ids.map((id) => mapGetById(byId, id, null));
    },
    { cacheKeyFn: idKey }
  );
}

/**
 * Batch-loads templates by id via `WHERE id IN (...)`.
 */
function createTemplateLoader() {
  return new DataLoader(
    async (ids) => {
      const byId = await getTemplatesByIds(ids);
      return ids.map((id) => mapGetById(byId, id, null));
    },
    { cacheKeyFn: idKey }
  );
}

/**
 * Batch-loads `File[]` per project id. One SQL query for N parents.
 */
function createFilesByProjectLoader() {
  return new DataLoader(
    async (projectIds) => {
      const byProject = await getFilesByProjectIds(projectIds);
      return projectIds.map((id) => mapGetById(byProject, id, []));
    },
    { cacheKeyFn: idKey }
  );
}

/**
 * Batch-loads `File[]` per template id. One SQL query for N parents.
 */
function createFilesByTemplateLoader() {
  return new DataLoader(
    async (templateIds) => {
      const byTemplate = await getFilesByTemplateIds(templateIds);
      return templateIds.map((id) => mapGetById(byTemplate, id, []));
    },
    { cacheKeyFn: idKey }
  );
}

/**
 * Factory — call once per GraphQL request to get fresh loaders.
 * Per-request construction is what prevents stale data across queries.
 */
export function createLoaders() {
  return {
    compileArtifact: createCompileArtifactLoader(),
    compileHistory: createCompileHistoryLoader(),
    deployHistory: createDeployHistoryLoader(),
    project: createProjectLoader(),
    file: createFileLoader(),
    template: createTemplateLoader(),
    filesByProject: createFilesByProjectLoader(),
    filesByTemplate: createFilesByTemplateLoader(),
  };
}
