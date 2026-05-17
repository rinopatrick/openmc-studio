import type { ProjectBundle } from '@openmc-studio/schema';
import { invoke } from '@tauri-apps/api/core';

function canUseTauriInvoke(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function previewStorageKey(directory: string): string {
  return `openmc:project-bundle:${directory}`;
}

export async function saveProjectBundle(directory: string, bundle: ProjectBundle): Promise<void> {
  if (!canUseTauriInvoke()) {
    localStorage.setItem(previewStorageKey(directory), JSON.stringify(bundle));
    return;
  }

  await invoke('save_project_bundle', {
    request: {
      directory,
      manifestJson: JSON.stringify(bundle.manifest, null, 2),
      modelJson: JSON.stringify(bundle.model, null, 2),
    },
  });
}

export async function loadProjectBundle(directory: string): Promise<ProjectBundle> {
  if (!canUseTauriInvoke()) {
    const raw = localStorage.getItem(previewStorageKey(directory));
    if (!raw) {
      throw new Error('Browser preview mode: no saved project bundle for this directory.');
    }
    return JSON.parse(raw) as ProjectBundle;
  }

  const result = await invoke<{ manifestJson: string; modelJson: string }>('load_project_bundle', {
    request: { directory },
  });

  return {
    manifest: JSON.parse(result.manifestJson) as ProjectBundle['manifest'],
    model: JSON.parse(result.modelJson) as ProjectBundle['model'],
  };
}
