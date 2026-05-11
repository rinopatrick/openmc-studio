import type { ProjectBundle } from '@openmc-studio/schema';
import { invoke } from '@tauri-apps/api/core';

export async function saveProjectBundle(directory: string, bundle: ProjectBundle): Promise<void> {
  await invoke('save_project_bundle', {
    request: {
      directory,
      manifestJson: JSON.stringify(bundle.manifest, null, 2),
      modelJson: JSON.stringify(bundle.model, null, 2),
    },
  });
}

export async function loadProjectBundle(directory: string): Promise<ProjectBundle> {
  const result = await invoke<{ manifestJson: string; modelJson: string }>('load_project_bundle', {
    request: { directory },
  });

  return {
    manifest: JSON.parse(result.manifestJson) as ProjectBundle['manifest'],
    model: JSON.parse(result.modelJson) as ProjectBundle['model'],
  };
}
