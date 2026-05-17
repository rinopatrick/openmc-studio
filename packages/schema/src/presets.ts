import type { HierarchyNode, LatticeDefinition, MaterialDefinition, ReactorFamily, ReactorModel } from './model.js';

export interface PresetDefinition {
  id: string;
  family: ReactorFamily;
  name: string;
  description: string;
  tags: string[];
  createModel: () => ReactorModel;
}

export interface MaterialLibraryEntry {
  id: string;
  name: string;
  category: 'fuel' | 'cladding' | 'moderator' | 'coolant' | 'structural' | 'shielding' | 'absorber';
  description: string;
  material: MaterialDefinition;
}

export const materialLibrary: MaterialLibraryEntry[] = [
  // Fuels
  { id: 'lib-uo2-4pct', name: 'UO2 (4% enriched)', category: 'fuel', description: 'Standard PWR UO2 fuel at 4% U-235 enrichment.', material: { id: 'mat-uo2-4pct', name: 'UO2 4%', density: { value: 10.4, unit: 'g/cm3' }, temperature: { value: 900, unit: 'K' }, nuclides: [{ name: 'U235', fraction: 0.04, fractionType: 'atom' }, { name: 'U238', fraction: 0.96, fractionType: 'atom' }, { name: 'O16', fraction: 2, fractionType: 'atom' }] } },
  { id: 'lib-uo2-3p2pct', name: 'UO2 (3.2% enriched)', category: 'fuel', description: 'Low-enrichment UO2 for typical PWR.', material: { id: 'mat-uo2-3p2pct', name: 'UO2 3.2%', density: { value: 10.4, unit: 'g/cm3' }, temperature: { value: 900, unit: 'K' }, nuclides: [{ name: 'U235', fraction: 0.032, fractionType: 'atom' }, { name: 'U238', fraction: 0.968, fractionType: 'atom' }, { name: 'O16', fraction: 2, fractionType: 'atom' }] } },
  { id: 'lib-uo2-5pct', name: 'UO2 (5% enriched)', category: 'fuel', description: 'Higher enrichment UO2 for extended cycles.', material: { id: 'mat-uo2-5pct', name: 'UO2 5%', density: { value: 10.4, unit: 'g/cm3' }, temperature: { value: 900, unit: 'K' }, nuclides: [{ name: 'U235', fraction: 0.05, fractionType: 'atom' }, { name: 'U238', fraction: 0.95, fractionType: 'atom' }, { name: 'O16', fraction: 2, fractionType: 'atom' }] } },
  { id: 'lib-uo2-20pct', name: 'UO2 (20% enriched)', category: 'fuel', description: 'HALEU fuel for advanced reactors.', material: { id: 'mat-uo2-20pct', name: 'UO2 20%', density: { value: 10.4, unit: 'g/cm3' }, temperature: { value: 900, unit: 'K' }, nuclides: [{ name: 'U235', fraction: 0.20, fractionType: 'atom' }, { name: 'U238', fraction: 0.80, fractionType: 'atom' }, { name: 'O16', fraction: 2, fractionType: 'atom' }] } },
  { id: 'lib-uo2-93pct', name: 'UO2 (93% enriched)', category: 'fuel', description: 'HEU fuel for research reactors.', material: { id: 'mat-uo2-93pct', name: 'UO2 93%', density: { value: 10.4, unit: 'g/cm3' }, temperature: { value: 300, unit: 'K' }, nuclides: [{ name: 'U235', fraction: 0.93, fractionType: 'atom' }, { name: 'U238', fraction: 0.07, fractionType: 'atom' }, { name: 'O16', fraction: 2, fractionType: 'atom' }] } },
  { id: 'lib-mox', name: 'MOX (Mixed Oxide)', category: 'fuel', description: 'UO2 + PuO2 mixed oxide fuel.', material: { id: 'mat-mox', name: 'MOX Fuel', density: { value: 10.4, unit: 'g/cm3' }, temperature: { value: 900, unit: 'K' }, nuclides: [{ name: 'U235', fraction: 0.003, fractionType: 'atom' }, { name: 'U238', fraction: 0.717, fractionType: 'atom' }, { name: 'Pu239', fraction: 0.21, fractionType: 'atom' }, { name: 'Pu240', fraction: 0.05, fractionType: 'atom' }, { name: 'O16', fraction: 2, fractionType: 'atom' }] } },
  { id: 'lib-metal-uzr', name: 'U-Zr Metal Fuel', category: 'fuel', description: 'Metallic uranium-zirconium alloy for fast reactors.', material: { id: 'mat-metal-uzr', name: 'U-Zr Metal', density: { value: 15.8, unit: 'g/cm3' }, temperature: { value: 600, unit: 'K' }, nuclides: [{ name: 'U235', fraction: 0.1, fractionType: 'atom' }, { name: 'U238', fraction: 0.8, fractionType: 'atom' }, { name: 'Zr90', fraction: 0.1, fractionType: 'atom' }] } },
  { id: 'lib-tho2', name: 'ThO2 Fuel', category: 'fuel', description: 'Thorium dioxide fuel for thorium cycle.', material: { id: 'mat-tho2', name: 'ThO2', density: { value: 10.0, unit: 'g/cm3' }, temperature: { value: 900, unit: 'K' }, nuclides: [{ name: 'Th232', fraction: 1, fractionType: 'atom' }, { name: 'O16', fraction: 2, fractionType: 'atom' }] } },
  { id: 'lib-gd-fuel', name: 'UO2 + Gd2O3 (burnable absorber)', category: 'fuel', description: 'UO2 with gadolinia burnable absorber.', material: { id: 'mat-gd-fuel', name: 'UO2-Gd2O3', density: { value: 10.2, unit: 'g/cm3' }, temperature: { value: 900, unit: 'K' }, nuclides: [{ name: 'U235', fraction: 0.035, fractionType: 'atom' }, { name: 'U238', fraction: 0.865, fractionType: 'atom' }, { name: 'Gd155', fraction: 0.05, fractionType: 'atom' }, { name: 'Gd157', fraction: 0.05, fractionType: 'atom' }, { name: 'O16', fraction: 2, fractionType: 'atom' }] } },

  // Cladding
  { id: 'lib-zircaloy2', name: 'Zircaloy-2', category: 'cladding', description: 'Standard BWR cladding alloy.', material: { id: 'mat-zircaloy2', name: 'Zircaloy-2', density: { value: 6.55, unit: 'g/cm3' }, nuclides: [{ name: 'Zr90', fraction: 0.98, fractionType: 'weight' }, { name: 'Sn118', fraction: 0.015, fractionType: 'weight' }, { name: 'Fe56', fraction: 0.002, fractionType: 'weight' }, { name: 'Cr52', fraction: 0.001, fractionType: 'weight' }, { name: 'Ni58', fraction: 0.0005, fractionType: 'weight' }] } },
  { id: 'lib-zircaloy4', name: 'Zircaloy-4', category: 'cladding', description: 'Standard PWR cladding alloy.', material: { id: 'mat-zircaloy4', name: 'Zircaloy-4', density: { value: 6.56, unit: 'g/cm3' }, nuclides: [{ name: 'Zr90', fraction: 0.98, fractionType: 'weight' }, { name: 'Sn118', fraction: 0.015, fractionType: 'weight' }, { name: 'Fe56', fraction: 0.002, fractionType: 'weight' }, { name: 'Cr52', fraction: 0.001, fractionType: 'weight' }] } },
  { id: 'lib-zirlo', name: 'ZIRLO™', category: 'cladding', description: 'Advanced PWR cladding for high burnup.', material: { id: 'mat-zirlo', name: 'ZIRLO', density: { value: 6.56, unit: 'g/cm3' }, nuclides: [{ name: 'Zr90', fraction: 0.98, fractionType: 'weight' }, { name: 'Sn118', fraction: 0.01, fractionType: 'weight' }, { name: 'Nb93', fraction: 0.01, fractionType: 'weight' }] } },
  { id: 'lib-m5', name: 'M5®', category: 'cladding', description: 'Framatome advanced cladding alloy.', material: { id: 'mat-m5', name: 'M5', density: { value: 6.56, unit: 'g/cm3' }, nuclides: [{ name: 'Zr90', fraction: 0.99, fractionType: 'weight' }, { name: 'Nb93', fraction: 0.01, fractionType: 'weight' }] } },
  { id: 'lib-sic', name: 'Silicon Carbide (SiC)', category: 'cladding', description: 'Accident-tolerant cladding candidate.', material: { id: 'mat-sic', name: 'SiC', density: { value: 3.21, unit: 'g/cm3' }, nuclides: [{ name: 'Si28', fraction: 1, fractionType: 'atom' }, { name: 'C0', fraction: 1, fractionType: 'atom' }] } },

  // Moderators
  { id: 'lib-light-water', name: 'Light Water (H2O)', category: 'moderator', description: 'Standard PWR/BWR moderator and coolant.', material: { id: 'mat-light-water', name: 'Light Water', density: { value: 0.997, unit: 'g/cm3' }, temperature: { value: 293.6, unit: 'K' }, nuclides: [{ name: 'H1', fraction: 2, fractionType: 'atom' }, { name: 'O16', fraction: 1, fractionType: 'atom' }] } },
  { id: 'lib-heavy-water', name: 'Heavy Water (D2O)', category: 'moderator', description: 'CANDU moderator with better neutron economy.', material: { id: 'mat-heavy-water', name: 'Heavy Water', density: { value: 1.105, unit: 'g/cm3' }, temperature: { value: 293.6, unit: 'K' }, nuclides: [{ name: 'H2', fraction: 2, fractionType: 'atom' }, { name: 'O16', fraction: 1, fractionType: 'atom' }] } },
  { id: 'lib-graphite', name: 'Graphite', category: 'moderator', description: 'HTGR and research reactor moderator.', material: { id: 'mat-graphite-lib', name: 'Graphite', density: { value: 1.75, unit: 'g/cm3' }, temperature: { value: 900, unit: 'K' }, nuclides: [{ name: 'C0', fraction: 1, fractionType: 'atom' }] } },
  { id: 'lib-beryllium', name: 'Beryllium', category: 'moderator', description: 'High-performance moderator and reflector.', material: { id: 'mat-beryllium', name: 'Beryllium', density: { value: 1.85, unit: 'g/cm3' }, nuclides: [{ name: 'Be9', fraction: 1, fractionType: 'atom' }] } },

  // Coolants
  { id: 'lib-sodium', name: 'Liquid Sodium', category: 'coolant', description: 'SFR coolant with excellent heat transfer.', material: { id: 'mat-sodium-lib', name: 'Liquid Sodium', density: { value: 0.927, unit: 'g/cm3' }, temperature: { value: 650, unit: 'K' }, nuclides: [{ name: 'Na23', fraction: 1, fractionType: 'atom' }] } },
  { id: 'lib-lead-bismuth', name: 'Lead-Bismuth Eutectic', category: 'coolant', description: 'LBE coolant for LFR and ADS.', material: { id: 'mat-lbe', name: 'Lead-Bismuth', density: { value: 10.5, unit: 'g/cm3' }, temperature: { value: 600, unit: 'K' }, nuclides: [{ name: 'Pb208', fraction: 0.45, fractionType: 'atom' }, { name: 'Bi209', fraction: 0.55, fractionType: 'atom' }] } },
  { id: 'lib-helium', name: 'Helium Gas', category: 'coolant', description: 'HTGR and GCR coolant.', material: { id: 'mat-helium', name: 'Helium', density: { value: 0.000164, unit: 'g/cm3' }, temperature: { value: 600, unit: 'K' }, nuclides: [{ name: 'He4', fraction: 1, fractionType: 'atom' }] } },
  { id: 'lib-co2', name: 'Carbon Dioxide', category: 'coolant', description: 'GCR coolant.', material: { id: 'mat-co2', name: 'CO2', density: { value: 0.0018, unit: 'g/cm3' }, temperature: { value: 600, unit: 'K' }, nuclides: [{ name: 'C0', fraction: 1, fractionType: 'atom' }, { name: 'O16', fraction: 2, fractionType: 'atom' }] } },
  { id: 'lib-flibe', name: 'FLiBe Salt', category: 'coolant', description: 'Molten salt coolant for MSR.', material: { id: 'mat-flibe', name: 'FLiBe', density: { value: 1.94, unit: 'g/cm3' }, temperature: { value: 900, unit: 'K' }, nuclides: [{ name: 'Li7', fraction: 2, fractionType: 'atom' }, { name: 'Be9', fraction: 1, fractionType: 'atom' }, { name: 'F19', fraction: 4, fractionType: 'atom' }] } },

  // Structural
  { id: 'lib-ss304', name: 'Stainless Steel 304', category: 'structural', description: 'Common structural steel.', material: { id: 'mat-ss304', name: 'SS-304', density: { value: 8.0, unit: 'g/cm3' }, nuclides: [{ name: 'Fe56', fraction: 0.7, fractionType: 'weight' }, { name: 'Cr52', fraction: 0.19, fractionType: 'weight' }, { name: 'Ni58', fraction: 0.10, fractionType: 'weight' }, { name: 'Mn55', fraction: 0.01, fractionType: 'weight' }] } },
  { id: 'lib-ss316', name: 'Stainless Steel 316', category: 'structural', description: 'Corrosion-resistant structural steel.', material: { id: 'mat-ss316', name: 'SS-316', density: { value: 8.0, unit: 'g/cm3' }, nuclides: [{ name: 'Fe56', fraction: 0.65, fractionType: 'weight' }, { name: 'Cr52', fraction: 0.17, fractionType: 'weight' }, { name: 'Ni58', fraction: 0.12, fractionType: 'weight' }, { name: 'Mo98', fraction: 0.025, fractionType: 'weight' }, { name: 'Mn55', fraction: 0.02, fractionType: 'weight' }] } },
  { id: 'lib-inconel', name: 'Inconel 718', category: 'structural', description: 'High-temperature nickel superalloy.', material: { id: 'mat-inconel', name: 'Inconel 718', density: { value: 8.19, unit: 'g/cm3' }, nuclides: [{ name: 'Ni58', fraction: 0.53, fractionType: 'weight' }, { name: 'Fe56', fraction: 0.18, fractionType: 'weight' }, { name: 'Cr52', fraction: 0.19, fractionType: 'weight' }, { name: 'Nb93', fraction: 0.05, fractionType: 'weight' }, { name: 'Mo98', fraction: 0.03, fractionType: 'weight' }] } },
  { id: 'lib-aluminum', name: 'Aluminum 6061', category: 'structural', description: 'Research reactor structural material.', material: { id: 'mat-aluminum', name: 'Al-6061', density: { value: 2.70, unit: 'g/cm3' }, nuclides: [{ name: 'Al27', fraction: 0.98, fractionType: 'weight' }, { name: 'Mg24', fraction: 0.01, fractionType: 'weight' }, { name: 'Si28', fraction: 0.006, fractionType: 'weight' }] } },

  // Shielding
  { id: 'lib-concrete', name: 'Ordinary Concrete', category: 'shielding', description: 'Standard shielding concrete.', material: { id: 'mat-concrete-lib', name: 'Concrete', density: { value: 2.3, unit: 'g/cm3' }, nuclides: [{ name: 'O16', fraction: 0.52, fractionType: 'weight' }, { name: 'Si28', fraction: 0.32, fractionType: 'weight' }, { name: 'Ca40', fraction: 0.06, fractionType: 'weight' }, { name: 'Fe56', fraction: 0.04, fractionType: 'weight' }, { name: 'H1', fraction: 0.01, fractionType: 'weight' }] } },
  { id: 'lib-borated-poly', name: 'Borated Polyethylene', category: 'shielding', description: 'Neutron shielding with hydrogen and boron.', material: { id: 'mat-borated-poly', name: 'Borated PE', density: { value: 0.95, unit: 'g/cm3' }, nuclides: [{ name: 'H1', fraction: 0.12, fractionType: 'weight' }, { name: 'C0', fraction: 0.80, fractionType: 'weight' }, { name: 'B10', fraction: 0.05, fractionType: 'weight' }, { name: 'B11', fraction: 0.03, fractionType: 'weight' }] } },
  { id: 'lib-lead', name: 'Lead', category: 'shielding', description: 'Gamma shielding material.', material: { id: 'mat-lead-lib', name: 'Lead', density: { value: 11.35, unit: 'g/cm3' }, nuclides: [{ name: 'Pb208', fraction: 0.52, fractionType: 'atom' }, { name: 'Pb206', fraction: 0.24, fractionType: 'atom' }, { name: 'Pb207', fraction: 0.22, fractionType: 'atom' }, { name: 'Pb204', fraction: 0.02, fractionType: 'atom' }] } },
  { id: 'lib-boral', name: 'Boral (B4C+Al)', category: 'shielding', description: 'Boron carbide in aluminum matrix for neutron shielding.', material: { id: 'mat-boral', name: 'Boral', density: { value: 2.6, unit: 'g/cm3' }, nuclides: [{ name: 'B10', fraction: 0.15, fractionType: 'weight' }, { name: 'B11', fraction: 0.05, fractionType: 'weight' }, { name: 'C0', fraction: 0.05, fractionType: 'weight' }, { name: 'Al27', fraction: 0.75, fractionType: 'weight' }] } },

  // Absorbers
  { id: 'lib-b4c', name: 'Boron Carbide (B4C)', category: 'absorber', description: 'Primary control rod absorber material.', material: { id: 'mat-b4c', name: 'B4C', density: { value: 2.52, unit: 'g/cm3' }, nuclides: [{ name: 'B10', fraction: 0.2, fractionType: 'atom' }, { name: 'B11', fraction: 0.8, fractionType: 'atom' }, { name: 'C0', fraction: 1, fractionType: 'atom' }] } },
  { id: 'lib-ag-incd', name: 'Ag-In-Cd Alloy', category: 'absorber', description: 'PWR control rod absorber alloy.', material: { id: 'mat-ag-incd', name: 'Ag-In-Cd', density: { value: 10.17, unit: 'g/cm3' }, nuclides: [{ name: 'Ag107', fraction: 0.8, fractionType: 'atom' }, { name: 'In115', fraction: 0.15, fractionType: 'atom' }, { name: 'Cd113', fraction: 0.05, fractionType: 'atom' }] } },
  { id: 'lib-hafnium', name: 'Hafnium', category: 'absorber', description: 'High-performance control rod material.', material: { id: 'mat-hafnium', name: 'Hafnium', density: { value: 13.31, unit: 'g/cm3' }, nuclides: [{ name: 'Hf178', fraction: 0.27, fractionType: 'atom' }, { name: 'Hf177', fraction: 0.19, fractionType: 'atom' }, { name: 'Hf179', fraction: 0.14, fractionType: 'atom' }, { name: 'Hf180', fraction: 0.35, fractionType: 'atom' }, { name: 'Hf176', fraction: 0.05, fractionType: 'atom' }] } },
  { id: 'lib-eu2o3', name: 'Eu2O3 in Steel', category: 'absorber', description: 'Burnable absorber in steel matrix.', material: { id: 'mat-eu2o3', name: 'Eu2O3-Steel', density: { value: 7.5, unit: 'g/cm3' }, nuclides: [{ name: 'Eu151', fraction: 0.05, fractionType: 'atom' }, { name: 'Eu153', fraction: 0.05, fractionType: 'atom' }, { name: 'O16', fraction: 0.03, fractionType: 'atom' }, { name: 'Fe56', fraction: 0.87, fractionType: 'atom' }] } },
];

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
