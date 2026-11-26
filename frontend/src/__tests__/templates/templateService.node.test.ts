/**
 * Node-runnable test suite for Template Library Service, Safe Forking & Workspace Isolation.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterTemplates,
  forkTemplate,
  createWorkspaceBackup,
  generateMockMetadata,
} from '../../services/templateService.ts';

test('Template Service: Category Filtering and Discovery', async (t) => {
  const metadata = generateMockMetadata();

  await t.test('filters templates by DeFi, Gaming, RWA, and Identity categories', () => {
    const defiTemplates = filterTemplates(metadata, '', ['DeFi'], [], [], [], []);
    assert.ok(defiTemplates.length >= 1);
    assert.equal(defiTemplates[0].category, 'DeFi');

    const gamingTemplates = filterTemplates(metadata, '', ['Gaming'], [], [], [], []);
    assert.ok(gamingTemplates.length >= 1);
    assert.equal(gamingTemplates[0].category, 'Gaming');

    const rwaTemplates = filterTemplates(metadata, '', ['RWA'], [], [], [], []);
    assert.ok(rwaTemplates.length >= 1);
    assert.equal(rwaTemplates[0].category, 'RWA');

    const identityTemplates = filterTemplates(metadata, '', ['Identity'], [], [], [], []);
    assert.ok(identityTemplates.length >= 1);
    assert.equal(identityTemplates[0].category, 'Identity');
  });

  await t.test('supports search query filtering by name or description', () => {
    const searchResults = filterTemplates(metadata, 'gaming', [], [], [], [], []);
    assert.ok(searchResults.length >= 1);
    assert.ok(
      searchResults[0].name.toLowerCase().includes('gaming') ||
      searchResults[0].description.toLowerCase().includes('gaming')
    );
  });
});

test('Template Service: Safe Forking & Workspace Isolation', async (t) => {
  const sampleTemplate = {
    id: 'gaming-arena',
    name: 'Turn-Based Gaming Arena',
    code: 'pub struct ArenaContract;',
  };

  await t.test('forking into new project namespace generates isolated project namespace target', () => {
    const result = forkTemplate({
      template: sampleTemplate,
      target: 'new_project',
      newProjectName: 'my-custom-arena',
      autoBackup: true,
    });

    assert.equal(result.success, true);
    assert.equal(result.namespace, 'my-custom-arena');
    assert.equal(result.backupCreated, false);
    assert.ok(result.targetUrl.includes('project=my-custom-arena'));
    assert.ok(result.targetUrl.includes('template=gaming-arena'));
  });

  await t.test('replacing current workspace triggers automated safety backup', () => {
    const result = forkTemplate({
      template: sampleTemplate,
      target: 'replace_current',
      autoBackup: true,
    });

    assert.equal(result.success, true);
    assert.equal(result.backupCreated, true);
    assert.ok(result.backupId);
    assert.ok(result.targetUrl.includes('template=gaming-arena'));
    assert.ok(result.targetUrl.includes('confirmed=true'));
  });

  await t.test('createWorkspaceBackup creates timestamped backup record', () => {
    const backup = createWorkspaceBackup('fn sample_existing_code() {}', 'Pre-test backup');
    assert.ok(backup.id);
    assert.ok(backup.timestamp);
    assert.equal(backup.code, 'fn sample_existing_code() {}');
    assert.equal(backup.description, 'Pre-test backup');
  });
});
