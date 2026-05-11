import type { ProjectManifest, ReactorFamily, ReactorModel, UnitPresetName } from './model.js';

export interface CreateProjectOptions {
  id: string;
  name: string;
  family: ReactorFamily;
  defaultUnits?: UnitPresetName;
  now?: string;
}

export interface ProjectBundle {
  manifest: ProjectManifest;
  model: ReactorModel;
}

export function createProjectBundle(options: CreateProjectOptions): ProjectBundle {
  const now = options.now ?? new Date().toISOString();
  const defaultUnits = options.defaultUnits ?? 'nuclear-common';

  return {
    manifest: {
      schemaVersion: 1,
      id: options.id,
      name: options.name,
      createdAt: now,
      updatedAt: now,
      defaultUnits,
      reactorFamily: options.family,
      modelPath: 'model/model.json',
    },
    model: createEmptyReactorModel(options.family),
  };
}

export function createEmptyReactorModel(family: ReactorFamily): ReactorModel {
  const fixedSource = family === 'shielding-fixed-source';

  return {
    schemaVersion: 1,
    family,
    materials: { materials: [] },
    primitives: [],
    regions: [],
    lattices: [],
    root: {
      id: 'root',
      name: fixedSource ? 'Shielding Model' : 'Reactor Model',
      role: fixedSource ? 'shield' : 'core',
      children: [],
    },
    sources: [],
    tallies: [],
    settings: fixedSource
      ? { mode: 'fixed-source', particles: 10_000 }
      : { mode: 'eigenvalue', particles: 10_000, batches: 100, inactive: 20 },
  };
}

export function serializeProjectBundle(bundle: ProjectBundle): string {
  return JSON.stringify(bundle, null, 2);
}

export function parseProjectBundle(serialized: string): ProjectBundle {
  const parsed = JSON.parse(serialized) as ProjectBundle;
  assertProjectBundle(parsed);
  return parsed;
}

export function assertProjectBundle(value: ProjectBundle): void {
  if (value.manifest.schemaVersion !== 1 || value.model.schemaVersion !== 1) {
    throw new Error('Unsupported project schema version.');
  }

  if (value.manifest.reactorFamily !== value.model.family) {
    throw new Error('Project manifest reactor family does not match model family.');
  }

  if (!value.manifest.id || !value.manifest.name) {
    throw new Error('Project manifest must define id and name.');
  }
}
