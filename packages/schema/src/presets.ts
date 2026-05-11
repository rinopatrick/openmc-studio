import type { HierarchyNode, LatticeDefinition, MaterialDefinition, ReactorFamily, ReactorModel } from './model.js';

export interface PresetDefinition {
  id: string;
  family: ReactorFamily;
  name: string;
  description: string;
  tags: string[];
  createModel: () => ReactorModel;
}

const water: MaterialDefinition = {
  id: 'mat-water',
  name: 'Light Water / Moderator',
  density: { value: 0.997, unit: 'g/cm3' },
  temperature: { value: 293.6, unit: 'K' },
  nuclides: [
    { name: 'H1', fraction: 2, fractionType: 'atom' },
    { name: 'O16', fraction: 1, fractionType: 'atom' },
  ],
};

const steel: MaterialDefinition = {
  id: 'mat-steel',
  name: 'Stainless Steel',
  density: { value: 7.9, unit: 'g/cm3' },
  temperature: { value: 293.6, unit: 'K' },
  nuclides: [
    { name: 'Fe56', fraction: 0.7, fractionType: 'weight' },
    { name: 'Cr52', fraction: 0.19, fractionType: 'weight' },
    { name: 'Ni58', fraction: 0.11, fractionType: 'weight' },
  ],
};

const uo2: MaterialDefinition = {
  id: 'mat-uo2',
  name: 'UO2 Fuel',
  density: { value: 10.4, unit: 'g/cm3' },
  temperature: { value: 900, unit: 'K' },
  nuclides: [
    { name: 'U235', fraction: 0.04, fractionType: 'atom' },
    { name: 'U238', fraction: 0.96, fractionType: 'atom' },
    { name: 'O16', fraction: 2, fractionType: 'atom' },
  ],
};

const graphite: MaterialDefinition = {
  id: 'mat-graphite',
  name: 'Graphite',
  density: { value: 1.75, unit: 'g/cm3' },
  temperature: { value: 900, unit: 'K' },
  nuclides: [{ name: 'C0', fraction: 1, fractionType: 'atom' }],
};

const sodium: MaterialDefinition = {
  id: 'mat-sodium',
  name: 'Liquid Sodium',
  density: { value: 0.86, unit: 'g/cm3' },
  temperature: { value: 650, unit: 'K' },
  nuclides: [{ name: 'Na23', fraction: 1, fractionType: 'atom' }],
};

const salt: MaterialDefinition = {
  id: 'mat-fuel-salt',
  name: 'Fuel Salt Placeholder',
  density: { value: 3.2, unit: 'g/cm3' },
  temperature: { value: 900, unit: 'K' },
  nuclides: [
    { name: 'Li7', fraction: 2, fractionType: 'atom' },
    { name: 'F19', fraction: 4, fractionType: 'atom' },
    { name: 'U235', fraction: 0.02, fractionType: 'atom' },
    { name: 'U238', fraction: 0.48, fractionType: 'atom' },
  ],
};

const concrete: MaterialDefinition = {
  id: 'mat-concrete',
  name: 'Concrete Shield',
  density: { value: 2.3, unit: 'g/cm3' },
  temperature: { value: 293.6, unit: 'K' },
  nuclides: [
    { name: 'O16', fraction: 0.52, fractionType: 'weight' },
    { name: 'Si28', fraction: 0.32, fractionType: 'weight' },
    { name: 'Ca40', fraction: 0.16, fractionType: 'weight' },
  ],
};

export const reactorPresets: PresetDefinition[] = [
  preset('pwr-starter', 'pwr', 'PWR Core Starter', 'Rectangular fuel assembly hierarchy with water moderator and UO2 fuel.', ['rect', 'thermal', 'full-core']),
  preset('bwr-starter', 'bwr', 'BWR Channel Starter', 'Boiling water reactor starter with water channel placeholders.', ['rect', 'thermal', 'channel']),
  preset('candu-starter', 'phwr-candu', 'PHWR/CANDU Starter', 'Pressure-tube style heavy-water reactor topology starter.', ['pressure-tube', 'thermal']),
  preset('htgr-starter', 'htgr', 'HTGR Hex Block Starter', 'Hexagonal graphite block reactor starter for TRISO-style layouts.', ['hex', 'graphite']),
  preset('sfr-starter', 'sfr', 'Sodium Fast Reactor Starter', 'Fast reactor hex lattice with sodium coolant placeholder.', ['hex', 'fast']),
  preset('lfr-starter', 'lfr', 'Lead Fast Reactor Starter', 'Fast reactor starter using heavy metal coolant placeholder regions.', ['hex', 'fast']),
  preset('msr-starter', 'msr', 'Molten Salt Reactor Starter', 'Liquid fuel salt topology with graphite/moderator region placeholders.', ['irregular', 'fluid-fuel']),
  preset('smr-starter', 'smr', 'SMR Compact Core Starter', 'Compact modular reactor starter with simplified full-core map.', ['rect', 'compact']),
  preset('research-starter', 'research', 'Research Reactor Starter', 'Pool-type research reactor starter with irregular experiment positions.', ['irregular', 'pool']),
  preset('shielding-slab', 'shielding-fixed-source', 'Layered Shielding Slab', 'Fixed-source layered shielding workflow with concrete and steel layers.', ['fixed-source', 'shielding']),
  preset('custom-irregular', 'custom-irregular', 'Custom Irregular Reactor', 'Blank irregular topology for user-defined reactor shapes.', ['custom', 'irregular']),
];

