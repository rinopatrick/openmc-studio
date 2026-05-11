import {
  createProjectBundle,
  createProjectFromPreset,
  generateOpenMcArtifacts,
  reactorPresets,
  validateModelBasics,
  type HierarchyNode,
  type ProjectBundle,
  type ReactorModel,
} from '@openmc-studio/schema';
import { useMemo, useState } from 'react';
import { create } from 'zustand';
import {
  detectOpenMcEnvironment,
  healthCheckOpenMc,
  generateOpenMcInputs,
  workerHandshake,
  type DetectEnvironmentResponse,
  type HealthCheckResponse,
  type OpenMcCandidate,
} from '../tauri/worker.js';
import { loadProjectBundle, saveProjectBundle } from '../tauri/projectStorage.js';
import { LatticeCanvas } from './LatticeCanvas.js';

type StudioStep = 'environment' | 'model' | 'validate' | 'run' | 'results';

interface StudioState {
  step: StudioStep;
  project: ProjectBundle;
  setStep: (step: StudioStep) => void;
  createProjectFromPreset: (presetId: string) => void;
  setProject: (project: ProjectBundle) => void;
  selectedCell?: string;
  setSelectedCell: (selectedCell: string) => void;
}

const useStudioState = create<StudioState>((set) => ({
  step: 'environment',
  project: createProjectBundle({
    id: 'scratch',
    name: 'Scratch Project',
    family: 'custom-irregular',
    now: new Date().toISOString(),
  }),
  setStep: (step) => set({ step }),
  setProject: (project) => set({ project }),
  setSelectedCell: (selectedCell) => set({ selectedCell }),
  createProjectFromPreset: (presetId) =>
    set({
      step: 'model',
      project: createProjectFromPreset({
        id: crypto.randomUUID(),
        name: reactorPresets.find((preset) => preset.id === presetId)?.name ?? 'OpenMC Project',
        presetId,
      }),
    }),
}));

const sampleModel: ReactorModel = {
  schemaVersion: 1,
  family: 'custom-irregular',
  materials: { materials: [] },
  primitives: [],
  regions: [],
  lattices: [],
  root: { id: 'root', name: 'Custom Reactor', role: 'core', children: [] },
  sources: [],
  tallies: [],
  settings: { mode: 'eigenvalue', particles: 1000, batches: 20, inactive: 5 },
};

export function App() {
  const { step, project, setStep } = useStudioState();
  const diagnostics = useMemo(() => validateModelBasics(project.model), [project]);

  return (
    <main className="studio-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">O</span>
          <div>
            <strong>OpenMC Studio</strong>
            <small>Generic reactor modeling</small>
          </div>
        </div>
        <nav>
          {(['environment', 'model', 'validate', 'run', 'results'] as StudioStep[]).map((item) => (
            <button key={item} className={item === step ? 'active' : ''} onClick={() => setStep(item)}>
              {labelForStep(item)}
            </button>
          ))}
        </nav>
      </aside>
      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Lightweight desktop foundation</p>
            <h1>{labelForStep(step)}</h1>
          </div>
          <span className="status-pill">{project.manifest.name}</span>
        </header>
        {step === 'environment' && <EnvironmentPanel />}
        {step === 'model' && <ModelPanel project={project} />}
        {step === 'validate' && <ValidationPanel diagnostics={diagnostics} />}
        {step === 'run' && <RunPanel project={project} />}
        {step === 'results' && <ResultsPanel />}
      </section>
    </main>
  );
}

function labelForStep(step: StudioStep): string {
  return {
    environment: 'Environment',
    model: 'Model Builder',
    validate: 'Validation',
    run: 'Run',
    results: 'Results',
  }[step];
}

