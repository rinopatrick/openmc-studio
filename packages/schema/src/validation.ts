import type { ReactorModel } from './model.js';

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  id: string;
  severity: DiagnosticSeverity;
  message: string;
  nodeId?: string;
  suggestedFix?: string;
}

export function validateModelBasics(model: ReactorModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const materialIds = new Set(model.materials.materials.map((material) => material.id));
  const surfaceOpenMcIds = new Set(model.openmcGeometry?.surfaces.map((surface) => surface.openmcId) ?? []);
  const regionIds = new Set(model.regions.map((region) => region.id));
  const latticeIds = new Set(model.lattices.map((lattice) => lattice.id));
  const nodeIds = new Set<string>();

  walkNode(model.root, (node) => {
    if (nodeIds.has(node.id)) {
      diagnostics.push({
        id: 'duplicate-node-id',
        severity: 'error',
        nodeId: node.id,
        message: `Node id "${node.id}" is used more than once.`,
        suggestedFix: 'Give each hierarchy node a unique id.',
      });
    }
    nodeIds.add(node.id);

    if (node.materialId && !materialIds.has(node.materialId)) {
      diagnostics.push({
        id: 'missing-material',
        severity: 'error',
        nodeId: node.id,
        message: `Node "${node.name}" references a material that does not exist.`,
        suggestedFix: 'Assign an existing material or create a new material entry.',
      });
    }

    if (node.regionId && !regionIds.has(node.regionId)) {
      diagnostics.push({
        id: 'missing-region',
        severity: 'error',
        nodeId: node.id,
        message: `Node "${node.name}" references a geometry region that does not exist.`,
        suggestedFix: 'Bind the node to an existing region or define its region.',
      });
    }

    if (node.latticeId && !latticeIds.has(node.latticeId)) {
      diagnostics.push({
        id: 'missing-lattice',
        severity: 'error',
        nodeId: node.id,
        message: `Node "${node.name}" references a lattice that does not exist.`,
        suggestedFix: 'Bind the node to an existing lattice or define its lattice.',
      });
    }
  });

  for (const material of model.materials.materials) {
    if (!Number.isFinite(material.density.value) || material.density.value <= 0) {
      diagnostics.push({
        id: 'invalid-density',
        severity: 'error',
        message: `Material "${material.name}" has invalid density.`,
        suggestedFix: 'Use a positive density value and check the selected unit.',
      });
    }

    if (material.nuclides.length === 0) {
      diagnostics.push({
        id: 'material-without-nuclides',
        severity: 'warning',
        message: `Material "${material.name}" has no nuclides.`,
        suggestedFix: 'Add at least one nuclide before generating OpenMC inputs.',
      });
    }
  }

  for (const lattice of model.lattices) {
    if (lattice.map.length === 0 || lattice.map.every((row) => row.length === 0)) {
      diagnostics.push({
        id: 'empty-lattice',
        severity: 'error',
        message: `Lattice "${lattice.name}" has no cells.`,
        suggestedFix: 'Add at least one row and one cell to the lattice map.',
      });
    }

    if ((lattice.kind === 'rect' || lattice.kind === 'hex') && !lattice.pitch) {
      diagnostics.push({
        id: 'missing-lattice-pitch',
        severity: 'warning',
        message: `Lattice "${lattice.name}" has no pitch.`,
        suggestedFix: 'Define pitch so generated geometry has physical scale.',
      });
    }
  }

  for (const cell of model.openmcGeometry?.cells ?? []) {
    if (!cell.region.trim()) {
      diagnostics.push({
        id: 'csg-cell-region-empty',
        severity: 'error',
        message: `OpenMC cell "${cell.name}" has empty region expression.`,
        suggestedFix: 'Define a valid Boolean region expression for the cell.',
      });
      continue;
    }

    if (cell.materialId && !materialIds.has(cell.materialId)) {
      diagnostics.push({
        id: 'csg-cell-missing-material',
        severity: 'error',
        message: `OpenMC cell "${cell.name}" references a missing material.`,
        suggestedFix: 'Assign an existing material or make the cell void.',
      });
    }

    for (const surfaceId of referencedSurfaceIds(cell.region)) {
      if (!surfaceOpenMcIds.has(surfaceId)) {
        diagnostics.push({
          id: 'csg-region-missing-surface',
          severity: 'error',
          message: `OpenMC cell "${cell.name}" region references missing surface ${surfaceId}.`,
          suggestedFix: 'Create the surface or fix the Boolean region expression.',
        });
      }
    }
  }

  const periodicSurfaces = (model.openmcGeometry?.surfaces ?? []).filter((surface) => surface.boundary === 'periodic');
  if (periodicSurfaces.length === 1) {
    diagnostics.push({
      id: 'periodic-boundary-unpaired',
      severity: 'warning',
      message: 'Exactly one periodic boundary surface found. Periodic boundaries normally require a paired surface.',
      suggestedFix: 'Add a matching periodic surface or switch boundary type.',
    });
  }

  const seenSurfaceIds = new Set<number>();
  for (const surface of model.openmcGeometry?.surfaces ?? []) {
    if (seenSurfaceIds.has(surface.openmcId)) {
      diagnostics.push({
        id: 'csg-surface-id-duplicate',
        severity: 'error',
        message: `Duplicate OpenMC surface id ${surface.openmcId}.`,
        suggestedFix: 'Use unique surface IDs in the CSG editor.',
      });
    }
    seenSurfaceIds.add(surface.openmcId);

    if (!surface.coeffs.length || surface.coeffs.some((value) => !Number.isFinite(value))) {
      diagnostics.push({
        id: 'csg-surface-coeff-invalid',
        severity: 'error',
        message: `Surface "${surface.name}" has invalid coefficients.`,
        suggestedFix: 'Provide numeric coefficients for the selected surface type.',
      });
    }
  }

  for (const tally of model.tallies) {
    if (tally.scores.length === 0) {
      diagnostics.push({
        id: 'tally-without-scores',
        severity: 'error',
        message: `Tally "${tally.name}" has no scores.`,
        suggestedFix: 'Select at least one score such as flux or fission.',
      });
    }

    for (const filter of tally.filters ?? []) {
      if (filter.type === 'energy') {
        if (!filter.bins || filter.bins.length < 2 || filter.bins.some((bin) => !Number.isFinite(bin))) {
          diagnostics.push({
            id: 'tally-energy-filter-invalid',
            severity: 'error',
            message: `Tally "${tally.name}" has invalid energy filter bins.`,
            suggestedFix: 'Provide at least 2 numeric bin edges.',
          });
        }
      }

      if (filter.type === 'mesh') {
        const dim = filter.ids?.[0]?.trim();
        const low = filter.ids?.[1]?.trim();
        const up = filter.ids?.[2]?.trim();
        if (!dim || !low || !up) {
          diagnostics.push({
            id: 'tally-mesh-filter-incomplete',
            severity: 'error',
            message: `Tally "${tally.name}" has incomplete mesh filter definition.`,
            suggestedFix: 'Fill dimension, lower_left, and upper_right.',
          });
        }
      }

      if (filter.type === 'cell' || filter.type === 'material' || filter.type === 'surface' || filter.type === 'universe') {
        const bins = filter.ids?.join(' ').trim() ?? '';
        if (!bins) {
          diagnostics.push({
            id: 'tally-id-filter-empty',
            severity: 'error',
            message: `Tally "${tally.name}" has empty ${filter.type} filter bins.`,
            suggestedFix: 'Provide one or more integer IDs separated by spaces.',
          });
        }
      }
    }

    if (tally.sensitivity?.enabled) {
      if (!tally.sensitivity.nuclides.length) {
        diagnostics.push({
          id: 'tally-sensitivity-nuclides-empty',
          severity: 'error',
          message: `Tally "${tally.name}" has sensitivity enabled but no nuclides selected.`,
          suggestedFix: 'Select at least one nuclide for sensitivity derivatives.',
        });
      }
      if (!tally.sensitivity.scores.length) {
        diagnostics.push({
          id: 'tally-sensitivity-scores-empty',
          severity: 'error',
          message: `Tally "${tally.name}" has sensitivity enabled but no sensitivity scores selected.`,
          suggestedFix: 'Select at least one score for sensitivity derivatives.',
        });
      }
    }

    for (const targetNodeId of tally.targetNodeIds) {
      if (!nodeIds.has(targetNodeId)) {
        diagnostics.push({
          id: 'tally-target-missing',
          severity: 'error',
          message: `Tally "${tally.name}" targets missing node "${targetNodeId}".`,
          suggestedFix: 'Point the tally to an existing hierarchy node.',
        });
      }
    }
  }

  for (const source of model.sources) {
    if (source.regionId && !regionIds.has(source.regionId)) {
      diagnostics.push({
        id: 'source-region-missing',
        severity: 'error',
        message: `Source "${source.name}" references a missing region.`,
        suggestedFix: 'Bind the source to an existing region or leave it spatially defined.',
      });
    }
  }

  if (model.settings.mode === 'fixed-source' && model.sources.length === 0) {
    diagnostics.push({
      id: 'fixed-source-without-source',
      severity: 'error',
      message: 'Fixed-source mode requires at least one source definition.',
      suggestedFix: 'Add a point, box, cylindrical, distributed, or custom source.',
    });
  }

  if (model.settings.mode === 'eigenvalue' && model.sources.length > 0) {
    diagnostics.push({
      id: 'eigenvalue-explicit-source',
      severity: 'info',
      message: 'Eigenvalue mode normally uses fission source iteration. Explicit sources may be ignored or advanced-use only.',
    });
  }

  if (model.settings.mode === 'eigenvalue' && (!model.settings.batches || !model.settings.inactive)) {
    diagnostics.push({
      id: 'eigenvalue-settings-incomplete',
      severity: 'warning',
      message: 'Eigenvalue mode should define batches and inactive batches.',
      suggestedFix: 'Set batches and inactive batches before running production simulations.',
    });
  }

  if (model.settings.particles < 100) {
    diagnostics.push({
      id: 'particles-too-low',
      severity: 'warning',
      message: 'Particles per batch/source are very low. Results may be too noisy.',
      suggestedFix: 'Increase particles for meaningful results after quick smoke tests.',
    });
  }

  // ── Variance Reduction Validation ──
  const vr = model.settings.varianceReduction;
  if (vr?.weightWindows?.enabled) {
    const ww = vr.weightWindows;
    if (!ww.method) {
      diagnostics.push({
        id: 'ww-method-missing',
        severity: 'warning',
        message: 'Weight windows enabled but no method specified.',
        suggestedFix: 'Select a method: manual, magic, or fw-cadis.',
      });
    }
    if (ww.method === 'manual' && (!ww.lowerBounds?.length || !ww.upperBounds?.length)) {
      diagnostics.push({
        id: 'ww-bounds-missing',
        severity: 'error',
        message: 'Manual weight windows require lower and upper bounds.',
        suggestedFix: 'Provide lower_bounds and upper_bounds arrays.',
      });
    }
  }

  if (vr?.survivalBiasing?.enabled) {
    const sb = vr.survivalBiasing;
    if (sb.cutoff !== undefined && (sb.cutoff < 0 || sb.cutoff > 1)) {
      diagnostics.push({
        id: 'sb-cutoff-invalid',
        severity: 'error',
        message: 'Survival biasing cutoff must be between 0 and 1.',
        suggestedFix: 'Set cutoff to a value like 0.25.',
      });
    }
  }

  // ── MGXS Validation ──
  if (model.settings.mgxs?.enabled) {
    const mgxs = model.settings.mgxs;
    if (!mgxs.libraryPath && !mgxs.energyGroups) {
      diagnostics.push({
        id: 'mgxs-no-source',
        severity: 'error',
        message: 'MGXS enabled but no library path or energy groups defined.',
        suggestedFix: 'Provide either a library path or define energy group structure.',
      });
    }
    if (mgxs.energyGroups && mgxs.energyGroups.boundaries.length < 2) {
      diagnostics.push({
        id: 'mgxs-insufficient-groups',
        severity: 'error',
        message: 'Energy group structure must have at least 2 boundaries.',
        suggestedFix: 'Add energy boundaries like [0.0, 0.625e-6, 20.0e6].',
      });
    }
  }

  // ── Stochastic Volume Validation ──
  if (model.settings.stochasticVolume?.enabled) {
    const sv = model.settings.stochasticVolume;
    if (!sv.domainType || !sv.domainIds?.length) {
      diagnostics.push({
        id: 'sv-no-domain',
        severity: 'error',
        message: 'Stochastic volume requires domain type and IDs.',
        suggestedFix: 'Specify domain_type (cell/material) and domain_ids.',
      });
    }
    if (sv.samples && sv.samples < 1000) {
      diagnostics.push({
        id: 'sv-low-samples',
        severity: 'warning',
        message: 'Stochastic volume samples very low. Results may be inaccurate.',
        suggestedFix: 'Use at least 10000 samples for reliable results.',
      });
    }
  }

  // ── CMFD Validation ──
  if (model.settings.cmfd?.enabled) {
    const cmfd = model.settings.cmfd;
    if (!cmfd.meshDimension) {
      diagnostics.push({
        id: 'cmfd-no-mesh',
        severity: 'error',
        message: 'CMFD enabled but no mesh dimension specified.',
        suggestedFix: 'Define mesh_dimension for the CMFD grid.',
      });
    }
  }

  // ── MPI Validation ──
  if (model.settings.mpi?.enabled) {
    const mpi = model.settings.mpi;
    if (!mpi.processes && !mpi.threads) {
      diagnostics.push({
        id: 'mpi-no-parallelism',
        severity: 'warning',
        message: 'MPI enabled but no processes or threads specified.',
        suggestedFix: 'Set processes or threads for parallel execution.',
      });
    }
  }

  // ── Random Ray Validation ──
  if (model.settings.randomRay?.enabled) {
    const rr = model.settings.randomRay;
    if (rr.rayLength && rr.rayLength <= 0) {
      diagnostics.push({
        id: 'rr-invalid-length',
        severity: 'error',
        message: 'Random ray length must be positive.',
        suggestedFix: 'Set a positive ray length in cm.',
      });
    }
  }

  const thermalFeedback = model.settings.thermalFeedback;
  if (thermalFeedback?.enabled) {
    if (!Number.isFinite(thermalFeedback.maxIterations) || thermalFeedback.maxIterations < 1) {
      diagnostics.push({
        id: 'thermal-feedback-max-iterations-invalid',
        severity: 'error',
        message: 'Thermal feedback max iterations must be at least 1.',
        suggestedFix: 'Set max iterations to a positive integer.',
      });
    }
    if (!Number.isFinite(thermalFeedback.convergenceTolerance) || thermalFeedback.convergenceTolerance <= 0) {
      diagnostics.push({
        id: 'thermal-feedback-convergence-invalid',
        severity: 'error',
        message: 'Thermal feedback convergence tolerance must be > 0.',
        suggestedFix: 'Use a small positive tolerance such as 1e-5.',
      });
    }
    for (const mapping of thermalFeedback.materialTemperatures) {
      if (!materialIds.has(mapping.materialId)) {
        diagnostics.push({
          id: 'thermal-feedback-material-missing',
          severity: 'error',
          message: `Thermal feedback mapping references missing material "${mapping.materialId}".`,
          suggestedFix: 'Map temperatures only to existing materials.',
        });
      }
      if (!Number.isFinite(mapping.temperature)) {
        diagnostics.push({
          id: 'thermal-feedback-temperature-invalid',
          severity: 'error',
          message: `Thermal feedback temperature for material "${mapping.materialId}" is invalid.`,
          suggestedFix: 'Provide a numeric material temperature in kelvin.',
        });
      }
    }
  }

  return diagnostics;
}

function referencedSurfaceIds(region: string): number[] {
  const matches = region.match(/[+-]?\d+/g) ?? [];
  return matches.map((match) => Math.abs(Number(match))).filter((value) => Number.isInteger(value));
}

function walkNode(node: ReactorModel['root'], visit: (node: ReactorModel['root']) => void): void {
  visit(node);
  for (const child of node.children) {
    walkNode(child, visit);
  }
}
