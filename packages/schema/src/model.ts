export type ReactorFamily =
  | 'pwr'
  | 'bwr'
  | 'phwr-candu'
  | 'htgr'
  | 'sfr'
  | 'lfr'
  | 'msr'
  | 'smr'
  | 'research'
  | 'shielding-fixed-source'
  | 'custom-irregular';

export type LengthUnit = 'm' | 'cm' | 'mm';
export type EnergyUnit = 'eV' | 'keV' | 'MeV';
export type DensityUnit = 'kg/m3' | 'g/cm3' | 'atom/b-cm';

export interface Quantity<Unit extends string = string> {
  value: number;
  unit: Unit;
}

export interface ProjectManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  defaultUnits: UnitPresetName;
  reactorFamily: ReactorFamily;
  modelPath: string;
}

export type UnitPresetName = 'si' | 'nuclear-common';

export interface MaterialNuclide {
  name: string;
  fraction: number;
  fractionType: 'atom' | 'weight';
}

export interface MaterialDefinition {
  id: string;
  name: string;
  density: Quantity<DensityUnit>;
  temperature?: Quantity<'K' | 'C'>;
  nuclides: MaterialNuclide[];
}

export interface MaterialLibrary {
  materials: MaterialDefinition[];
}

export type PrimitiveKind = 'plane' | 'cylinder' | 'sphere' | 'box' | 'cone';

export interface GeometryPrimitive {
  id: string;
  kind: PrimitiveKind;
  name: string;
  parameters: Record<string, Quantity | number | string>;
}

export type BooleanRegionOperator = 'and' | 'or' | 'not' | 'halfspace';

export interface BooleanRegion {
  id: string;
  operator: BooleanRegionOperator;
  primitiveId?: string;
  sense?: '+' | '-';
  children?: BooleanRegion[];
}

export type LatticeKind = 'rect' | 'hex' | 'irregular';

export interface LatticeDefinition {
  id: string;
  kind: LatticeKind;
  name: string;
  pitch?: Quantity<LengthUnit>;
  map: string[][];
}

export interface TransformDefinition {
  translate?: [number, number, number];
  rotateDeg?: [number, number, number];
  mirror?: 'x' | 'y' | 'z';
}

export interface HierarchyNode {
  id: string;
  name: string;
  role: 'core' | 'assembly' | 'block' | 'pin' | 'region' | 'shield' | 'custom';
  materialId?: string;
  regionId?: string;
  latticeId?: string;
  transform?: TransformDefinition;
  children: HierarchyNode[];
}

export interface SourceDefinition {
  id: string;
  name: string;
  type: 'point' | 'box' | 'cylindrical' | 'distributed' | 'custom';
  energy?: Quantity<EnergyUnit>;
  strength?: number;
  regionId?: string;
}

export interface TallyDefinition {
  id: string;
  name: string;
  scores: string[];
  targetNodeIds: string[];
  energyBins?: Quantity<EnergyUnit>[];
}

export interface SimulationSettings {
  mode: 'eigenvalue' | 'fixed-source';
  particles: number;
  batches?: number;
  inactive?: number;
}

export interface ReactorModel {
  schemaVersion: 1;
  family: ReactorFamily;
  materials: MaterialLibrary;
  primitives: GeometryPrimitive[];
  regions: BooleanRegion[];
  lattices: LatticeDefinition[];
  root: HierarchyNode;
  sources: SourceDefinition[];
  tallies: TallyDefinition[];
  settings: SimulationSettings;
}
