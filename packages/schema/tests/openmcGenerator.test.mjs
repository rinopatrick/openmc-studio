import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPresetModel, generateOpenMcArtifacts } from '../dist/index.js';

test('generates the four baseline OpenMC XML artifacts', () => {
  const artifacts = generateOpenMcArtifacts(createPresetModel('pwr-starter'));
  assert.match(artifacts.materialsXml, /<materials>/);
  assert.match(artifacts.geometryXml, /<geometry>/);
  assert.match(artifacts.settingsXml, /<settings>/);
  assert.match(artifacts.talliesXml, /<tallies>/);
});

test('generates fixed source settings for shielding presets', () => {
  const artifacts = generateOpenMcArtifacts(createPresetModel('shielding-slab'));
  assert.match(artifacts.settingsXml, /fixed source/);
});
