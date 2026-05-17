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
export type OpenMcSurfaceType =
  | 'x-plane'
  | 'y-plane'
  | 'z-plane'
  | 'plane'
  | 'x-cylinder'
  | 'y-cylinder'
  | 'z-cylinder'
  | 'sphere'
  | 'x-cone'
  | 'y-cone'
  | 'z-cone'
  | 'x-torus'
  | 'y-torus'
  | 'z-torus'
  | 'quadric'
  | 'macrobody';

export type OpenMcBoundaryType = 'transmission' | 'vacuum' | 'reflective' | 'periodic' | 'white';

export interface GeometryPrimitive {
  id: string;
  kind: PrimitiveKind;
  name: string;
  parameters: Record<string, Quantity | number | string>;
}

export interface OpenMcSurfaceDefinition {
  id: string;
  openmcId: number;
  name: string;
  type: OpenMcSurfaceType;
  coeffs: number[];
  boundary?: OpenMcBoundaryType;
}

export interface OpenMcCellDefinition {
  id: string;
  openmcId: number;
  name: string;
  universe?: number;
  materialId?: string;
  materialOpenMcId?: number;
  fillUniverse?: number;
  region: string;
}

export interface OpenMcGeometryModel {
  surfaces: OpenMcSurfaceDefinition[];
  cells: OpenMcCellDefinition[];
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
  angle?: { type: 'isotropic' | 'monodirectional'; u?: number; v?: number; w?: number };
  parameters?: Record<string, number>;
}

export type TallyFilterType =
  | 'energy'
  | 'spatial'
  | 'surface'
  | 'cell'
  | 'material'
  | 'universe'
  | 'mesh'
  | 'mu'
  | 'polar'
  | 'azimuthal'
  | 'legendre'
  | 'zernike'
  | 'time'
  | 'weight'
  | 'collision'
  | 'delayedgroup';

export interface TallyFilter {
  type: TallyFilterType;
  bins?: number[];
  ids?: string[];
  label?: string;
}

export interface TallySensitivitySettings {
  enabled: boolean;
  nuclides: string[];
  scores: string[];
}

export interface TallyDefinition {
  id: string;
  name: string;
  scores: string[];
  targetNodeIds: string[];
  filters?: TallyFilter[];
  energyBins?: Quantity<EnergyUnit>[];
  nuclides?: string[];
  sensitivity?: TallySensitivitySettings;
}

export type MeshType = 'regular' | 'cylindrical' | 'rectilinear' | 'spherical' | 'unstructured';

export interface MeshDefinition {
  id: string;
  name: string;
  type: MeshType;
  dimension?: [number, number] | [number, number, number];
  lowerLeft?: [number, number] | [number, number, number];
  upperRight?: [number, number] | [number, number, number];
  width?: [number, number] | [number, number, number];
  // Rectilinear mesh specific
  xGrid?: number[];
  yGrid?: number[];
  zGrid?: number[];
  // Cylindrical/Spherical mesh specific
  rGrid?: number[];
  phiGrid?: number[];
  thetaGrid?: number[];
  // Unstructured mesh specific
  meshFile?: string;
  library?: 'moab' | 'libmesh';
}

export interface DepletionSettings {
  enabled: boolean;
  chainFile?: string;
  timesteps?: number[];
  timestepUnits?: 's' | 'd' | 'MWd/kg';
  power?: number;
  powerDensity?: number;
  sourceRate?: number;
  integrator?: 'cecm' | 'celi' | 'cf4' | 'epcrn4b' | 'leqi' | 'lognb' | 'si-ceci' | 'si-leqi';
  reactionRates?: string[];
}

export interface ThermalFeedbackMaterialMapping {
  materialId: string;
  temperature: number;
  thermalExpansionCoefficient?: number;
}

export interface ThermalFeedbackSettings {
  enabled: boolean;
  maxIterations: number;
  convergenceTolerance: number;
  updateStrategy?: 'fixed-point' | 'under-relaxation';
  relaxationFactor?: number;
  materialTemperatures: ThermalFeedbackMaterialMapping[];
}

export interface SimulationSettings {
  mode: 'eigenvalue' | 'fixed-source';
  particles: number;
  batches?: number;
  inactive?: number;
  plotBasis?: 'xy' | 'xz' | 'yz';
  temperature?: { default: number; method?: 'nearest' | 'interpolation'; multipole?: boolean; range?: [number, number] };
  thermalFeedback?: ThermalFeedbackSettings;
  crossSections?: { path?: string; library?: string };
  entropyMesh?: { dimension: [number, number]; lowerLeft: [number, number]; upperRight: [number, number] };
  depletion?: DepletionSettings;
  varianceReduction?: VarianceReductionSettings;
  mgxs?: MGXSSettings;
  stochasticVolume?: StochasticVolumeSettings;
  kinetics?: KineticsSettings;
  decaySource?: DecaySourceSettings;
  randomRay?: RandomRaySettings;
  cmfd?: CMFDSettings;
  photonTransport?: PhotonTransportSettings;
  cadImport?: CADImportSettings;
  mpi?: MPISettings;
  perturbation?: PerturbationSettings;
}

// ── Variance Reduction ──

export interface WeightWindowSettings {
  enabled: boolean;
  method?: 'manual' | 'magic' | 'fw-cadis';
  lowerBounds?: number[];
  upperBounds?: number[];
  energyBounds?: number[];
  meshId?: string;
  survivalRatio?: number;
  maxSplit?: number;
  weightCutoff?: number;
}

