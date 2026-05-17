import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPresetModel, generateOpenMcArtifacts } from '../dist/index.js';

test('generates the four baseline OpenMC XML artifacts', () => {
  const artifacts = generateOpenMcArtifacts(createPresetModel('pwr-starter'));
  assert.match(artifacts.materialsXml, /<materials>/);
  assert.match(artifacts.geometryXml, /<geometry>/);
  assert.match(artifacts.settingsXml, /<settings>/);
  assert.match(artifacts.talliesXml, /<tallies>/);
  assert.match(artifacts.plotsXml, /<plots>/);
  assert.match(artifacts.plotsXml, /<color_by>material<\/color_by>/);
});

test('generates fixed source settings for shielding presets', () => {
  const artifacts = generateOpenMcArtifacts(createPresetModel('shielding-slab'));
  assert.match(artifacts.settingsXml, /fixed source/);
});

test('uses configured plot basis when generating plots.xml', () => {
  const model = createPresetModel('custom-irregular');
  model.settings.plotBasis = 'yz';
  model.settings.temperature = { default: 600, method: 'interpolation', multipole: true, range: [294, 1200] };
  const artifacts = generateOpenMcArtifacts(model);
  assert.match(artifacts.plotsXml, /<basis>yz<\/basis>/);
  assert.match(artifacts.settingsXml, /<temperature>/);
  assert.match(artifacts.settingsXml, /<default>600<\/default>/);
  assert.match(artifacts.settingsXml, /<multipole>true<\/multipole>/);
  assert.match(artifacts.settingsXml, /<range>294 1200<\/range>/);
});

test('emits coupled thermal feedback settings hooks when enabled', () => {
  const model = createPresetModel('pwr-starter');
  model.settings.thermalFeedback = {
    enabled: true,
    maxIterations: 8,
    convergenceTolerance: 1e-5,
    updateStrategy: 'under-relaxation',
    relaxationFactor: 0.6,
    materialTemperatures: [{ materialId: 'mat-uo2', temperature: 920, thermalExpansionCoefficient: 1.05e-5 }],
  };
  const artifacts = generateOpenMcArtifacts(model);
  assert.match(artifacts.settingsXml, /<thermal_feedback>/);
  assert.match(artifacts.settingsXml, /<max_iterations>8<\/max_iterations>/);
  assert.match(artifacts.settingsXml, /convergence_tolerance>0.00001<\/convergence_tolerance>/);
  assert.match(artifacts.settingsXml, /material id="mat-uo2" temperature="920" thermal_expansion_coefficient="0.0000105"/);
});

test('emits sensitivity derivative definitions when sensitivity is enabled on tally', () => {
  const model = createPresetModel('custom-irregular');
  model.tallies = [{
    id: 'tally-sens',
    name: 'Sensitivity tally',
    scores: ['flux'],
    targetNodeIds: ['root'],
    filters: [{ type: 'energy', bins: [1e-5, 1.0, 2e7] }],
    sensitivity: {
      enabled: true,
      nuclides: ['U235', 'U238'],
      scores: ['flux', 'fission'],
    },
  }];

  const artifacts = generateOpenMcArtifacts(model);
  assert.match(artifacts.talliesXml, /<derivative id="1">/);
  assert.match(artifacts.talliesXml, /<nuclide>U235<\/nuclide>/);
  assert.match(artifacts.talliesXml, /<nuclide>U238<\/nuclide>/);
  assert.match(artifacts.talliesXml, /<filter type="particle">/);
  assert.match(artifacts.talliesXml, /<bins>neutron<\/bins>/);
});

test('generates OpenMC-native CSG geometry when surfaces and cells are present', () => {
  const model = createPresetModel('custom-irregular');
  model.materials.materials = [{ id: 'mat-water', name: 'Water', density: { value: 1, unit: 'g/cm3' }, nuclides: [{ name: 'H1', fraction: 2, fractionType: 'atom' }] }];
  model.openmcGeometry = {
    surfaces: [{ id: 'surf-sphere', openmcId: 1, name: 'Vacuum sphere', type: 'sphere', coeffs: [0, 0, 0, 10], boundary: 'vacuum' }],
    cells: [{ id: 'cell-water', openmcId: 1, name: 'Water sphere', materialId: 'mat-water', region: '-1' }],
  };

  const artifacts = generateOpenMcArtifacts(model);
  assert.match(artifacts.geometryXml, /<surface id="1"/);
  assert.match(artifacts.geometryXml, /type="sphere"/);
  assert.match(artifacts.geometryXml, /boundary="vacuum"/);
  assert.match(artifacts.geometryXml, /<cell id="1"/);
  assert.match(artifacts.geometryXml, /material="1"/);
  assert.match(artifacts.geometryXml, /region="-1"/);
});
