import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProjectBundle, parseProjectBundle, serializeProjectBundle } from '../dist/index.js';

test('creates a fixed-source shielding project with matching manifest and model', () => {
  const bundle = createProjectBundle({
    id: 'project-1',
    name: 'Shielding Starter',
    family: 'shielding-fixed-source',
    now: '2026-01-01T00:00:00.000Z',
  });

  assert.equal(bundle.manifest.reactorFamily, 'shielding-fixed-source');
  assert.equal(bundle.model.family, 'shielding-fixed-source');
  assert.equal(bundle.model.settings.mode, 'fixed-source');
});

test('roundtrips project bundles through JSON', () => {
  const bundle = createProjectBundle({
    id: 'project-2',
    name: 'Custom Core',
    family: 'custom-irregular',
    now: '2026-01-01T00:00:00.000Z',
  });

  assert.deepEqual(parseProjectBundle(serializeProjectBundle(bundle)), bundle);
});