function EnvironmentPanel() {
  const [isLoading, setIsLoading] = useState(false);
  const [workerStatus, setWorkerStatus] = useState<string>('Not checked');
  const [detected, setDetected] = useState<DetectEnvironmentResponse | null>(null);
  const [selectedCommand, setSelectedCommand] = useState<string[] | undefined>();
  const [health, setHealth] = useState<HealthCheckResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runDetection() {
    setIsLoading(true);
    setError(null);
    setHealth(null);

    try {
      const handshake = await workerHandshake();
      setWorkerStatus(handshake.ok ? 'Worker online' : `Worker unavailable: ${handshake.stderr || handshake.stdout}`);
      const response = await detectOpenMcEnvironment();
      setDetected(response);
      setSelectedCommand(response.candidates[0]?.command);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsLoading(false);
    }
  }

  async function runHealthCheck(command = selectedCommand) {
    setIsLoading(true);
    setError(null);

    try {
      setHealth(await healthCheckOpenMc(command));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section className="panel-grid">
      <article className="card hero-card">
        <p className="eyebrow">First launch workflow</p>
        <h2>Detect OpenMC without forcing users into a terminal.</h2>
        <p>
          The desktop shell will call the on-demand Python worker to detect PATH, Python module, conda, cross sections,
          and manual profiles.
        </p>
        <div className="action-row">
          <button className="primary-action" disabled={isLoading} onClick={runDetection}>
            {isLoading ? 'Checking...' : 'Detect OpenMC'}
          </button>
          <button className="secondary-action" disabled={isLoading || !selectedCommand} onClick={() => runHealthCheck()}>
            Run health check
          </button>
        </div>
        {error && <p className="error-text">{error}</p>}
      </article>
      <article className="card checklist">
        <h3>Environment status</h3>
        <div className="status-stack">
          <StatusLine label="Worker" value={workerStatus} ok={workerStatus === 'Worker online'} />
          <StatusLine label="Cross sections" value={detected?.crossSections ?? 'Not detected yet'} ok={Boolean(detected?.crossSections)} />
        </div>
        <CandidateList candidates={detected?.candidates ?? []} selectedCommand={selectedCommand} onSelect={setSelectedCommand} />
        {health && <HealthCheckList health={health} />}
      </article>
    </section>
  );
}

function StatusLine({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="status-line">
      <span>{label}</span>
      <strong className={ok ? 'good' : 'muted'}>{value}</strong>
    </div>
  );
}

function CandidateList({
  candidates,
  selectedCommand,
  onSelect,
}: {
  candidates: OpenMcCandidate[];
  selectedCommand?: string[];
  onSelect: (command: string[]) => void;
}) {
  if (candidates.length === 0) {
    return <p className="muted">No OpenMC candidates detected yet.</p>;
  }

  return (
    <div className="candidate-list">
      <h4>Detected candidates</h4>
      {candidates.map((candidate) => {
        const selected = selectedCommand?.join('\u0000') === candidate.command.join('\u0000');
        return (
          <button key={`${candidate.kind}-${candidate.command.join(' ')}`} className={selected ? 'candidate selected' : 'candidate'} onClick={() => onSelect(candidate.command)}>
            <span>{candidate.label}</span>
            <code>{candidate.command.join(' ')}</code>
          </button>
        );
      })}
    </div>
  );
}

function HealthCheckList({ health }: { health: HealthCheckResponse }) {
  return (
    <div className="health-list">
      <h4>Health checks</h4>
      {health.checks.map((check) => (
        <div key={check.id} className={check.ok ? 'health-check good-border' : 'health-check warn-border'}>
          <strong>{check.ok ? 'OK' : 'Check'}</strong>
          <span>{check.message}</span>
        </div>
      ))}
    </div>
  );
}

function ModelPanel({ project }: { project: ProjectBundle }) {
  const createPresetProject = useStudioState((state) => state.createProjectFromPreset);
  const setProject = useStudioState((state) => state.setProject);
  const selectedCell = useStudioState((state) => state.selectedCell);
  const setSelectedCell = useStudioState((state) => state.setSelectedCell);
  const lattice = project.model.lattices[0];
  const [projectDirectory, setProjectDirectory] = useState('');
  const [storageMessage, setStorageMessage] = useState<string | null>(null);

  async function saveProject() {
    if (!projectDirectory.trim()) {
      setStorageMessage('Enter a project directory first.');
      return;
    }

    try {
      await saveProjectBundle(projectDirectory.trim(), project);
      setStorageMessage('Project saved.');
    } catch (caught) {
      setStorageMessage(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function loadProject() {
    if (!projectDirectory.trim()) {
      setStorageMessage('Enter a project directory first.');
      return;
    }

    try {
      setProject(await loadProjectBundle(projectDirectory.trim()));
      setStorageMessage('Project loaded.');
    } catch (caught) {
      setStorageMessage(caught instanceof Error ? caught.message : String(caught));
    }
  }

  return (
    <section className="canvas-layout">
      <article className="card tree-card">
        <h3>Hierarchy</h3>
        <p className="muted">{project.model.family}</p>
        <div className="project-storage">
          <label htmlFor="project-dir">Project directory</label>
          <input
            id="project-dir"
            value={projectDirectory}
            onChange={(event) => setProjectDirectory(event.target.value)}
            placeholder="/home/user/openmc-project or C:\\Users\\..."
          />
          <div className="action-row compact">
            <button className="secondary-action" onClick={saveProject}>Save</button>
            <button className="secondary-action" onClick={loadProject}>Load</button>
          </div>
          {storageMessage && <p className="muted">{storageMessage}</p>}
        </div>
        <div className="preset-grid">
          {reactorPresets.map((preset) => (
            <button key={preset.id} className="preset-button" onClick={() => createPresetProject(preset.id)}>
              <strong>{preset.name}</strong>
              <span>{preset.description}</span>
            </button>
          ))}
        </div>
        <HierarchyTree node={project.model.root} />
      </article>
      <article className="card canvas-card">
        <div className="canvas-header">
          <h3>Top View</h3>
          <span>{project.model.lattices[0]?.kind ?? 'Freeform'} layout</span>
        </div>
        <LatticeCanvas lattice={lattice} view="top" selectedCell={selectedCell} onSelectCell={setSelectedCell} />
        <ModelSummary project={project} />
      </article>
      <article className="card canvas-card">
        <div className="canvas-header">
          <h3>Sectional View</h3>
          <span>Synced selection</span>
        </div>
        <LatticeCanvas lattice={lattice} view="section" selectedCell={selectedCell} onSelectCell={setSelectedCell} />
        <Inspector project={project} selectedCell={selectedCell} />
      </article>
    </section>
  );
}

function HierarchyTree({ node, depth = 0 }: { node: HierarchyNode; depth?: number }) {
  return (
    <div>
      <div className="tree-node" style={{ marginLeft: depth * 16 }}>
        <strong>{node.name}</strong>
        <span>{node.role}</span>
      </div>
      {node.children.map((child) => (
        <HierarchyTree key={child.id} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

function ModelSummary({ project }: { project: ProjectBundle }) {
  const lattice = project.model.lattices[0];

  return (
    <div className="model-summary">
      <span>{project.model.materials.materials.length} materials</span>
      <span>{lattice ? `${lattice.kind} lattice (${lattice.map.length} rows)` : 'no lattice'}</span>
      <span>{project.model.settings.mode}</span>
    </div>
  );
}

function Inspector({ project, selectedCell }: { project: ProjectBundle; selectedCell?: string }) {
  const lattice = project.model.lattices[0];
  const selectedLabel = selectedCell ? selectedCell.split('-').slice(2).join('-') || 'empty' : 'Nothing selected';

  return (
    <div className="inspector">
      <h4>Inspector</h4>
      <div className="status-line">
        <span>Selection</span>
        <strong>{selectedLabel}</strong>
      </div>
      <div className="status-line">
        <span>Lattice</span>
        <strong>{lattice?.name ?? 'None'}</strong>
      </div>
      <div className="status-line">
        <span>Physics</span>
        <strong>{project.model.settings.mode}</strong>
      </div>
    </div>
  );
}

function ValidationPanel({ diagnostics }: { diagnostics: ReturnType<typeof validateModelBasics> }) {
  return (
    <section className="card">
      <h2>Geometry + physics sanity checks</h2>
      <p>Validation starts with model linkage, then expands to geometry integrity and physics guardrails.</p>
      <div className="diagnostic-list">
        {diagnostics.length === 0 ? (
          <span className="status-pill success">No diagnostics</span>
        ) : (
          diagnostics.map((diagnostic) => (
            <div key={`${diagnostic.id}-${diagnostic.nodeId ?? 'global'}`} className="diagnostic">
              <strong>{diagnostic.severity.toUpperCase()}</strong>
              <span>{diagnostic.message}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function RunPanel({ project }: { project: ProjectBundle }) {
  const artifacts = useMemo(() => generateOpenMcArtifacts(project.model), [project]);
  const [projectDir, setProjectDir] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  async function writeInputs() {
    if (!projectDir.trim()) {
      setMessage('Enter a saved project directory first.');
      return;
    }

    try {
      await saveProjectBundle(projectDir.trim(), project);
      const result = await generateOpenMcInputs(projectDir.trim());
      setMessage(`Generated ${result.files.join(', ')} in ${result.generatedDir}`);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : String(caught));
    }
  }

  return (
    <section className="panel-grid">
      <article className="card hero-card">
        <p className="eyebrow">Run orchestration</p>
        <h2>Generated OpenMC artifacts are now traceable from the GUI model.</h2>
        <p>Next step: write these files into the project `generated` folder and launch OpenMC through the worker.</p>
        <div className="project-storage">
          <label htmlFor="run-project-dir">Project directory</label>
          <input id="run-project-dir" value={projectDir} onChange={(event) => setProjectDir(event.target.value)} placeholder="Project folder to write generated inputs" />
          <button className="primary-action" onClick={writeInputs}>Write generated OpenMC inputs</button>
          {message && <p className="muted">{message}</p>}
        </div>
      </article>
      <article className="card artifact-preview">
        <h3>settings.xml preview</h3>
        <pre>{artifacts.settingsXml}</pre>
        <h3>materials.xml preview</h3>
        <pre>{artifacts.materialsXml.slice(0, 900)}</pre>
      </article>
    </section>
  );
}

function ResultsPanel() {
  return (
    <section className="panel-grid">
      <article className="card">
        <h3>Eigenvalue metrics</h3>
        <p>k-eff trend, rolling sigma, entropy stabilization, and convergence score.</p>
      </article>
      <article className="card">
        <h3>Fixed-source metrics</h3>
        <p>Attenuation, transmission, flux ratios, hotspot summary, and dose-proxy index.</p>
      </article>
    </section>
  );
}
