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

  for (const tally of model.tallies) {
    if (tally.scores.length === 0) {
      diagnostics.push({
        id: 'tally-without-scores',
        severity: 'error',
        message: `Tally "${tally.name}" has no scores.`,
        suggestedFix: 'Select at least one score such as flux or fission.',
      });
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

  return diagnostics;
}

function walkNode(node: ReactorModel['root'], visit: (node: ReactorModel['root']) => void): void {
  visit(node);
  for (const child of node.children) {
    walkNode(child, visit);
  }
}