export interface SurvivalBiasingSettings {
  enabled: boolean;
  cutoff?: number;
  survivalMultiplier?: number;
}

export interface VarianceReductionSettings {
  weightWindows?: WeightWindowSettings;
  survivalBiasing?: SurvivalBiasingSettings;
  russianRoulette?: { enabled: boolean; weightThreshold?: number; survivalWeight?: number };
}

// ── Multi-Group Cross Sections ──

export interface EnergyGroupStructure {
  id?: string;
  name: string;
  boundaries: number[];
}

export interface MGXSSettings {
  enabled: boolean;
  libraryPath?: string;
  energyGroups?: EnergyGroupStructure;
  nuclides?: string[];
  domainType?: 'cell' | 'material' | 'universe';
  domainIds?: number[];
  scatterFormat?: 'legendre' | 'histogram';
  order?: number;
  temperature?: number;
}

// ── Stochastic Volume Calculation ──

export interface StochasticVolumeSettings {
  enabled: boolean;
  domainType?: 'cell' | 'material';
  domainIds?: number[];
  samples?: number;
  lowerLeft?: [number, number, number];
  upperRight?: [number, number, number];
}

// ── Kinetics Parameters ──

export interface KineticsSettings {
  enabled: boolean;
  method?: 'ifp' | 'adj';
  batches?: number;
  numGenerations?: number;
  timeAbsorption?: number;
}

// ── Decay Sources ──

export interface DecaySourceSettings {
  enabled: boolean;
  chains?: string[];
  timesteps?: number[];
  timestepUnits?: 's' | 'd' | 'h';
  particles?: number;
  sourceRate?: number;
}

// ── Random Ray Solver ──

export interface RandomRaySettings {
  enabled: boolean;
  rayLength?: number;
  raysPerCell?: number;
  sourceType?: 'flat' | 'linear';
  maxIterations?: number;
  convergenceTolerance?: number;
}

// ── CMFD Acceleration ──

export interface CMFDSettings {
  enabled: boolean;
  meshDimension?: [number, number, number];
  lowerLeft?: [number, number, number];
  upperRight?: [number, number, number];
  albedo?: [number, number, number, number, number, number];
  coarseGroupStructure?: number[];
  powerIteration?: { tolerance?: number; maxIterations?: number };
}

// ── Photon Transport ──

export interface PhotonTransportSettings {
  enabled: boolean;
  captureGamma?: boolean;
  electronTransport?: boolean;
  photonTransport?: boolean;
  pairProduction?: boolean;
  comptonScattering?: boolean;
  photoelectric?: boolean;
}

// ── CAD Import ──

export interface CADImportSettings {
  enabled: boolean;
  filePath?: string;
  format?: 'step' | 'stl' | 'brep';
  tolerance?: number;
}

// ── MPI Configuration ──

export interface MPISettings {
  enabled: boolean;
  processes?: number;
  threads?: number;
  domainDecomposition?: boolean;
  domains?: [number, number, number];
}

// ── Perturbation/Sensitivity ──

export interface PerturbationSettings {
  enabled: boolean;
  method?: 'ifp' | 'diff';
  nuclides?: string[];
  reactions?: string[];
  deltaK?: boolean;
  coefficients?: boolean;
}

// ── Statepoint Results ──

export interface StatepointResults {
  filePath: string;
  kEffective?: { value: number; uncertainty: number };
  tallies?: TallyResult[];
  entropy?: number[];
  sources?: SourceBank[];
  executionTime?: number;
  nParticles?: number;
  nBatches?: number;
  nInactive?: number;
}

export interface TallyResult {
  id: number;
  name?: string;
  scores: ScoreResult[];
  sum?: number;
  sumSquared?: number;
  mean?: number;
  variance?: number;
  uncertainty?: number;
}

export interface ScoreResult {
  score: string;
  value: number;
  uncertainty?: number;
  filterBins?: Record<string, number[]>;
}

export interface SourceBank {
  position: [number, number, number];
  direction: [number, number, number];
  energy: number;
  weight: number;
}

export interface PinCellRing {
  id: string;
  name: string;
  outerRadius: number;
  materialId: string;
  temperature?: number;
}

export interface PinCellType {
  id: string;
  name: string;
  rings: PinCellRing[];
  pitch: number;
  moderatorMaterialId?: string;
}

export interface AssemblyType {
  id: string;
  name: string;
  latticeKind: 'rect' | 'hex';
  rows: number;
  columns: number;
  pitch: number;
  pinMap: string[][];
  hexRings?: string[][];
  outerMaterialId?: string;
}

export interface CoreLayout {
  latticeKind: 'rect' | 'hex';
  rows: number;
  columns: number;
  assemblyPitch: number;
  assemblyMap: string[][];
  hexRings?: string[][];
  reflectorMaterialId?: string;
  vesselMaterialId?: string;
  vesselThickness?: number;
}

export interface ComponentRegistry {
  pinCellTypes: PinCellType[];
  assemblyTypes: AssemblyType[];
  coreLayout?: CoreLayout;
}

export interface ReactorModel {
  schemaVersion: 1;
  family: ReactorFamily;
  materials: MaterialLibrary;
  primitives: GeometryPrimitive[];
  openmcGeometry?: OpenMcGeometryModel;
  components?: ComponentRegistry;
  regions: BooleanRegion[];
  lattices: LatticeDefinition[];
  root: HierarchyNode;
  sources: SourceDefinition[];
  tallies: TallyDefinition[];
  meshes?: MeshDefinition[];
  settings: SimulationSettings;
}