export function createPresetModel(presetId: string): ReactorModel {
  const presetDefinition = reactorPresets.find((candidate) => candidate.id === presetId);
  if (!presetDefinition) {
    throw new Error(`Unknown preset: ${presetId}`);
  }

  return presetDefinition.createModel();
}

function preset(id: string, family: ReactorFamily, name: string, description: string, tags: string[]): PresetDefinition {
  return {
    id,
    family,
    name,
    description,
    tags,
    createModel: () => buildStarterModel(family, name),
  };
}

function buildStarterModel(family: ReactorFamily, rootName: string): ReactorModel {
  const fixedSource = family === 'shielding-fixed-source';
  const materials = materialSetForFamily(family);
  const lattice = latticeForFamily(family);
  const root = rootForFamily(family, rootName, lattice?.id);

  return {
    schemaVersion: 1,
    family,
    materials: { materials },
    primitives: [],
    regions: [],
    lattices: lattice ? [lattice] : [],
    root,
    sources: fixedSource
      ? [{ id: 'src-point', name: 'Point neutron source', type: 'point', energy: { value: 2, unit: 'MeV' }, strength: 1 }]
      : [],
    tallies: fixedSource
      ? [{ id: 'tally-flux-shield', name: 'Shield flux tally', scores: ['flux'], targetNodeIds: ['node-shield'] }]
      : [{ id: 'tally-core-flux', name: 'Core flux tally', scores: ['flux', 'fission'], targetNodeIds: ['root'] }],
    settings: fixedSource
      ? { mode: 'fixed-source', particles: 10_000 }
      : { mode: 'eigenvalue', particles: 10_000, batches: 100, inactive: 20 },
  };
}

function materialSetForFamily(family: ReactorFamily): MaterialDefinition[] {
  if (family === 'shielding-fixed-source') return [steel, concrete];
  if (family === 'htgr') return [uo2, graphite, steel];
  if (family === 'sfr') return [uo2, sodium, steel];
  if (family === 'lfr') return [uo2, steel];
  if (family === 'msr') return [salt, graphite, steel];
  return [uo2, water, steel];
}

function latticeForFamily(family: ReactorFamily): LatticeDefinition | undefined {
  if (family === 'shielding-fixed-source') return undefined;

  if (family === 'htgr' || family === 'sfr' || family === 'lfr') {
    return {
      id: 'lat-hex-core',
      kind: 'hex',
      name: 'Hex core lattice',
      pitch: { value: 12.5, unit: 'cm' },
      map: [
        ['reflector', 'fuel', 'reflector'],
        ['fuel', 'fuel', 'fuel'],
        ['reflector', 'fuel', 'reflector'],
      ],
    };
  }

  if (family === 'custom-irregular' || family === 'research' || family === 'msr') {
    return {
      id: 'lat-irregular-core',
      kind: 'irregular',
      name: 'Irregular core map',
      map: [
        ['region-a', 'region-b', ''],
        ['region-c', 'fuel-zone', 'experiment'],
      ],
    };
  }

  return {
    id: 'lat-rect-core',
    kind: 'rect',
    name: 'Rectangular core lattice',
    pitch: { value: 21.5, unit: 'cm' },
    map: [
      ['reflector', 'assembly-a', 'reflector'],
      ['assembly-a', 'assembly-b', 'assembly-a'],
      ['reflector', 'assembly-a', 'reflector'],
    ],
  };
}

function rootForFamily(family: ReactorFamily, rootName: string, latticeId?: string): HierarchyNode {
  if (family === 'shielding-fixed-source') {
    return {
      id: 'root',
      name: rootName,
      role: 'shield',
      children: [
        { id: 'node-source-gap', name: 'Source Gap', role: 'region', materialId: 'mat-steel', children: [] },
        { id: 'node-shield', name: 'Shield Layer', role: 'shield', materialId: 'mat-concrete', children: [] },
      ],
    };
  }

  return {
    id: 'root',
    name: rootName,
    role: 'core',
    latticeId,
    children: [
      {
        id: 'node-fuel-zone',
        name: 'Fuel Zone',
        role: family === 'htgr' ? 'block' : 'assembly',
        materialId: family === 'msr' ? 'mat-fuel-salt' : 'mat-uo2',
        children: [
          { id: 'node-pin-or-region', name: family === 'custom-irregular' ? 'Custom Region' : 'Fuel Pin / Block Cell', role: 'pin', materialId: family === 'msr' ? 'mat-fuel-salt' : 'mat-uo2', children: [] },
        ],
      },
      { id: 'node-structure', name: 'Structure / Reflector', role: 'region', materialId: family === 'htgr' || family === 'msr' ? 'mat-graphite' : 'mat-steel', children: [] },
    ],
  };
}
