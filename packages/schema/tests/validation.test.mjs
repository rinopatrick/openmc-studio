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

test('flags sensitivity tally that has no nuclides', () => {
  const bundle = createProjectBundle({ id: 'x', name: 'bad', family: 'custom-irregular' });
  bundle.model.tallies.push({
    id: 'tally-sensitivity-bad',
    name: 'Sensitivity missing nuclides',
    scores: ['flux'],
    targetNodeIds: ['root'],
    sensitivity: {
      enabled: true,
      nuclides: [],
      scores: ['flux'],
    },
  });
  const diagnostics = validateModelBasics(bundle.model);
  assert.ok(diagnostics.some((diagnostic) => diagnostic.id === 'tally-sensitivity-nuclides-empty'));
});

test('flags OpenMC CSG cells that reference missing surfaces', () => {
  const bundle = createProjectBundle({ id: 'x', name: 'bad', family: 'custom-irregular' });
  bundle.model.openmcGeometry = {
    surfaces: [],
    cells: [{ id: 'cell', openmcId: 1, name: 'Bad cell', region: '-99' }],
  };
  const diagnostics = validateModelBasics(bundle.model);
  assert.ok(diagnostics.some((diagnostic) => diagnostic.id === 'csg-region-missing-surface'));
});
