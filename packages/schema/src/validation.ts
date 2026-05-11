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

  walkNode(model.root, (node) => {
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
