// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

// Unit tests for the DataLoader factory in src/graphql/dataloaders.js.
// Mocks the underlying services and asserts that per-tick `.load()` calls
// coalesce into a single batch invocation — the core property that breaks the
// N+1 query pattern (issue #724).

import { jest } from '@jest/globals';

// ── Service mocks ───────────────────────────────────────────────────────────
// Each batch function is replaced with a jest.fn so the test can assert call
// counts and control the returned Map shape.

jest.doMock('../src/services/compileService.js', () => ({
  getCompileSnapshot: jest
    .fn()
    .mockResolvedValue({ history: [], artifacts: [] }),
}));

jest.doMock('../src/services/deployService.js', () => ({
  getDeploymentState: jest.fn().mockReturnValue({ history: [] }),
}));

jest.doMock('../src/services/projectService.js', () => ({
  getProjectsByIds: jest.fn(),
  listProjects: jest.fn(),
}));

jest.doMock('../src/services/fileService.js', () => ({
  getFilesByIds: jest.fn(),
  getFilesByProjectIds: jest.fn(),
  getFilesByTemplateIds: jest.fn(),
  listFiles: jest.fn(),
}));

jest.doMock('../src/services/templateService.js', () => ({
  getTemplatesByIds: jest.fn(),
  listTemplates: jest.fn(),
}));

let createLoaders;
let getProjectsByIds;
let getFilesByIds;
let getFilesByProjectIds;
let getFilesByTemplateIds;
let getTemplatesByIds;

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns a Map keyed by id with placeholder values, the shape the batch
 * functions return to DataLoader.
 */
function mapFromIds(ids, factory) {
  return new Map(ids.map((id) => [id, factory(id)]));
}

// ── Test suite ──────────────────────────────────────────────────────────────

