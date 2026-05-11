import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPresetModel, reactorPresets, validateModelBasics } from '../dist/index.js';

test('ships presets for all initial reactor families and shielding', () => {
  const families = new Set(reactorPresets.map((preset) => preset.family));
  for (const family of ['pwr', 'bwr', 'phwr-candu', 'htgr', 'sfr', 'lfr', 'msr', 'smr', 'research', 'shielding-fixed-source', 'custom-irregular']) {
    assert.ok(families.has(family), `missing ${family}`);
  }
});

test('all presets create models without basic validation errors', () => {
  for (const preset of reactorPresets) {
    const diagnostics = validateModelBasics(createPresetModel(preset.id));
    assert.deepEqual(
      diagnostics.filter((diagnostic) => diagnostic.severity === 'error'),
      [],
      preset.name,
    );
  }
});
