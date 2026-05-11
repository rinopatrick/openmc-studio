import type { MaterialDefinition, ReactorModel } from './model.js';

export interface OpenMcArtifacts {
  materialsXml: string;
  geometryXml: string;
  settingsXml: string;
  talliesXml: string;
}

export function generateOpenMcArtifacts(model: ReactorModel): OpenMcArtifacts {
  return {
    materialsXml: generateMaterialsXml(model.materials.materials),
    geometryXml: generateGeometryXml(model),
    settingsXml: generateSettingsXml(model),
    talliesXml: generateTalliesXml(model),
  };
}

function generateMaterialsXml(materials: MaterialDefinition[]): string {
  const body = materials
    .map((material, index) => {
      const nuclides = material.nuclides
        .map((nuclide) => `    <nuclide name="${escapeXml(nuclide.name)}" ${nuclide.fractionType === 'atom' ? 'ao' : 'wo'}="${nuclide.fraction}" />`)
        .join('\n');

      return [
        `  <material id="${index + 1}" name="${escapeXml(material.name)}">`,
        `    <density value="${material.density.value}" units="${escapeXml(material.density.unit)}" />`,
        nuclides,
        '  </material>',
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n');

  return xmlDocument('materials', body);
}

function generateGeometryXml(model: ReactorModel): string {
  const rootName = escapeXml(model.root.name);
  const comment = `  <!-- Geometry preview for ${rootName}. Full CSG generation will expand hierarchy/lattices deterministically. -->`;
  const cells = collectNodeNames(model)
    .map((name, index) => `  <cell id="${index + 1}" name="${escapeXml(name)}" />`)
    .join('\n');

  return xmlDocument('geometry', [comment, cells].join('\n'));
}

function generateSettingsXml(model: ReactorModel): string {
  const lines = [`  <run_mode>${model.settings.mode === 'fixed-source' ? 'fixed source' : 'eigenvalue'}</run_mode>`, `  <particles>${model.settings.particles}</particles>`];
  if (model.settings.batches) lines.push(`  <batches>${model.settings.batches}</batches>`);
  if (model.settings.inactive) lines.push(`  <inactive>${model.settings.inactive}</inactive>`);
  return xmlDocument('settings', lines.join('\n'));
}

function generateTalliesXml(model: ReactorModel): string {
  const body = model.tallies
    .map((tally, index) => [
      `  <tally id="${index + 1}" name="${escapeXml(tally.name)}">`,
      `    <scores>${tally.scores.map(escapeXml).join(' ')}</scores>`,
      '  </tally>',
    ].join('\n'))
    .join('\n');

  return xmlDocument('tallies', body);
}

function collectNodeNames(model: ReactorModel): string[] {
  const names: string[] = [];
  const visit = (node: ReactorModel['root']) => {
    names.push(node.name);
    node.children.forEach(visit);
  };
  visit(model.root);
  return names;
}

function xmlDocument(root: string, body: string): string {
  return [`<?xml version="1.0" encoding="UTF-8"?>`, `<${root}>`, body, `</${root}>`].join('\n');
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