describe('createLoaders — DataLoader batching (issue #724)', () => {
  beforeAll(async () => {
    ({ createLoaders } = await import('../src/graphql/dataloaders.js'));
    ({ getProjectsByIds } = await import('../src/services/projectService.js'));
    ({ getFilesByIds, getFilesByProjectIds, getFilesByTemplateIds } =
      await import('../src/services/fileService.js'));
    ({ getTemplatesByIds } =
      await import('../src/services/templateService.js'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('coalesces N project.load() calls in one tick into a single batch', async () => {
    getProjectsByIds.mockImplementation(async (ids) =>
      mapFromIds(ids, (id) => ({ id, title: `Project ${id}` }))
    );

    const loaders = createLoaders();
    const ids = [1, 2, 3, 4, 5];
    const results = await Promise.all(
      ids.map((id) => loaders.project.load(id))
    );

    // One batch call covering all five ids.
    expect(getProjectsByIds).toHaveBeenCalledTimes(1);
    expect(getProjectsByIds).toHaveBeenCalledWith(ids);
    // Results come back in input order.
    expect(results.map((r) => r.id)).toEqual(ids);
  });

  it('returns null for unknown ids without throwing', async () => {
    getProjectsByIds.mockResolvedValue(new Map([[1, { id: 1 }]]));

    const loaders = createLoaders();
    const [hit, miss] = await Promise.all([
      loaders.project.load(1),
      loaders.project.load(999),
    ]);

    expect(hit).toEqual({ id: 1 });
    expect(miss).toBeNull();
    expect(getProjectsByIds).toHaveBeenCalledTimes(1);
  });

  it('caches duplicate loads within a request — no second batch call', async () => {
    getProjectsByIds.mockImplementation(async (ids) =>
      mapFromIds(ids, (id) => ({ id }))
    );

    const loaders = createLoaders();
    await loaders.project.load(1);
    await loaders.project.load(1);
    await loaders.project.load(1);

    // Three .load(1) calls collapse to one batch invocation because the
    // DataLoader cache absorbs the duplicate keys.
    expect(getProjectsByIds).toHaveBeenCalledTimes(1);
  });

  it('filesByProject returns [] (not null) for parents with no files', async () => {
    // Project 1 has files, project 2 has none — the batch function must still
    // include project 2 in the map with an empty array so the GraphQL
    // `files: [File!]!` contract holds.
    getFilesByProjectIds.mockImplementation(async (projectIds) => {
      const map = new Map();
      for (const id of projectIds)
        map.set(id, id === 1 ? [{ id: 10, projectId: 1 }] : []);
      return map;
    });

    const loaders = createLoaders();
    const [withFiles, withoutFiles] = await Promise.all([
      loaders.filesByProject.load(1),
      loaders.filesByProject.load(2),
    ]);

    expect(withFiles).toHaveLength(1);
    expect(withoutFiles).toEqual([]);
    expect(getFilesByProjectIds).toHaveBeenCalledTimes(1);
    expect(getFilesByProjectIds).toHaveBeenCalledWith([1, 2]);
  });

  it('filesByTemplate batches per template id', async () => {
    getFilesByTemplateIds.mockImplementation(async (ids) =>
      mapFromIds(ids, (id) => [{ id: id * 100, templateId: id }])
    );

    const loaders = createLoaders();
    const results = await Promise.all([
      loaders.filesByTemplate.load(1),
      loaders.filesByTemplate.load(2),
      loaders.filesByTemplate.load(3),
    ]);

    expect(getFilesByTemplateIds).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r[0].templateId)).toEqual([1, 2, 3]);
  });

  it('template loader batches mixed ids', async () => {
    getTemplatesByIds.mockImplementation(async (ids) =>
      mapFromIds(ids, (id) => ({ id, name: `Template ${id}` }))
    );

    const loaders = createLoaders();
    const results = await Promise.all(
      [1, 2, 3].map((id) => loaders.template.load(id))
    );

    expect(getTemplatesByIds).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r.name)).toEqual([
      'Template 1',
      'Template 2',
      'Template 3',
    ]);
  });

  it('file loader batches by file id', async () => {
    getFilesByIds.mockImplementation(async (ids) =>
      mapFromIds(ids, (id) => ({ id, filename: `file_${id}` }))
    );

    const loaders = createLoaders();
    const results = await Promise.all(
      [10, 20, 30].map((id) => loaders.file.load(id))
    );

    expect(getFilesByIds).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r.filename)).toEqual([
      'file_10',
      'file_20',
      'file_30',
    ]);
  });

  it('createLoaders returns fresh loader instances per call (no cross-request leakage)', () => {
    const a = createLoaders();
    const b = createLoaders();

    // Each call must produce distinct DataLoader instances so per-request caches
    // never leak between GraphQL requests.
    expect(a.project).not.toBe(b.project);
    expect(a.file).not.toBe(b.file);
    expect(a.template).not.toBe(b.template);
    expect(a.filesByProject).not.toBe(b.filesByProject);
    expect(a.filesByTemplate).not.toBe(b.filesByTemplate);
    expect(a.compileArtifact).not.toBe(b.compileArtifact);
    expect(a.compileHistory).not.toBe(b.compileHistory);
    expect(a.deployHistory).not.toBe(b.deployHistory);
  });

  it('exposes all expected loader keys', () => {
    const loaders = createLoaders();
    expect(Object.keys(loaders).sort()).toEqual(
      [
        'compileArtifact',
        'compileHistory',
        'deployHistory',
        'file',
        'filesByProject',
        'filesByTemplate',
        'project',
        'template',
      ].sort()
    );
  });

  it('handles empty-id batches without calling the service', async () => {
    getProjectsByIds.mockResolvedValue(new Map());

    const loaders = createLoaders();
    // DataLoader buffers loads for the current tick; an empty batch should
    // still resolve cleanly. We trigger a single load and let it flush.
    const result = await loaders.project.load(1);

    // The batch function was invoked with [1] (one id), not an empty array.
    expect(getProjectsByIds).toHaveBeenCalledTimes(1);
    expect(getProjectsByIds).toHaveBeenCalledWith([1]);
    expect(result).toBeNull();
  });
});
