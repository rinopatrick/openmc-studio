import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProjectBundle, validateModelBasics } from '../dist/index.js';

test('flags fixed-source models with no source', () => {
  const bundle = createProjectBundle({ id: 'x', name: 'bad', family: 'shielding-fixed-source' });
  const diagnostics = validateModelBasics(bundle.model);
  assert.ok(diagnostics.some((diagnostic) => diagnostic.id === 'fixed-source-without-source'));
});

test('flags tally targets that do not exist', () => {
  const bundle = createProjectBundle({ id: 'x', name: 'bad', family: 'custom-irregular' });
  bundle.model.tallies.push({ id: 'tally', name: 'Bad tally', scores: ['flux'], targetNodeIds: ['missing'] });
  const diagnostics = validateModelBasics(bundle.model);
  assert.ok(diagnostics.some((diagnostic) => diagnostic.id === 'tally-target-missing'));
});
