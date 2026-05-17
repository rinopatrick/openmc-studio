import React, { lazy, Suspense } from 'react';
import {
  createProjectBundle,
  createProjectFromPreset,
  generateOpenMcArtifacts,
  materialLibrary,
  reactorPresets,
  searchNuclides,
  validateModelBasics,
  type AssemblyType,
  type ComponentRegistry,
  type HierarchyNode,
  type LatticeDefinition,
  type PinCellType,
  type ProjectBundle,
  type ReactorFamily,
  type ReactorModel,
} from '@openmc-studio/schema';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { create } from 'zustand';
import {
  detectOpenMcEnvironment,
  getWorkerPython,
  healthCheckOpenMc,
  setWorkerPython,
  generateOpenMcInputs,
  listRunHistory,
  exportProofPack,
  exportSubmissionBundle,
  generateMimoDraft,
  liveRunStatus,
  listProofPacks,
  renderOpenMcPlot,
  runOpenMc,
  runStochasticVolume,
  summarizeStatepoint,
  summarizeStatepointFile,
  summarizeDepletion,
  summarizeTallySpectrum,
  summarizeResults,
  workerHandshake,
  type DetectEnvironmentResponse,
  type HealthCheckResponse,
  type OpenMcCandidate,
  type RunHistoryEntry,
  type StatepointSummary,
  type DepletionSummary,
  type TallySpectrumData,
  type ProofPackEntry,
  type StochasticVolumeResult,
} from '../tauri/worker.js';
import { loadProjectBundle, saveProjectBundle } from '../tauri/projectStorage.js';
import { LatticeCanvas } from './LatticeCanvas.js';
const Geometry3DViewer = lazy(() => import('./Geometry3DViewer.js').then(m => ({ default: m.Geometry3DViewer })));

interface ModelDiffEntry {
  path: string;
  type: 'added' | 'removed' | 'changed';
  before?: string;
  after?: string;
}

function diffProjectBundle(a: ProjectBundle, b: ProjectBundle): ModelDiffEntry[] {
  const entries: ModelDiffEntry[] = [];
  const aStr = JSON.stringify(a.model);
  const bStr = JSON.stringify(b.model);
  if (aStr === bStr) return [];

  function walk(objA: unknown, objB: unknown, prefix: string) {
    if (JSON.stringify(objA) === JSON.stringify(objB)) return;
    if (objA === null || objB === null || typeof objA !== 'object' || typeof objB !== 'object') {
      entries.push({ path: prefix, type: 'changed', before: String(objA ?? 'undefined'), after: String(objB ?? 'undefined') });
      return;
    }
    const keysA = Object.keys(objA as Record<string, unknown>);
    const keysB = Object.keys(objB as Record<string, unknown>);
    const allKeys = new Set([...keysA, ...keysB]);
    for (const key of allKeys) {
      const childA = (objA as Record<string, unknown>)[key];
      const childB = (objB as Record<string, unknown>)[key];
      if (!(key in (objA as Record<string, unknown>))) entries.push({ path: `${prefix}.${key}`, type: 'added', after: JSON.stringify(childB) });
      else if (!(key in (objB as Record<string, unknown>))) entries.push({ path: `${prefix}.${key}`, type: 'removed', before: JSON.stringify(childA) });
      else walk(childA, childB, `${prefix}.${key}`);
    }
  }
  walk(a.model, b.model, 'model');
  return entries;
}

type StudioStep = 'environment' | 'model' | 'validate' | 'run' | 'results';
type ModelingIntent = 'core' | 'assembly' | 'shielding' | 'custom' | 'import';
type LayoutMode = 'circular-core' | 'rect-lattice' | 'hex-lattice' | 'freeform' | 'layer-stack';
type PaintTool = 'fuel' | 'reflector' | 'moderator' | 'control' | 'source' | 'tally' | 'void';

const OPENMC_LAST_RUN_KEY = 'openmc:last-run';
const OPENMC_RUN_COMPLETE_EVENT = 'openmc:run-complete';

function safeRandomUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

interface StudioState {
  step: StudioStep;
  project: ProjectBundle;
  undoStack: ProjectBundle[];
  redoStack: ProjectBundle[];
  setStep: (step: StudioStep) => void;
  createProjectFromPreset: (presetId: string) => void;
  createVisualProject: (intent: ModelingIntent, mode: LayoutMode) => void;
  setProject: (project: ProjectBundle) => void;
  undo: () => void;
  redo: () => void;
  selectedCell?: string;
  setSelectedCell: (selectedCell: string) => void;
}

const initialProject = createProjectBundle({
  id: 'scratch',
  name: 'Scratch Project',
  family: 'custom-irregular',
  now: new Date().toISOString(),
});

const useStudioState = create<StudioState>((set, get) => ({
  step: 'model',
  project: initialProject,
  undoStack: [],
  redoStack: [],
  setStep: (step) => set({ step }),
  setProject: (project) => {
    const prev = get().project;
    if (JSON.stringify(prev) !== JSON.stringify(project)) {
      set({ undoStack: [...get().undoStack, prev].slice(-100), redoStack: [], project });
    }
  },
  setSelectedCell: (selectedCell) => set({ selectedCell }),
  createProjectFromPreset: (presetId) => {
    const project = createProjectFromPreset({
      id: safeRandomUUID(),
      name: reactorPresets.find((preset) => preset.id === presetId)?.name ?? 'OpenMC Project',
      presetId,
    });
    const prev = get().project;
    set({ undoStack: [...get().undoStack, prev].slice(-100), redoStack: [], project, step: 'model' });
  },
  createVisualProject: (intent, mode) => {
    const project = createVisualProjectBundle(intent, mode);
    const prev = get().project;
    set({ undoStack: [...get().undoStack, prev].slice(-100), redoStack: [], project, step: 'model', selectedCell: undefined });
  },
  undo: () => {
    const state = get();
    if (state.undoStack.length === 0) return;
    const prevProject = state.undoStack[state.undoStack.length - 1];
    const newUndoStack = state.undoStack.slice(0, -1);
    set({ undoStack: newUndoStack, redoStack: [...state.redoStack, state.project], project: prevProject });
  },
  redo: () => {
    const state = get();
    if (state.redoStack.length === 0) return;
    const nextProject = state.redoStack[state.redoStack.length - 1];
    const newRedoStack = state.redoStack.slice(0, -1);
    set({ undoStack: [...state.undoStack, state.project], redoStack: newRedoStack, project: nextProject });
  },
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
  const { step, project, setStep, undo, redo, undoStack, redoStack } = useStudioState();
  const diagnostics = useMemo(() => validateModelBasics(project.model), [project]);
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo]);

  useEffect(() => {
    const handleRunComplete = () => setStep('results');
    window.addEventListener(OPENMC_RUN_COMPLETE_EVENT, handleRunComplete as EventListener);
    return () => window.removeEventListener(OPENMC_RUN_COMPLETE_EVENT, handleRunComplete as EventListener);
  }, [setStep]);

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
          <div className="topbar-actions">
            <button className="mini-action" disabled={undoStack.length === 0} onClick={undo} title="Undo (Ctrl+Z)">↶ Undo</button>
            <button className="mini-action" disabled={redoStack.length === 0} onClick={redo} title="Redo (Ctrl+Y)">↷ Redo</button>
          </div>
          <span className="status-pill">{project.manifest.name}</span>
        </header>
        {step === 'environment' && <EnvironmentPanel />}
        {step === 'model' && <ModelPanel project={project} />}
        {step === 'validate' && <ValidationPanel diagnostics={diagnostics} />}
        {step === 'run' && <RunPanel project={project} />}
        {step === 'results' && <ResultsPanel project={project} />}
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
  const [workerPythonPath, setWorkerPythonPath] = useState('');
  const [workerPythonStatus, setWorkerPythonStatus] = useState('Default interpreter (python3/python)');

  useEffect(() => {
    let active = true;
    getWorkerPython()
      .then((value) => {
        if (!active) return;
        const resolved = value ?? '';
        setWorkerPythonPath(resolved);
        setWorkerPythonStatus(resolved ? `Custom: ${resolved}` : 'Default interpreter (python3/python)');
      })
      .catch(() => {
        if (!active) return;
        setWorkerPythonStatus('Default interpreter (python3/python)');
      });

    return () => {
      active = false;
    };
  }, []);

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

      const pythonCandidate = response.candidates.find((candidate) => candidate.kind === 'python-module' && candidate.command.length > 0);
      const pythonPath = pythonCandidate?.command?.[0]?.trim();
      if (pythonPath) {
        const resolved = await setWorkerPython(pythonPath);
        setWorkerPythonPath(pythonPath);
        setWorkerPythonStatus(`Auto-detected: ${resolved}`);
      }
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

  async function applyWorkerPythonOverride(clear = false) {
    setIsLoading(true);
    setError(null);
    try {
      const target = clear ? '' : workerPythonPath;
      const resolved = await setWorkerPython(target);
      setWorkerPythonPath(clear ? '' : target.trim());
      setWorkerPythonStatus(resolved ? `Active: ${resolved}` : 'Default interpreter (python3/python)');
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
        <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
          <label htmlFor="worker-python-path">Worker Python path override (optional)</label>
          <input
            id="worker-python-path"
            value={workerPythonPath}
            onChange={(event) => setWorkerPythonPath(event.target.value)}
            placeholder="/home/user/miniconda3/envs/openmc/bin/python"
          />
          <p className="muted" style={{ margin: 0 }}>
            {workerPythonStatus}
          </p>
          <div className="action-row">
            <button className="secondary-action" disabled={isLoading} onClick={() => applyWorkerPythonOverride(false)}>
              Apply worker python
            </button>
            <button className="secondary-action" disabled={isLoading} onClick={() => applyWorkerPythonOverride(true)}>
              Use default python
            </button>
          </div>
        </div>
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
  const setProject = useStudioState((state) => state.setProject);
  const setStep = useStudioState((state) => state.setStep);
  const [wizardStep, setWizardStep] = useState<'start' | 'pins' | 'assemblies' | 'core' | 'review'>('start');
  const components = project.model.components ?? { pinCellTypes: [], assemblyTypes: [] };

  function startFromRecipe(recipe: ProjectBundle) {
    setProject(recipe);
    setWizardStep('pins');
  }

  function startBlank() {
    const blank = createVisualProjectBundle('core', 'rect-lattice');
    const withMats = addMaterialToProject(addMaterialToProject(addMaterialToProject(blank, 'uo2'), 'water'), 'steel');
    setProject(withMats);
    setWizardStep('pins');
  }

  const canGoPins = wizardStep !== 'start';
  const canGoAssemblies = components.pinCellTypes.length > 0;
  const canGoCore = components.assemblyTypes.length > 0;
  const canReview = components.coreLayout !== undefined;

  return (
    <div className="wizard-layout">
      <div className="wizard-progress">
        {(['start', 'pins', 'assemblies', 'core', 'review'] as const).map((step, index) => {
          const labels = ['Start', 'Pin Cells', 'Assemblies', 'Core', 'Review'];
          const isActive = step === wizardStep;
          const isDone =
            (step === 'start' && wizardStep !== 'start') ||
            (step === 'pins' && canGoAssemblies) ||
            (step === 'assemblies' && canGoCore) ||
            (step === 'core' && canReview);
          return (
            <button key={step} className={`wizard-step ${isActive ? 'active' : ''} ${isDone ? 'done' : ''}`} onClick={() => {
              if (step === 'start') setWizardStep('start');
              else if (step === 'pins' && canGoPins) setWizardStep('pins');
              else if (step === 'assemblies' && canGoAssemblies) setWizardStep('assemblies');
              else if (step === 'core' && canGoCore) setWizardStep('core');
              else if (step === 'review' && canReview) setWizardStep('review');
            }}>
              <span className="step-number">{index + 1}</span>
              <span className="step-label">{labels[index]}</span>
            </button>
          );
        })}
      </div>

      {wizardStep === 'start' && (
        <div className="wizard-content">
          <div className="wizard-hero">
            <p className="eyebrow">OpenMC Studio</p>
            <h2>What do you want to model?</h2>
            <p>Pick a starting point. You can customize everything later.</p>
          </div>
          <div className="start-options">
            <button className="start-card" onClick={() => startFromRecipe(createFuelPinRecipe())}>
              <div className="start-card-icon">⚛</div>
              <strong>Reactor pin cell</strong>
              <span>Fuel cylinder + cladding + moderator. Classic first model.</span>
            </button>
            <button className="start-card" onClick={() => startFromRecipe(createSphereRecipe())}>
              <div className="start-card-icon">◯</div>
              <strong>Simple sphere</strong>
              <span>One material inside a vacuum sphere. Quick smoke test.</span>
            </button>
            <button className="start-card" onClick={() => startFromRecipe(createShieldingSlabRecipe())}>
              <div className="start-card-icon">▦</div>
              <strong>Shielding slab</strong>
              <span>Material layer between two planes. Fixed-source workflow.</span>
            </button>
            <button className="start-card" onClick={startBlank}>
              <div className="start-card-icon">＋</div>
              <strong>Blank model</strong>
              <span>Start from scratch with materials ready.</span>
            </button>
          </div>
          <div className="start-advanced">
            <details>
              <summary>Or load an existing project</summary>
              <LoadProjectInline onLoaded={(p) => { setProject(p); setWizardStep('review'); }} />
            </details>
          </div>
        </div>
      )}

      {wizardStep === 'pins' && (
        <div className="wizard-content">
          <div className="wizard-hero">
            <p className="eyebrow">Step 2 of 4</p>
            <h2>Define your pin cells</h2>
            <p>Each pin cell type has concentric rings (fuel, gap, clad) surrounded by moderator.</p>
          </div>
          <PinCellEditor project={project} onChange={setProject} />
          <div className="wizard-nav">
            <button className="secondary-action" onClick={() => setWizardStep('start')}>Back</button>
            <button className="primary-action" disabled={!canGoAssemblies} onClick={() => setWizardStep('assemblies')}>
              Next: Assemblies →
            </button>
          </div>
        </div>
      )}

      {wizardStep === 'assemblies' && (
        <div className="wizard-content">
          <div className="wizard-hero">
            <p className="eyebrow">Step 3 of 4</p>
            <h2>Build assemblies from pin cells</h2>
            <p>Arrange pin cell types into a lattice. Click grid cells to assign pin types.</p>
          </div>
          <AssemblyEditor project={project} onChange={setProject} />
          <div className="wizard-nav">
            <button className="secondary-action" onClick={() => setWizardStep('pins')}>Back</button>
            <button className="primary-action" disabled={!canGoCore} onClick={() => setWizardStep('core')}>
              Next: Core →
            </button>
          </div>
        </div>
      )}

      {wizardStep === 'core' && (
        <div className="wizard-content">
          <div className="wizard-hero">
            <p className="eyebrow">Step 4 of 4</p>
            <h2>Compose the core</h2>
            <p>Arrange assembly types into a core lattice. Add reflector and vessel if needed.</p>
          </div>
          <CoreEditor project={project} onChange={setProject} />
          <div className="wizard-nav">
            <button className="secondary-action" onClick={() => setWizardStep('assemblies')}>Back</button>
            <button className="primary-action" disabled={!canReview} onClick={() => setWizardStep('review')}>
              Next: Review →
            </button>
          </div>
        </div>
      )}

      {wizardStep === 'review' && (
        <div className="wizard-content">
          <div className="wizard-hero">
            <p className="eyebrow">Review</p>
            <h2>Your OpenMC model is ready</h2>
            <p>Review the component hierarchy, then go to Run to generate XML and render plots.</p>
          </div>
          <ReviewSummary project={project} onChange={setProject} />
          <div className="wizard-nav">
            <button className="secondary-action" onClick={() => setWizardStep('core')}>Back</button>
            <button className="primary-action" onClick={() => setStep('run')}>
              Go to Run →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function LoadProjectInline({ onLoaded }: { onLoaded: (p: ProjectBundle) => void }) {
  const [dir, setDir] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  async function handleLoad() {
    if (!dir.trim()) { setMsg('Enter a project directory.'); return; }
    try { onLoaded(await loadProjectBundle(dir.trim())); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
  }

  return (
    <div className="inline-load">
      <input value={dir} onChange={(e) => setDir(e.target.value)} placeholder="/home/user/openmc-project" />
      <button className="secondary-action" onClick={handleLoad}>Load</button>
      {msg && <p className="muted">{msg}</p>}
    </div>
  );
}

function PinCellEditor({ project, onChange }: { project: ProjectBundle; onChange: (p: ProjectBundle) => void }) {
  const components = project.model.components ?? { pinCellTypes: [], assemblyTypes: [] };

  function addMaterialFromLibrary(libId: string) {
    const entry = materialLibrary.find((e) => e.id === libId);
    if (!entry) return;
    if (project.model.materials.materials.some((m) => m.id === entry.material.id)) return;
    onChange({ ...project, model: { ...project.model, materials: { materials: [...project.model.materials.materials, entry.material] } } });
  }

  function removeMaterial(matId: string) {
    onChange({ ...project, model: { ...project.model, materials: { materials: project.model.materials.materials.filter((m) => m.id !== matId) } } });
  }

  function addPin() {
    const p = ensureDefaultMaterial(project);
    const mat = p.model.materials.materials;
    const newPin: PinCellType = {
      id: `pin-${safeRandomUUID().slice(0, 8)}`,
      name: `Pin ${components.pinCellTypes.length + 1}`,
      rings: [
        { id: `r-${safeRandomUUID().slice(0, 8)}`, name: 'fuel', outerRadius: 0.41, materialId: mat[0]?.id ?? '' },
      ],
      pitch: 1.26,
      moderatorMaterialId: undefined,
    };
    onChange({ ...p, model: { ...p.model, components: { ...components, pinCellTypes: [...components.pinCellTypes, newPin] } } });
  }

  function updatePin(pinId: string, updates: Partial<PinCellType>) {
    onChange({ ...project, model: { ...project.model, components: { ...components, pinCellTypes: components.pinCellTypes.map((p) => p.id === pinId ? { ...p, ...updates } : p) } } });
  }

  function updateRing(pinId: string, ringId: string, updates: Partial<PinCellType['rings'][number]>) {
    const pin = components.pinCellTypes.find((p) => p.id === pinId);
    if (!pin) return;
    updatePin(pinId, { rings: pin.rings.map((r) => r.id === ringId ? { ...r, ...updates } : r) });
  }

  const categories = ['fuel', 'cladding', 'moderator', 'coolant', 'structural', 'shielding', 'absorber'] as const;

  return (
    <div className="editor-section">
      <div className="material-library">
        <h4>Material library</h4>
        <p className="muted">Click to add materials to your project.</p>
        {project.model.materials.materials.length > 0 && (
          <div className="material-category">
            <span className="category-label">Your project materials ({project.model.materials.materials.length})</span>
            <div className="category-chips">
              {project.model.materials.materials.map((m) => (
                <button key={m.id} className="material-chip added" onClick={() => removeMaterial(m.id)} title="Click to remove">
                  {m.name} <span className="remove-x">×</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {categories.map((cat) => {
          const entries = materialLibrary.filter((e) => e.category === cat);
          if (entries.length === 0) return null;
          return (
            <div key={cat} className="material-category">
              <span className="category-label">{cat}</span>
              <div className="category-chips">
                {entries.map((entry) => {
                  const alreadyAdded = project.model.materials.materials.some((m) => m.id === entry.material.id);
                  return (
                    <button key={entry.id} className={`material-chip ${alreadyAdded ? 'added' : ''}`} onClick={() => alreadyAdded ? removeMaterial(entry.material.id) : addMaterialFromLibrary(entry.id)} title={entry.description}>
                      {entry.name}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
        <details className="custom-material-section">
          <summary>+ Create custom material</summary>
          <CustomMaterialForm onAdd={(mat) => {
            if (project.model.materials.materials.some((m) => m.id === mat.id)) return;
            onChange({ ...project, model: { ...project.model, materials: { materials: [...project.model.materials.materials, mat] } } });
          }} />
        </details>
      </div>
      {components.pinCellTypes.length === 0 && (
        <div className="empty-hint">
          <p>No pin cells yet. Add materials above, then add a pin cell below.</p>
        </div>
      )}
      {components.pinCellTypes.map((pin) => (
        <div key={pin.id} className="pin-card">
          <div className="pin-card-header">
            <input className="pin-name-input" value={pin.name} onChange={(e) => updatePin(pin.id, { name: e.target.value })} />
            <span className="pin-pitch-badge">pitch {pin.pitch} cm</span>
          </div>
          <PinCrossSection pin={pin} />
          <div className="ring-editor">
            {pin.rings.map((ring) => (
              <div key={ring.id} className="ring-editor-row">
                <input className="ring-name-input" value={ring.name} onChange={(e) => updateRing(pin.id, ring.id, { name: e.target.value })} />
                <label>r=</label>
                <input type="number" value={ring.outerRadius} onChange={(e) => updateRing(pin.id, ring.id, { outerRadius: Number(e.target.value) })} />
                <select value={ring.materialId} onChange={(e) => updateRing(pin.id, ring.id, { materialId: e.target.value })}>
                  <option value="">select material</option>
                  {project.model.materials.materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                <label>T(K)</label>
                <input type="number" value={ring.temperature ?? ''} onChange={(e) => updateRing(pin.id, ring.id, { temperature: e.target.value ? Number(e.target.value) : undefined })} placeholder="optional" />
                <button className="mini-action" onClick={() => {
                  updatePin(pin.id, { rings: pin.rings.filter((r) => r.id !== ring.id) });
                }}>×</button>
              </div>
            ))}
            <button className="mini-action" onClick={() => {
              const newRing = { id: `r-${safeRandomUUID().slice(0, 8)}`, name: 'region', outerRadius: 0.5, materialId: '' };
              updatePin(pin.id, { rings: [...pin.rings, newRing] });
            }}>+ add ring</button>
          </div>
          <div className="pin-footer">
            <label><input type="checkbox" checked={Boolean(pin.moderatorMaterialId)} onChange={(e) => {
              updatePin(pin.id, { moderatorMaterialId: e.target.checked ? (project.model.materials.materials[0]?.id ?? '') : undefined });
            }} /> Moderator</label>
            {pin.moderatorMaterialId && (
              <select value={pin.moderatorMaterialId} onChange={(e) => updatePin(pin.id, { moderatorMaterialId: e.target.value })}>
                <option value="">select material</option>
                {project.model.materials.materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            )}
            <label>Pitch</label>
            <input type="number" value={pin.pitch} onChange={(e) => updatePin(pin.id, { pitch: Number(e.target.value) })} />
          </div>
        </div>
      ))}
      <button className="secondary-action full-width" onClick={addPin}>+ Add pin cell type</button>
    </div>
  );
}

function PinCrossSection({ pin }: { pin: PinCellType }) {
  const maxR = pin.pitch * 0.5;
  const scale = 100 / maxR;
  const colors: Record<string, string> = { fuel: '#f59e0b', gap: '#94a3b8', clad: '#60a5fa', moderator: '#38bdf8' };

  return (
    <svg viewBox="0 0 200 200" className="pin-cross-section">
      <circle cx="100" cy="100" r={maxR * scale} fill="rgba(56,189,248,0.15)" stroke="#38bdf8" strokeWidth="1" />
      {[...pin.rings].reverse().map((ring) => (
        <circle key={ring.id} cx="100" cy="100" r={ring.outerRadius * scale} fill={colors[ring.name] ?? '#5eead4'} fillOpacity="0.25" stroke={colors[ring.name] ?? '#5eead4'} strokeWidth="1.5" />
      ))}
      <line x1="100" y1="0" x2="100" y2="200" stroke="rgba(148,163,184,0.15)" />
      <line x1="0" y1="100" x2="200" y2="100" stroke="rgba(148,163,184,0.15)" />
    </svg>
  );
}

function NuclideInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [query, setQuery] = useState(value);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const suggestions = searchNuclides(query, 12);

  function handleSelect(name: string) {
    setQuery(name);
    onChange(name);
    setShowSuggestions(false);
  }

  function handleChange(v: string) {
    setQuery(v);
    onChange(v);
    setShowSuggestions(true);
  }

  return (
    <div className="nuclide-input-wrapper">
      <input
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => setShowSuggestions(true)}
        onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
        placeholder={placeholder ?? 'e.g. U235'}
      />
      {showSuggestions && suggestions.length > 0 && (
        <div className="nuclide-suggestions">
          {suggestions.map((n) => (
            <button key={n.name} className="nuclide-suggestion" onMouseDown={() => handleSelect(n.name)}>
              <span className="nuclide-name">{n.name}</span>
              <span className="nuclide-info">{n.element}-{n.massNumber} ({n.category})</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CustomMaterialForm({ onAdd }: { onAdd: (mat: ReactorModel['materials']['materials'][number]) => void }) {
  const [name, setName] = useState('');
  const [density, setDensity] = useState('1.0');
  const [densityUnit, setDensityUnit] = useState<'g/cm3' | 'kg/m3' | 'atom/b-cm'>('g/cm3');
  const [temperature, setTemperature] = useState('');
  const [nuclides, setNuclides] = useState<{ name: string; fraction: string; fractionType: 'atom' | 'weight' }[]>([
    { name: '', fraction: '', fractionType: 'atom' },
  ]);

  function updateNuclide(index: number, field: string, value: string) {
    setNuclides(nuclides.map((n, i) => i === index ? { ...n, [field]: value } : n));
  }

  function addNuclideRow() {
    setNuclides([...nuclides, { name: '', fraction: '', fractionType: 'atom' }]);
  }

  function removeNuclideRow(index: number) {
    if (nuclides.length <= 1) return;
    setNuclides(nuclides.filter((_, i) => i !== index));
  }

  function handleAdd() {
    if (!name.trim()) return;
    const validNuclides = nuclides.filter((n) => n.name.trim() && n.fraction.trim());
    if (validNuclides.length === 0) return;

    const mat: ReactorModel['materials']['materials'][number] = {
      id: `mat-custom-${safeRandomUUID().slice(0, 8)}`,
      name: name.trim(),
      density: { value: Number(density) || 1.0, unit: densityUnit },
      temperature: temperature ? { value: Number(temperature), unit: 'K' } : undefined,
      nuclides: validNuclides.map((n) => ({
        name: n.name.trim(),
        fraction: Number(n.fraction) || 1,
        fractionType: n.fractionType,
      })),
    };
    onAdd(mat);
    setName('');
    setDensity('1.0');
    setTemperature('');
    setNuclides([{ name: '', fraction: '', fractionType: 'atom' }]);
  }

  return (
    <div className="custom-material-form">
      <div className="form-row">
        <label>Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. My Custom Fuel" />
      </div>
      <div className="form-row-inline">
        <div className="form-row">
          <label>Density</label>
          <input type="number" value={density} onChange={(e) => setDensity(e.target.value)} />
        </div>
        <div className="form-row">
          <label>Unit</label>
          <select value={densityUnit} onChange={(e) => setDensityUnit(e.target.value as 'g/cm3' | 'kg/m3' | 'atom/b-cm')}>
            <option value="g/cm3">g/cm3</option>
            <option value="kg/m3">kg/m3</option>
            <option value="atom/b-cm">atom/b-cm</option>
          </select>
        </div>
        <div className="form-row">
          <label>Temp (K)</label>
          <input type="number" value={temperature} onChange={(e) => setTemperature(e.target.value)} placeholder="optional" />
        </div>
      </div>
      <div className="nuclide-list">
        <label>Nuclides</label>
        {nuclides.map((n, i) => (
          <div key={i} className="nuclide-row">
            <NuclideInput value={n.name} onChange={(v) => updateNuclide(i, 'name', v)} placeholder="e.g. U235" />
            <input type="number" value={n.fraction} onChange={(e) => updateNuclide(i, 'fraction', e.target.value)} placeholder="fraction" />
            <select value={n.fractionType} onChange={(e) => updateNuclide(i, 'fractionType', e.target.value)}>
              <option value="atom">ao</option>
              <option value="weight">wo</option>
            </select>
            <button className="mini-action" onClick={() => removeNuclideRow(i)}>×</button>
          </div>
        ))}
        <button className="mini-action" onClick={addNuclideRow}>+ nuclide</button>
      </div>
      <button className="primary-action" onClick={handleAdd} disabled={!name.trim() || nuclides.every((n) => !n.name.trim())}>Add material</button>
    </div>
  );
}

function AssemblyEditor({ project, onChange }: { project: ProjectBundle; onChange: (p: ProjectBundle) => void }) {
  const components = project.model.components ?? { pinCellTypes: [], assemblyTypes: [] };

  function addAssembly() {
    const defaultPinId = components.pinCellTypes[0]?.id ?? '';
    const size = 3;
    const map = Array.from({ length: size }, () => Array.from({ length: size }, () => defaultPinId));
    const newAsm: AssemblyType = {
      id: `asm-${safeRandomUUID().slice(0, 8)}`,
      name: `Assembly ${components.assemblyTypes.length + 1}`,
      latticeKind: 'rect',
      rows: size,
      columns: size,
      pitch: 1.26,
      pinMap: map,
    };
    onChange({ ...project, model: { ...project.model, components: { ...components, assemblyTypes: [...components.assemblyTypes, newAsm] } } });
  }

  function updateAssembly(asmId: string, updates: Partial<AssemblyType>) {
    onChange({ ...project, model: { ...project.model, components: { ...components, assemblyTypes: components.assemblyTypes.map((a) => a.id === asmId ? { ...a, ...updates } : a) } } });
  }

  function changeLatticeKind(asmId: string, kind: 'rect' | 'hex') {
    const asm = components.assemblyTypes.find((a) => a.id === asmId);
    if (!asm) return;
    const defaultPinId = components.pinCellTypes[0]?.id ?? '';
    if (kind === 'hex') {
      const rings = asm.rows;
      const ringData = createRingMap(rings, defaultPinId);
      updateAssembly(asmId, { latticeKind: kind, pinMap: ringMapToDiamond(ringData), hexRings: ringData, rows: rings, columns: rings });
    } else {
      const size = asm.rows;
      const rectMap = Array.from({ length: size }, () => Array.from({ length: size }, () => defaultPinId));
      updateAssembly(asmId, { latticeKind: kind, pinMap: rectMap, rows: size, columns: size, hexRings: undefined });
    }
  }

  function changeSize(asmId: string, dimension: 'rows' | 'cols', value: number) {
    const asm = components.assemblyTypes.find((a) => a.id === asmId);
    if (!asm) return;
    const defaultPinId = components.pinCellTypes[0]?.id ?? '';

    if (asm.latticeKind === 'hex') {
      const ringData = createRingMap(value, defaultPinId);
      updateAssembly(asmId, { rows: value, columns: value, pinMap: ringMapToDiamond(ringData), hexRings: ringData });
    } else {
      if (dimension === 'rows') {
        const newMap = Array.from({ length: value }, (_, r) => asm.pinMap[r] ?? Array.from({ length: asm.columns }, () => defaultPinId));
        updateAssembly(asmId, { rows: value, pinMap: newMap });
      } else {
        const newMap = asm.pinMap.map((row) => {
          const newRow = [...row];
          while (newRow.length < value) newRow.push(defaultPinId);
          return newRow.slice(0, value);
        });
        updateAssembly(asmId, { columns: value, pinMap: newMap });
      }
    }
  }

  return (
    <div className="editor-section">
      {components.assemblyTypes.length === 0 && (
        <div className="empty-hint">
          <p>No assemblies yet. You need at least one pin cell type first.</p>
        </div>
      )}
      {components.assemblyTypes.map((asm, asmIdx) => (
        <div key={asm.id} className={`assembly-card assembly-variant-${asmIdx % 2}`}>
          <div className="assembly-header">
            <input value={asm.name} onChange={(e) => updateAssembly(asm.id, { name: e.target.value })} />
            <select value={asm.latticeKind} onChange={(e) => changeLatticeKind(asm.id, e.target.value as 'rect' | 'hex')}>
              <option value="rect">Rectangular</option>
              <option value="hex">Hexagonal</option>
            </select>
          </div>
          <div className="assembly-params">
            {asm.latticeKind === 'hex' ? (
              <label>Rings <input type="number" value={asm.rows} onChange={(e) => changeSize(asm.id, 'rows', Number(e.target.value))} /></label>
            ) : (
              <>
                <label>Rows <input type="number" value={asm.rows} onChange={(e) => changeSize(asm.id, 'rows', Number(e.target.value))} /></label>
                <label>Cols <input type="number" value={asm.columns} onChange={(e) => changeSize(asm.id, 'cols', Number(e.target.value))} /></label>
              </>
            )}
            <label>Pitch <input type="number" value={asm.pitch} onChange={(e) => updateAssembly(asm.id, { pitch: Number(e.target.value) })} /></label>
          </div>
          <div className={asm.latticeKind === 'hex' ? 'hex-grid hex-grid-absolute' : 'pin-map-grid'} style={asm.latticeKind === 'hex' ? {} : { gridTemplateColumns: `repeat(${asm.columns}, minmax(36px, 1fr))` }}>
            {asm.latticeKind === 'hex' ? (
              (() => {
                const numRings = asm.rows;
                const cellWidth = 48; // Width of each hex cell
                const cellHeight = cellWidth * 0.866; // Height for regular hexagon (sqrt(3)/2)
                const positions = generateHexPositions(numRings);
                const ringData = asm.hexRings ?? ringMapToDiamondToRingMap(asm.pinMap, numRings);
                const flat = ringMapToFlat(ringData);

                // For flat-top touching hexagons:
                // horizontal spacing = cellWidth * 3/4
                // vertical spacing = cellHeight (full height)
                const hSpacing = cellWidth * 0.75;
                const vSpacing = cellHeight;

                // Calculate grid dimensions for flat-top hexagons
                const pts = positions.map(p => ({
                  x: hSpacing * p.q,
                  y: vSpacing * (p.r + 0.5 * p.q)
                }));
                const minX = Math.min(...pts.map(p => p.x));
                const maxX = Math.max(...pts.map(p => p.x));
                const minY = Math.min(...pts.map(p => p.y));
                const maxY = Math.max(...pts.map(p => p.y));
                const gridWidth = maxX - minX + cellWidth;
                const gridHeight = maxY - minY + cellHeight;
                const offsetX = -minX + cellWidth / 2;
                const offsetY = -minY + cellHeight / 2;

                return (
                  <div className="hex-grid-wrapper" style={{ width: '100%', overflow: 'hidden', display: 'flex', justifyContent: 'center' }}>
                    <div style={{ width: gridWidth, height: gridHeight, position: 'relative' }}>
                      {positions.map((pos) => {
                        const pinId = flat[pos.idx] ?? '';
                        const pin = components.pinCellTypes.find((p) => p.id === pinId);
                        const ringLabel = pos.ring === 0 ? 'C' : `R${pos.ring}`;
                        const isCenter = pos.ring === 0;
                        const x = hSpacing * pos.q;
                        const y = vSpacing * (pos.r + 0.5 * pos.q);
                        return (
                          <button
                            key={pos.idx}
                            className={`hex-cell assembly-hex-cell ${isCenter ? 'center-cell' : ''}`}
                            style={{ position: 'absolute', left: x + offsetX - cellWidth / 2, top: y + offsetY - cellHeight / 2, width: cellWidth, height: cellHeight }}
                            title={`${pin?.name ?? 'empty'} · ${ringLabel}`}
                            onClick={() => {
                              const currentIdx = components.pinCellTypes.findIndex((p) => p.id === pinId);
                              const nextIdx = (currentIdx + 1) % Math.max(1, components.pinCellTypes.length);
                              const nextPinId = components.pinCellTypes[nextIdx]?.id ?? '';
                              const newRingData = updateRingMapAt(ringData, pos.idx, nextPinId);
                              updateAssembly(asm.id, { hexRings: newRingData, pinMap: ringMapToDiamond(newRingData) });
                            }}
                          >
                            <span>{pin?.name?.slice(0, 2) ?? '—'}</span>
                            <small className="ring-chip">{ringLabel}</small>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })()
            ) : (
              asm.pinMap.flatMap((row, rowIdx) =>
                row.map((pinId, colIdx) => {
                  const pin = components.pinCellTypes.find((p) => p.id === pinId);
                  return (
                    <button key={`${rowIdx}-${colIdx}`} className="pin-map-cell" title={pin?.name ?? 'empty'} onClick={() => {
                      const currentIdx = components.pinCellTypes.findIndex((p) => p.id === pinId);
                      const nextIdx = (currentIdx + 1) % Math.max(1, components.pinCellTypes.length);
                      const nextPinId = components.pinCellTypes[nextIdx]?.id ?? '';
                      const newMap = asm.pinMap.map((r, ri) => r.map((c, ci) => (ri === rowIdx && ci === colIdx ? nextPinId : c)));
                      updateAssembly(asm.id, { pinMap: newMap });
                    }}>
                      {pin?.name?.slice(0, 3) ?? '—'}
                    </button>
                  );
                })
              )
            )}
          </div>
        </div>
      ))}
      <button className="secondary-action full-width" disabled={components.pinCellTypes.length === 0} onClick={addAssembly}>+ Add assembly type</button>
    </div>
  );
}

// ===== OpenMC-Native Ring-Based Hex System =====
// OpenMC HexLattice.universes convention:
// - universes[0] = outermost ring (6*(num_rings-1) elements)
// - universes[1] = next ring inward
// - ...
// - universes[num_rings-1] = center ring (1 element)
// - Within each ring: elements ordered clockwise from "top" (12 o'clock)
// Reference: https://docs.openmc.org/en/stable/pythonapi/generated/openmc.HexLattice.html
// Source: openmc/lattice.py HexLattice.universes setter (lines 1214-1218)

/** Generate axial positions for flat-top hex grid centered at origin.
 *  Returns positions in OpenMC's visual order: center first, then ring 1, ring 2, etc.
 *  Within each ring: clockwise from top (12 o'clock) — matches OpenMC HexLattice convention.
 *  Reference: https://docs.openmc.org/en/stable/pythonapi/generated/openmc.HexLattice.html
 */
function generateHexPositions(rings: number): Array<{ q: number; r: number; ring: number; idx: number }> {
  const result: Array<{ q: number; r: number; ring: number; idx: number }> = [];
  result.push({ q: 0, r: 0, ring: 0, idx: 0 });
  for (let ring = 1; ring < rings; ring++) {
    // Start at top (12 o'clock) for flat-top: (0, -ring) in axial coords
    let q = 0;
    let r = -ring;
    // Clockwise directions for flat-top hex from top: SE, S, SW, NW, N, NE
    const dirs = [
      { dq: 1, dr: 0 },   // SE (top → top-right)
      { dq: 0, dr: 1 },   // S  (right → bottom)
      { dq: -1, dr: 1 },  // SW (bottom → bottom-left)
      { dq: -1, dr: 0 },  // NW (left → top-left)
      { dq: 0, dr: -1 },  // N  (top-left → top)
      { dq: 1, dr: -1 },  // NE (top → top-right, next ring segment)
    ];
    for (let dir = 0; dir < 6; dir++) {
      for (let step = 0; step < ring; step++) {
        result.push({ q, r, ring, idx: result.length });
        q += dirs[dir].dq;
        r += dirs[dir].dr;
      }
    }
  }
  return result;
}

/** Axial → pixel for flat-top hex */
function axialToPixel(q: number, r: number, size: number): { x: number; y: number } {
  const s3 = Math.sqrt(3);
  return { x: size * (3 / 2 * q), y: size * (s3 / 2 * q + s3 * r) };
}

/** Create ring-based map in OpenMC's universes format: outermost-to-innermost.
 *  For numRings=3: [[ring2 (12 elts)], [ring1 (6 elts)], [center (1 elt)]]
 *  This matches openmc.HexLattice.universes setter expectations.
 */
function createRingMap(rings: number, fill: string): string[][] {
  const result: string[][] = [];
  // Outermost ring first (index 0), center last (index rings-1)
  for (let r = rings - 1; r >= 0; r--) {
    const count = r === 0 ? 1 : 6 * r;
    result.push(Array.from({ length: count }, () => fill));
  }
  return result;
}

/** Get ring size for a given ring index in OpenMC's outermost-first ordering.
 *  ringIndex 0 = outermost, ringIndex numRings-1 = center
 */
function getRingSize(ringIndex: number, numRings: number): number {
  const ringNum = numRings - 1 - ringIndex; // Convert to actual ring number (0=center)
  return ringNum === 0 ? 1 : 6 * ringNum;
}

/** Flatten ring map (outermost-first) to single array in visual axial-order.
 *  The result is ordered: center, ring1, ring2, ... (for rendering)
 */
function ringMapToFlat(rings: string[][]): string[] {
  // rings is outermost-first: [outer, ..., inner]
  // We need visual order: center first, then outward
  const numRings = rings.length;
  const flat: string[] = [];
  for (let i = numRings - 1; i >= 0; i--) {
    flat.push(...rings[i]);
  }
  return flat;
}

/** Get ring info from flat index (visual order: center=0, then outward).
 *  Returns { ringNumber, idxInRing } where ringNumber 0 = center.
 */
function flatIndexToRingInfo(flatIdx: number, numRings: number): { ringNumber: number; idxInRing: number } {
  if (flatIdx === 0) return { ringNumber: 0, idxInRing: 0 };
  let remaining = flatIdx - 1;
  for (let r = 1; r < numRings; r++) {
    const ringSize = 6 * r;
    if (remaining < ringSize) return { ringNumber: r, idxInRing: remaining };
    remaining -= ringSize;
  }
  return { ringNumber: 0, idxInRing: 0 };
}

/** Convert flat index (visual order) to OpenMC universes array index.
 *  OpenMC: universes[0] = outermost, universes[numRings-1] = center
 */
function flatIndexToOpenMCIndex(flatIdx: number, numRings: number): { universesRing: number; idxInRing: number } {
  const { ringNumber, idxInRing } = flatIndexToRingInfo(flatIdx, numRings);
  // Convert ringNumber (0=center) to OpenMC ring index (0=outermost)
  const universesRing = numRings - 1 - ringNumber;
  return { universesRing, idxInRing };
}

/** Update ring map at flat index (visual order). */
function updateRingMapAt(rings: string[][], flatIdx: number, value: string): string[][] {
  const numRings = rings.length;
  const { universesRing, idxInRing } = flatIndexToOpenMCIndex(flatIdx, numRings);
  const updated = rings.map(r => [...r]);
  updated[universesRing][idxInRing] = value;
  return updated;
}

/** Convert OpenMC-style ring map (outermost-first) to legacy pinMap for compatibility (diamond shape) */
function ringMapToDiamond(rings: string[][]): string[][] {
  const n = rings.length;
  const positions = generateHexPositions(n);
  const flat = ringMapToFlat(rings); // Convert to visual order for rendering
  const size = 2 * n - 1;
  const diamond: string[][] = Array.from({ length: size }, () => Array(size).fill(''));
  
  for (const pos of positions) {
    const center = n - 1;
    const col = pos.q + center;
    const row = pos.r + center;
    if (row >= 0 && row < size && col >= 0 && col < size) {
      diamond[row][col] = flat[pos.idx] ?? '';
    }
  }
  return diamond;
}

/** Convert legacy diamond pinMap back to OpenMC-style ring-based format (outermost-first) */
function ringMapToDiamondToRingMap(diamond: string[][], numRings: number): string[][] {
  const positions = generateHexPositions(numRings);
  // First build in visual order (center-first)
  const visualRings: string[][] = Array.from({ length: numRings }, (_, i) => 
    Array.from({ length: i === 0 ? 1 : 6 * i }, () => '')
  );
  const center = numRings - 1;
  
  for (const pos of positions) {
    const col = pos.q + center;
    const row = pos.r + center;
    if (row >= 0 && row < diamond.length && col >= 0 && col < diamond[row].length) {
      // pos.ring is the ring number (0=center), pos.idx is index within that ring
      const ringNum = pos.ring;
      // Find index within the ring
      let idxInRing = pos.idx;
      for (let r = 0; r < ringNum; r++) {
        idxInRing -= (r === 0 ? 1 : 6 * r);
      }
      visualRings[ringNum][idxInRing] = diamond[row][col] ?? '';
    }
  }
  
  // Convert visual order (center-first) to OpenMC order (outermost-first)
  const openmcRings: string[][] = [];
  for (let i = numRings - 1; i >= 0; i--) {
    openmcRings.push(visualRings[i]);
  }
  return openmcRings;
}


function CoreEditor({ project, onChange }: { project: ProjectBundle; onChange: (p: ProjectBundle) => void }) {
  const components = project.model.components ?? { pinCellTypes: [], assemblyTypes: [] };
  const coreRings = components.coreLayout?.rows ?? 0;

  function createCore() {
    const defaultAsmId = components.assemblyTypes[0]?.id ?? '';
    const size = 3;
    const map = Array.from({ length: size }, () => Array.from({ length: size }, () => defaultAsmId));
    onChange({ ...project, model: { ...project.model, components: { ...components, coreLayout: { latticeKind: 'rect', rows: size, columns: size, assemblyPitch: 21.5, assemblyMap: map } } } });
  }

  function updateCore(updates: Partial<NonNullable<ComponentRegistry['coreLayout']>>) {
    if (!components.coreLayout) return;
    onChange({ ...project, model: { ...project.model, components: { ...components, coreLayout: { ...components.coreLayout, ...updates } } } });
  }

  function changeCoreLatticeKind(kind: 'rect' | 'hex') {
    if (!components.coreLayout) return;
    const defaultAsmId = components.assemblyTypes[0]?.id ?? '';
    if (kind === 'hex') {
      const ringData = createRingMap(components.coreLayout.rows, defaultAsmId);
      updateCore({ latticeKind: kind, assemblyMap: ringMapToDiamond(ringData), hexRings: ringData });
    } else {
      const size = components.coreLayout.rows;
      const rectMap = Array.from({ length: size }, () => Array.from({ length: size }, () => defaultAsmId));
      updateCore({ latticeKind: kind, assemblyMap: rectMap, columns: size, hexRings: undefined });
    }
  }

  function changeCoreSize(value: number) {
    if (!components.coreLayout) return;
    const defaultAsmId = components.assemblyTypes[0]?.id ?? '';
    if (components.coreLayout.latticeKind === 'hex') {
      const ringData = createRingMap(value, defaultAsmId);
      updateCore({ rows: value, columns: value, assemblyMap: ringMapToDiamond(ringData), hexRings: ringData });
    } else {
      const rectMap = Array.from({ length: value }, () => Array.from({ length: value }, () => defaultAsmId));
      updateCore({ rows: value, columns: value, assemblyMap: rectMap });
    }
  }

  return (
    <div className="editor-section">
      {!components.coreLayout && (
        <div className="empty-hint">
          <p>No core layout yet. You need at least one assembly type first.</p>
          <button className="primary-action" disabled={components.assemblyTypes.length === 0} onClick={createCore}>Create 3×3 core</button>
        </div>
      )}
      {components.coreLayout && (
        <div className="core-card">
          <div className="core-params">
            <label>Lattice
              <select value={components.coreLayout.latticeKind} onChange={(e) => changeCoreLatticeKind(e.target.value as 'rect' | 'hex')}>
                <option value="rect">Rectangular</option>
                <option value="hex">Hexagonal</option>
              </select>
            </label>
            <label>{components.coreLayout.latticeKind === 'hex' ? 'Rings' : 'Size'}
              <input type="number" value={components.coreLayout.rows} onChange={(e) => changeCoreSize(Number(e.target.value))} />
            </label>
            <label>Assembly pitch <input type="number" value={components.coreLayout.assemblyPitch} onChange={(e) => updateCore({ assemblyPitch: Number(e.target.value) })} /> cm</label>
            <label>Reflector <select value={components.coreLayout.reflectorMaterialId ?? ''} onChange={(e) => updateCore({ reflectorMaterialId: e.target.value || undefined })}>
              <option value="">None</option>
              {project.model.materials.materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select></label>
            <label>Vessel <select value={components.coreLayout.vesselMaterialId ?? ''} onChange={(e) => updateCore({ vesselMaterialId: e.target.value || undefined })}>
              <option value="">None</option>
              {project.model.materials.materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select></label>
          </div>
          {components.coreLayout.latticeKind === 'hex' && (
            <div className="hex-legend" role="note" aria-label="Hex lattice legend">
              <span className="hex-legend-pill center">Center</span>
              <span className="hex-legend-pill">Rings: {components.coreLayout.rows}</span>
              <span className="hex-legend-pill">Cells: {1 + 3 * components.coreLayout.rows * (components.coreLayout.rows - 1)}</span>
            </div>
          )}
          <div className={components.coreLayout.latticeKind === 'hex' ? 'hex-grid core-grid hex-grid-absolute' : 'pin-map-grid core-grid'}>
            {components.coreLayout.latticeKind === 'hex' ? (
              (() => {
                const numRings = coreRings;
                const cellWidth = 60; // Width of each hex cell
                const cellHeight = cellWidth * 0.866; // Height for regular hexagon
                const positions = generateHexPositions(numRings);
                const ringData = components.coreLayout!.hexRings ?? ringMapToDiamondToRingMap(components.coreLayout!.assemblyMap, numRings);
                const flat = ringMapToFlat(ringData);

                // For flat-top touching hexagons:
                // horizontal spacing = cellWidth * 3/4
                // vertical spacing = cellHeight (full height)
                const hSpacing = cellWidth * 0.75;
                const vSpacing = cellHeight;

                // Calculate grid dimensions for flat-top hexagons
                const pts = positions.map(p => ({
                  x: hSpacing * p.q,
                  y: vSpacing * (p.r + 0.5 * p.q)
                }));
                const minX = Math.min(...pts.map(p => p.x));
                const maxX = Math.max(...pts.map(p => p.x));
                const minY = Math.min(...pts.map(p => p.y));
                const maxY = Math.max(...pts.map(p => p.y));
                const gridWidth = maxX - minX + cellWidth;
                const gridHeight = maxY - minY + cellHeight;
                const offsetX = -minX + cellWidth / 2;
                const offsetY = -minY + cellHeight / 2;

                return (
                  <div className="hex-grid-wrapper" style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
                    <div style={{ width: gridWidth, height: gridHeight, position: 'relative' }}>
                      {positions.map((pos) => {
                        const asmId = flat[pos.idx] ?? '';
                        const asm = components.assemblyTypes.find((a) => a.id === asmId);
                        const ringLabel = pos.ring === 0 ? 'C' : `R${pos.ring}`;
                        const isCenter = pos.ring === 0;
                        const x = hSpacing * pos.q;
                        const y = vSpacing * (pos.r + 0.5 * pos.q);
                        return (
                          <button
                            key={pos.idx}
                            className={`hex-cell core-hex-cell has-value ${isCenter ? 'center-cell' : ''}`}
                            style={{ position: 'absolute', left: x + offsetX - cellWidth / 2, top: y + offsetY - cellHeight / 2, width: cellWidth, height: cellHeight }}
                            title={`${asm?.name ?? 'empty'} · ${ringLabel}`}
                            onClick={() => {
                              const currentIdx = components.assemblyTypes.findIndex((a) => a.id === asmId);
                              const nextIdx = (currentIdx + 1) % Math.max(1, components.assemblyTypes.length);
                              const nextAsmId = components.assemblyTypes[nextIdx]?.id ?? '';
                              const newRingData = updateRingMapAt(ringData, pos.idx, nextAsmId);
                              updateCore({ hexRings: newRingData, assemblyMap: ringMapToDiamond(newRingData) });
                            }}
                          >
                            <span>{asm?.name?.slice(0, 2) ?? '—'}</span>
                            <small className="ring-chip">{ringLabel}</small>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })()
            ) : (
              components.coreLayout.assemblyMap.flatMap((row, rowIdx) =>
                row.map((asmId, colIdx) => {
                  const asm = components.assemblyTypes.find((a) => a.id === asmId);
                  return (
                    <button key={`${rowIdx}-${colIdx}`} className="pin-map-cell assembly-cell" title={asm?.name ?? 'empty'} onClick={() => {
                      const currentIdx = components.assemblyTypes.findIndex((a) => a.id === asmId);
                      const nextIdx = (currentIdx + 1) % Math.max(1, components.assemblyTypes.length);
                      const nextAsmId = components.assemblyTypes[nextIdx]?.id ?? '';
                      const newMap = components.coreLayout!.assemblyMap.map((r, ri) => r.map((c, ci) => (ri === rowIdx && ci === colIdx ? nextAsmId : c)));
                      updateCore({ assemblyMap: newMap });
                    }}>
                      {asm?.name?.slice(0, 4) ?? '—'}
                    </button>
                  );
                })
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ReviewSummary({ project, onChange }: { project: ProjectBundle; onChange: (p: ProjectBundle) => void }) {
  const components = project.model.components;
  const settings = project.model.settings;
  const sources = project.model.sources;
  const tallies = project.model.tallies;

  function updateSettings(updates: Partial<typeof settings>) {
    onChange({ ...project, model: { ...project.model, settings: { ...settings, ...updates } } });
  }

  function ensureThermalFeedback() {
    return settings.thermalFeedback ?? {
      enabled: false,
      maxIterations: 10,
      convergenceTolerance: 1e-5,
      updateStrategy: 'under-relaxation' as const,
      relaxationFactor: 0.7,
      materialTemperatures: [],
    };
  }

  function updateThermalFeedbackMaterial(materialId: string, updates: { temperature?: number; thermalExpansionCoefficient?: number }) {
    const feedback = ensureThermalFeedback();
    const existing = feedback.materialTemperatures.find((item) => item.materialId === materialId);
    const materialTemperatures = existing
      ? feedback.materialTemperatures.map((item) => (item.materialId === materialId ? { ...item, ...updates } : item))
      : [...feedback.materialTemperatures, { materialId, temperature: updates.temperature ?? 293.6, thermalExpansionCoefficient: updates.thermalExpansionCoefficient }];
    updateSettings({ thermalFeedback: { ...feedback, materialTemperatures } });
  }

  function addSource() {
    const newSource = { id: `src-${safeRandomUUID().slice(0, 8)}`, name: `Source ${sources.length + 1}`, type: 'point' as const, energy: { value: 2, unit: 'MeV' as const }, strength: 1, parameters: { x: 0, y: 0, z: 0 }, angle: { type: 'isotropic' as const } };
    onChange({ ...project, model: { ...project.model, sources: [...sources, newSource] } });
  }

  function updateSource(srcId: string, updates: Partial<typeof sources[number]>) {
    onChange({ ...project, model: { ...project.model, sources: sources.map((s) => s.id === srcId ? { ...s, ...updates } : s) } });
  }

  function addTally() {
    const newTally = {
      id: `tally-${safeRandomUUID().slice(0, 8)}`,
      name: `Tally ${tallies.length + 1}`,
      scores: ['flux'],
      targetNodeIds: ['root'],
      filters: [],
      nuclides: [],
      sensitivity: { enabled: false, nuclides: [], scores: ['flux'] },
    };
    onChange({ ...project, model: { ...project.model, tallies: [...tallies, newTally] } });
  }

  function updateTally(tallyId: string, updates: Partial<typeof tallies[number]>) {
    onChange({ ...project, model: { ...project.model, tallies: tallies.map((t) => t.id === tallyId ? { ...t, ...updates } : t) } });
  }

  function addEnergyFilter(tallyId: string) {
    const tally = tallies.find((t) => t.id === tallyId);
    if (!tally) return;
    const filters = [...(tally.filters ?? []), { type: 'energy' as const, bins: [1e-5, 1, 1e5, 2e7] }];
    updateTally(tallyId, { filters });
  }

  function addMeshFilter(tallyId: string) {
    const tally = tallies.find((t) => t.id === tallyId);
    if (!tally) return;
    const filters = [
      ...(tally.filters ?? []),
      { type: 'mesh' as const, ids: ['20 20 1', '-200 -200 -1', '200 200 1'], label: 'regular mesh' },
    ];
    updateTally(tallyId, { filters });
  }

  function addIdFilter(tallyId: string, type: 'cell' | 'material' | 'universe' | 'surface', placeholder: string) {
    const tally = tallies.find((t) => t.id === tallyId);
    if (!tally) return;
    const filters = [...(tally.filters ?? []), { type, ids: [placeholder], label: `${type} ids` }];
    updateTally(tallyId, { filters });
  }

  function applyGeometry(update: (p: ProjectBundle) => ProjectBundle) {
    onChange(update(project));
  }

  return (
    <div className="review-summary">
      {components && (
        <>
          <div className="review-section">
            <h3>Materials ({project.model.materials.materials.length})</h3>
            <div className="review-chips">
              {project.model.materials.materials.map((m) => <span key={m.id} className="review-chip">{m.name}</span>)}
            </div>
          </div>
          <div className="review-section">
            <h3>Pin cell types ({components.pinCellTypes.length})</h3>
            {components.pinCellTypes.map((pin) => (
              <div key={pin.id} className="review-item">
                <strong>{pin.name}</strong>
                <span>{pin.rings.length} rings, pitch {pin.pitch} cm</span>
              </div>
            ))}
          </div>
          <div className="review-section">
            <h3>Assembly types ({components.assemblyTypes.length})</h3>
            {components.assemblyTypes.map((asm) => (
              <div key={asm.id} className="review-item">
                <strong>{asm.name}</strong>
                <span>{asm.rows}×{asm.columns} {asm.latticeKind}, pitch {asm.pitch} cm</span>
              </div>
            ))}
          </div>
          {components.coreLayout && (
            <div className="review-section">
              <h3>Core layout</h3>
              <div className="review-item">
                <strong>{components.coreLayout.rows}×{components.coreLayout.columns} {components.coreLayout.latticeKind}</strong>
                <span>Assembly pitch: {components.coreLayout.assemblyPitch} cm</span>
              </div>
            </div>
          )}
        </>
      )}

      <details className="review-section" open>
        <summary><h3>CSG / surfaces editor</h3></summary>
        <div className="tool-grid">
          <button className="tool-button" onClick={() => applyGeometry(addSphereCell)}>+ sphere cell</button>
          <button className="tool-button" onClick={() => applyGeometry(addCylinderCell)}>+ cylinder cell</button>
          <button className="tool-button" onClick={() => applyGeometry(addSlabCell)}>+ slab cell</button>
          <button className="tool-button" onClick={() => applyGeometry(addMacrobodyCell)}>+ macrobody cell</button>
        </div>
        <CsgDiagram project={project} />
        <CsgEditor project={project} onChange={onChange} />
      </details>

      <details className="review-section">
        <summary><h3>Temperature settings</h3></summary>
        <div className="physics-form">
          <label>Default temperature (K)
            <input type="number" value={settings.temperature?.default ?? 293.6} onChange={(e) => updateSettings({ temperature: { ...settings.temperature, default: Number(e.target.value) } })} />
          </label>
          <label>Method
            <select value={settings.temperature?.method ?? 'nearest'} onChange={(e) => updateSettings({ temperature: { ...settings.temperature!, method: e.target.value as 'nearest' | 'interpolation' } })}>
              <option value="nearest">nearest</option>
              <option value="interpolation">interpolation</option>
            </select>
          </label>
          <label><input type="checkbox" checked={settings.temperature?.multipole ?? false} onChange={(e) => updateSettings({ temperature: { ...settings.temperature!, multipole: e.target.checked } })} /> Enable multipole</label>

          <hr />
          <h4>Coupled thermal feedback hooks</h4>
          <label><input type="checkbox" checked={settings.thermalFeedback?.enabled ?? false} onChange={(e) => updateSettings({ thermalFeedback: { ...ensureThermalFeedback(), enabled: e.target.checked } })} /> Enable coupled feedback loop</label>
          <label>Max iterations
            <input type="number" min={1} value={settings.thermalFeedback?.maxIterations ?? 10} onChange={(e) => updateSettings({ thermalFeedback: { ...ensureThermalFeedback(), maxIterations: Number(e.target.value) } })} />
          </label>
          <label>k-eff convergence tolerance
            <input type="number" step="1e-6" value={settings.thermalFeedback?.convergenceTolerance ?? 1e-5} onChange={(e) => updateSettings({ thermalFeedback: { ...ensureThermalFeedback(), convergenceTolerance: Number(e.target.value) } })} />
          </label>
          <label>Temperature update strategy
            <select value={settings.thermalFeedback?.updateStrategy ?? 'under-relaxation'} onChange={(e) => updateSettings({ thermalFeedback: { ...ensureThermalFeedback(), updateStrategy: e.target.value as 'fixed-point' | 'under-relaxation' } })}>
              <option value="under-relaxation">under-relaxation</option>
              <option value="fixed-point">fixed-point</option>
            </select>
          </label>
          <label>Relaxation factor
            <input type="number" min={0} max={1} step={0.05} value={settings.thermalFeedback?.relaxationFactor ?? 0.7} onChange={(e) => updateSettings({ thermalFeedback: { ...ensureThermalFeedback(), relaxationFactor: Number(e.target.value) } })} />
          </label>

          <div>
            <strong>Per-material temperature / thermal expansion</strong>
            {project.model.materials.materials.map((material) => {
              const mapped = settings.thermalFeedback?.materialTemperatures.find((entry) => entry.materialId === material.id);
              return (
                <div key={material.id} className="source-row">
                  <span>{material.name}</span>
                  <label>Temp (K)
                    <input type="number" value={mapped?.temperature ?? material.temperature?.value ?? settings.temperature?.default ?? 293.6} onChange={(e) => updateThermalFeedbackMaterial(material.id, { temperature: Number(e.target.value) })} />
                  </label>
                  <label>α (1/K)
                    <input type="number" step="1e-6" value={mapped?.thermalExpansionCoefficient ?? ''} placeholder="optional" onChange={(e) => updateThermalFeedbackMaterial(material.id, { thermalExpansionCoefficient: e.target.value === '' ? undefined : Number(e.target.value) })} />
                  </label>
                </div>
              );
            })}
          </div>
        </div>
      </details>

      <details className="review-section">
        <summary><h3>Cross sections</h3></summary>
        <div className="physics-form">
          <label>OPENMC_CROSS_SECTIONS path
            <input value={settings.crossSections?.path ?? ''} onChange={(e) => updateSettings({ crossSections: { ...settings.crossSections, path: e.target.value || undefined } })} placeholder="/path/to/cross_sections.xml" />
          </label>
          <p className="muted">Set the path to your cross_sections.xml file. Leave empty to use the OPENMC_CROSS_SECTIONS environment variable.</p>
        </div>
      </details>

      <details className="review-section">
        <summary><h3>Sources ({sources.length})</h3></summary>
        {sources.map((src) => (
          <div key={src.id} className="source-card">
            <div className="source-row">
              <label>Name <input value={src.name} onChange={(e) => updateSource(src.id, { name: e.target.value })} /></label>
              <label>Type
                <select value={src.type} onChange={(e) => updateSource(src.id, { type: e.target.value as 'point' | 'box' | 'cylindrical' })}>
                  <option value="point">point</option>
                  <option value="box">box</option>
                  <option value="cylindrical">cylindrical</option>
                </select>
              </label>
            </div>
            {src.type === 'point' && (
              <div className="source-row">
                <label>x <input type="number" value={src.parameters?.x ?? 0} onChange={(e) => updateSource(src.id, { parameters: { ...src.parameters, x: Number(e.target.value) } })} /></label>
                <label>y <input type="number" value={src.parameters?.y ?? 0} onChange={(e) => updateSource(src.id, { parameters: { ...src.parameters, y: Number(e.target.value) } })} /></label>
                <label>z <input type="number" value={src.parameters?.z ?? 0} onChange={(e) => updateSource(src.id, { parameters: { ...src.parameters, z: Number(e.target.value) } })} /></label>
              </div>
            )}
            <div className="source-row">
              <label>Energy <input type="number" value={src.energy?.value ?? 2} onChange={(e) => updateSource(src.id, { energy: { value: Number(e.target.value), unit: src.energy?.unit ?? 'MeV' } })} /></label>
              <label>Unit
                <select value={src.energy?.unit ?? 'MeV'} onChange={(e) => updateSource(src.id, { energy: { ...src.energy!, unit: e.target.value as 'eV' | 'keV' | 'MeV' } })}>
                  <option value="eV">eV</option>
                  <option value="keV">keV</option>
                  <option value="MeV">MeV</option>
                </select>
              </label>
              <label>Angle
                <select value={src.angle?.type ?? 'isotropic'} onChange={(e) => updateSource(src.id, { angle: { type: e.target.value as 'isotropic' | 'monodirectional' } })}>
                  <option value="isotropic">isotropic</option>
                  <option value="monodirectional">monodirectional</option>
                </select>
              </label>
            </div>
          </div>
        ))}
        <button className="secondary-action full-width" onClick={addSource}>+ Add source</button>
      </details>

      <details className="review-section">
        <summary><h3>Tallies ({tallies.length})</h3></summary>
        {tallies.map((tally) => (
          <div key={tally.id} className="tally-card">
            <div className="source-row">
              <label>Name <input value={tally.name} onChange={(e) => updateTally(tally.id, { name: e.target.value })} /></label>
              <label>Scores <input value={tally.scores.join(' ')} onChange={(e) => updateTally(tally.id, { scores: e.target.value.split(/\s+/).filter(Boolean) })} placeholder="flux fission absorption" /></label>
            </div>
            <div className="source-row">
              <label>Nuclides <input value={(tally.nuclides ?? []).join(' ')} onChange={(e) => updateTally(tally.id, { nuclides: e.target.value.split(/\s+/).filter(Boolean) })} placeholder="U235 U238 (empty=all)" /></label>
            </div>
            <details className="review-section" style={{ marginTop: 8 }}>
              <summary><h4>Sensitivity</h4></summary>
              <div className="physics-form">
                <label>
                  <input
                    type="checkbox"
                    checked={tally.sensitivity?.enabled ?? false}
                    onChange={(e) => updateTally(tally.id, { sensitivity: { enabled: e.target.checked, nuclides: tally.sensitivity?.nuclides ?? [], scores: tally.sensitivity?.scores ?? tally.scores } })}
                  />
                  Enable sensitivity derivatives
                </label>
                <label>Sensitivity scores
                  <input
                    value={(tally.sensitivity?.scores ?? []).join(' ')}
                    onChange={(e) => updateTally(tally.id, { sensitivity: { enabled: tally.sensitivity?.enabled ?? false, nuclides: tally.sensitivity?.nuclides ?? [], scores: e.target.value.split(/\s+/).filter(Boolean) } })}
                    placeholder="flux fission absorption"
                  />
                </label>
                <label>Sensitivity nuclides
                  <input
                    value={(tally.sensitivity?.nuclides ?? []).join(' ')}
                    onChange={(e) => updateTally(tally.id, { sensitivity: { enabled: tally.sensitivity?.enabled ?? false, nuclides: e.target.value.split(/\s+/).filter(Boolean), scores: tally.sensitivity?.scores ?? tally.scores } })}
                    placeholder="U235 U238"
                  />
                </label>
                <p className="muted">Tip: use nuclides from your materials (e.g. {Array.from(new Set(project.model.materials.materials.flatMap((m) => m.nuclides.map((n) => n.name)))).slice(0, 8).join(', ') || 'no material nuclides yet'}).</p>
              </div>
            </details>
            <div className="filter-list">
              {(tally.filters ?? []).map((filt, fi) => (
                <div key={fi} className="filter-row">
                  <span>{filt.type}</span>
                  {filt.type === 'energy' && filt.bins && (
                    <input value={filt.bins.join(' ')} onChange={(e) => {
                      const newFilters = [...(tally.filters ?? [])];
                      newFilters[fi] = { ...filt, bins: e.target.value.split(/\s+/).map(Number).filter((v) => Number.isFinite(v)) };
                      updateTally(tally.id, { filters: newFilters });
                    }} placeholder="1e-5 1 1e5 2e7" />
                  )}
                  {filt.type === 'mesh' && (
                    <div className="mesh-filter-editor">
                      <label>dimension</label>
                      <input
                        value={filt.ids?.[0] ?? ''}
                        onChange={(e) => {
                          const newFilters = [...(tally.filters ?? [])];
                          const ids = [...(filt.ids ?? ['', '', ''])];
                          ids[0] = e.target.value;
                          newFilters[fi] = { ...filt, ids };
                          updateTally(tally.id, { filters: newFilters });
                        }}
                        placeholder="20 20 1"
                      />
                      <label>lower_left</label>
                      <input
                        value={filt.ids?.[1] ?? ''}
                        onChange={(e) => {
                          const newFilters = [...(tally.filters ?? [])];
                          const ids = [...(filt.ids ?? ['', '', ''])];
                          ids[1] = e.target.value;
                          newFilters[fi] = { ...filt, ids };
                          updateTally(tally.id, { filters: newFilters });
                        }}
                        placeholder="-200 -200 -1"
                      />
                      <label>upper_right</label>
                      <input
                        value={filt.ids?.[2] ?? ''}
                        onChange={(e) => {
                          const newFilters = [...(tally.filters ?? [])];
                          const ids = [...(filt.ids ?? ['', '', ''])];
                          ids[2] = e.target.value;
                          newFilters[fi] = { ...filt, ids };
                          updateTally(tally.id, { filters: newFilters });
                        }}
                        placeholder="200 200 1"
                      />
                    </div>
                  )}
                  {(filt.type === 'cell' || filt.type === 'material' || filt.type === 'universe' || filt.type === 'surface') && (
                    <input
                      value={filt.ids?.[0] ?? ''}
                      onChange={(e) => {
                        const newFilters = [...(tally.filters ?? [])];
                        newFilters[fi] = { ...filt, ids: [e.target.value] };
                        updateTally(tally.id, { filters: newFilters });
                      }}
                      placeholder={
                        filt.type === 'cell' ? '1 2 3' :
                        filt.type === 'material' ? '10 11' :
                        filt.type === 'universe' ? '100 101' :
                        '200 201'
                      }
                    />
                  )}
                </div>
              ))}
              <button className="mini-action" onClick={() => addEnergyFilter(tally.id)}>+ energy filter</button>
              <button className="mini-action" onClick={() => addMeshFilter(tally.id)}>+ mesh filter</button>
              <button className="mini-action" onClick={() => addIdFilter(tally.id, 'cell', '1 2 3')}>+ cell filter</button>
              <button className="mini-action" onClick={() => addIdFilter(tally.id, 'material', '10 11')}>+ material filter</button>
              <button className="mini-action" onClick={() => addIdFilter(tally.id, 'universe', '100 101')}>+ universe filter</button>
              <button className="mini-action" onClick={() => addIdFilter(tally.id, 'surface', '200 201')}>+ surface filter</button>
            </div>
          </div>
        ))}
        <button className="secondary-action full-width" onClick={addTally}>+ Add tally</button>
      </details>

      <details className="review-section">
        <summary><h3>Depletion</h3></summary>
        <div className="physics-form">
          <label><input type="checkbox" checked={settings.depletion?.enabled ?? false} onChange={(e) => updateSettings({ depletion: { ...settings.depletion, enabled: e.target.checked } })} /> Enable depletion</label>
          {settings.depletion?.enabled && (
            <>
              <label>Chain file
                <input value={settings.depletion?.chainFile ?? ''} onChange={(e) => updateSettings({ depletion: { ...settings.depletion!, chainFile: e.target.value || undefined } })} placeholder="chain_endfb71.xml" />
              </label>
              <label>Power (W)
                <input type="number" value={settings.depletion?.power ?? ''} onChange={(e) => updateSettings({ depletion: { ...settings.depletion!, power: Number(e.target.value) || undefined } })} />
              </label>
              <label>Timesteps
                <input value={(settings.depletion?.timesteps ?? []).join(' ')} onChange={(e) => updateSettings({ depletion: { ...settings.depletion!, timesteps: e.target.value.split(/\s+/).map(Number).filter((v) => Number.isFinite(v)) } })} placeholder="1 2 3 4 5" />
              </label>
              <label>Units
                <select value={settings.depletion?.timestepUnits ?? 'd'} onChange={(e) => updateSettings({ depletion: { ...settings.depletion!, timestepUnits: e.target.value as 's' | 'd' | 'MWd/kg' } })}>
                  <option value="s">seconds</option>
                  <option value="d">days</option>
                  <option value="MWd/kg">MWd/kg</option>
                </select>
              </label>
              <label>Integrator
                <select value={settings.depletion?.integrator ?? 'cecm'} onChange={(e) => updateSettings({ depletion: { ...settings.depletion!, integrator: e.target.value as typeof settings.depletion.integrator } })}>
                  <option value="cecm">CE/CM (default)</option>
                  <option value="celi">CE/LI</option>
                  <option value="cf4">CF4</option>
                  <option value="leqi">LE/QI</option>
                  <option value="si-ceci">SI-CECI</option>
                </select>
              </label>
            </>
          )}
        </div>
      </details>

      {/* ── Variance Reduction ── */}
      <details className="review-section">
        <summary><h3>Variance Reduction</h3></summary>
        <div className="physics-form">
          <h4>Weight Windows</h4>
          <label><input type="checkbox" checked={settings.varianceReduction?.weightWindows?.enabled ?? false} onChange={(e) => updateSettings({ varianceReduction: { ...settings.varianceReduction, weightWindows: { ...settings.varianceReduction?.weightWindows, enabled: e.target.checked } } })} /> Enable weight windows</label>
          {settings.varianceReduction?.weightWindows?.enabled && (
            <>
              <label>Method
                <select value={settings.varianceReduction?.weightWindows?.method ?? 'manual'} onChange={(e) => updateSettings({ varianceReduction: { ...settings.varianceReduction, weightWindows: { ...settings.varianceReduction?.weightWindows!, method: e.target.value as 'manual' | 'magic' | 'fw-cadis' } } })}>
                  <option value="manual">Manual</option>
                  <option value="magic">MAGIC</option>
                  <option value="fw-cadis">FW-CADIS</option>
                </select>
              </label>
              <label>Survival ratio
                <input type="number" step="0.1" value={settings.varianceReduction?.weightWindows?.survivalRatio ?? 5} onChange={(e) => updateSettings({ varianceReduction: { ...settings.varianceReduction, weightWindows: { ...settings.varianceReduction?.weightWindows!, survivalRatio: Number(e.target.value) } } })} />
              </label>
              <label>Max split
                <input type="number" value={settings.varianceReduction?.weightWindows?.maxSplit ?? 10} onChange={(e) => updateSettings({ varianceReduction: { ...settings.varianceReduction, weightWindows: { ...settings.varianceReduction?.weightWindows!, maxSplit: Number(e.target.value) } } })} />
              </label>
              <label>Weight cutoff
                <input type="number" step="1e-8" value={settings.varianceReduction?.weightWindows?.weightCutoff ?? 1e-8} onChange={(e) => updateSettings({ varianceReduction: { ...settings.varianceReduction, weightWindows: { ...settings.varianceReduction?.weightWindows!, weightCutoff: Number(e.target.value) } } })} />
              </label>
            </>
          )}

          <h4>Survival Biasing</h4>
          <label><input type="checkbox" checked={settings.varianceReduction?.survivalBiasing?.enabled ?? false} onChange={(e) => updateSettings({ varianceReduction: { ...settings.varianceReduction, survivalBiasing: { ...settings.varianceReduction?.survivalBiasing, enabled: e.target.checked } } })} /> Enable survival biasing</label>
          {settings.varianceReduction?.survivalBiasing?.enabled && (
            <>
              <label>Cutoff weight
                <input type="number" step="0.01" value={settings.varianceReduction?.survivalBiasing?.cutoff ?? 0.25} onChange={(e) => updateSettings({ varianceReduction: { ...settings.varianceReduction, survivalBiasing: { ...settings.varianceReduction?.survivalBiasing!, cutoff: Number(e.target.value) } } })} />
              </label>
              <label>Survival multiplier
                <input type="number" step="0.1" value={settings.varianceReduction?.survivalBiasing?.survivalMultiplier ?? 1.0} onChange={(e) => updateSettings({ varianceReduction: { ...settings.varianceReduction, survivalBiasing: { ...settings.varianceReduction?.survivalBiasing!, survivalMultiplier: Number(e.target.value) } } })} />
              </label>
            </>
          )}

          <h4>Russian Roulette</h4>
          <label><input type="checkbox" checked={settings.varianceReduction?.russianRoulette?.enabled ?? false} onChange={(e) => updateSettings({ varianceReduction: { ...settings.varianceReduction, russianRoulette: { ...settings.varianceReduction?.russianRoulette, enabled: e.target.checked } } })} /> Enable Russian roulette</label>
          {settings.varianceReduction?.russianRoulette?.enabled && (
            <>
              <label>Weight threshold
                <input type="number" step="0.01" value={settings.varianceReduction?.russianRoulette?.weightThreshold ?? 0.25} onChange={(e) => updateSettings({ varianceReduction: { ...settings.varianceReduction, russianRoulette: { ...settings.varianceReduction?.russianRoulette!, weightThreshold: Number(e.target.value) } } })} />
              </label>
              <label>Survival weight
                <input type="number" step="0.01" value={settings.varianceReduction?.russianRoulette?.survivalWeight ?? 1.0} onChange={(e) => updateSettings({ varianceReduction: { ...settings.varianceReduction, russianRoulette: { ...settings.varianceReduction?.russianRoulette!, survivalWeight: Number(e.target.value) } } })} />
              </label>
            </>
          )}
        </div>
      </details>

      {/* ── Multi-Group Cross Sections ── */}
      <details className="review-section">
        <summary><h3>Multi-Group Cross Sections</h3></summary>
        <div className="physics-form">
          <label><input type="checkbox" checked={settings.mgxs?.enabled ?? false} onChange={(e) => updateSettings({ mgxs: { ...settings.mgxs, enabled: e.target.checked } })} /> Enable MGXS</label>
          {settings.mgxs?.enabled && (
            <>
              <label>Library path
                <input value={settings.mgxs?.libraryPath ?? ''} onChange={(e) => updateSettings({ mgxs: { ...settings.mgxs!, libraryPath: e.target.value || undefined } })} placeholder="/path/to/mgxs.h5" />
              </label>
              <label>Energy group name
                <input value={settings.mgxs?.energyGroups?.name ?? ''} onChange={(e) => updateSettings({ mgxs: { ...settings.mgxs!, energyGroups: { name: e.target.value, boundaries: settings.mgxs?.energyGroups?.boundaries ?? [] } } })} placeholder="CASMO-70" />
              </label>
              <label>Group boundaries (eV)
                <input value={(settings.mgxs?.energyGroups?.boundaries ?? []).join(' ')} onChange={(e) => updateSettings({ mgxs: { ...settings.mgxs!, energyGroups: { name: settings.mgxs?.energyGroups?.name ?? '', boundaries: e.target.value.split(/\s+/).map(Number).filter((v) => Number.isFinite(v)) } } })} placeholder="0 0.625e-6 20e6" />
              </label>
              <label>Domain type
                <select value={settings.mgxs?.domainType ?? 'cell'} onChange={(e) => updateSettings({ mgxs: { ...settings.mgxs!, domainType: e.target.value as 'cell' | 'material' | 'universe' } })}>
                  <option value="cell">Cell</option>
                  <option value="material">Material</option>
                  <option value="universe">Universe</option>
                </select>
              </label>
              <label>Domain IDs
                <input value={(settings.mgxs?.domainIds ?? []).join(' ')} onChange={(e) => updateSettings({ mgxs: { ...settings.mgxs!, domainIds: e.target.value.split(/\s+/).map(Number).filter((v) => Number.isFinite(v)) } })} placeholder="1 2 3" />
              </label>
              <label>Scatter format
                <select value={settings.mgxs?.scatterFormat ?? 'legendre'} onChange={(e) => updateSettings({ mgxs: { ...settings.mgxs!, scatterFormat: e.target.value as 'legendre' | 'histogram' } })}>
                  <option value="legendre">Legendre</option>
                  <option value="histogram">Histogram</option>
                </select>
              </label>
              <label>Scatter order
                <input type="number" value={settings.mgxs?.order ?? 3} onChange={(e) => updateSettings({ mgxs: { ...settings.mgxs!, order: Number(e.target.value) } })} />
              </label>
              <label>Temperature (K)
                <input type="number" value={settings.mgxs?.temperature ?? 293.6} onChange={(e) => updateSettings({ mgxs: { ...settings.mgxs!, temperature: Number(e.target.value) } })} />
              </label>
            </>
          )}
        </div>
      </details>

      {/* ── Stochastic Volume Calculation ── */}
      <details className="review-section">
        <summary><h3>Stochastic Volume Calculation</h3></summary>
        <div className="physics-form">
          <label><input type="checkbox" checked={settings.stochasticVolume?.enabled ?? false} onChange={(e) => updateSettings({ stochasticVolume: { ...settings.stochasticVolume, enabled: e.target.checked } })} /> Enable stochastic volume</label>
          {settings.stochasticVolume?.enabled && (
            <>
              <label>Domain type
                <select value={settings.stochasticVolume?.domainType ?? 'cell'} onChange={(e) => updateSettings({ stochasticVolume: { ...settings.stochasticVolume!, domainType: e.target.value as 'cell' | 'material' } })}>
                  <option value="cell">Cell</option>
                  <option value="material">Material</option>
                </select>
              </label>
              <label>Domain IDs
                <input value={(settings.stochasticVolume?.domainIds ?? []).join(' ')} onChange={(e) => updateSettings({ stochasticVolume: { ...settings.stochasticVolume!, domainIds: e.target.value.split(/\s+/).map(Number).filter((v) => Number.isFinite(v)) } })} placeholder="1 2 3" />
              </label>
              <label>Samples
                <input type="number" value={settings.stochasticVolume?.samples ?? 100000} onChange={(e) => updateSettings({ stochasticVolume: { ...settings.stochasticVolume!, samples: Number(e.target.value) } })} />
              </label>
            </>
          )}
        </div>
      </details>

      {/* ── Kinetics Parameters ── */}
      <details className="review-section">
        <summary><h3>Kinetics Parameters</h3></summary>
        <div className="physics-form">
          <label><input type="checkbox" checked={settings.kinetics?.enabled ?? false} onChange={(e) => updateSettings({ kinetics: { ...settings.kinetics, enabled: e.target.checked } })} /> Enable kinetics</label>
          {settings.kinetics?.enabled && (
            <>
              <label>Method
                <select value={settings.kinetics?.method ?? 'ifp'} onChange={(e) => updateSettings({ kinetics: { ...settings.kinetics!, method: e.target.value as 'ifp' | 'adj' } })}>
                  <option value="ifp">IFP (Iterated Fission Probability)</option>
                  <option value="adj">Adjoint</option>
                </select>
              </label>
              <label>Batches
                <input type="number" value={settings.kinetics?.batches ?? 50} onChange={(e) => updateSettings({ kinetics: { ...settings.kinetics!, batches: Number(e.target.value) } })} />
              </label>
              <label>Num generations
                <input type="number" value={settings.kinetics?.numGenerations ?? 5} onChange={(e) => updateSettings({ kinetics: { ...settings.kinetics!, numGenerations: Number(e.target.value) } })} />
              </label>
              <label>Time absorption
                <input type="number" step="1e-6" value={settings.kinetics?.timeAbsorption ?? 0} onChange={(e) => updateSettings({ kinetics: { ...settings.kinetics!, timeAbsorption: Number(e.target.value) } })} />
              </label>
            </>
          )}
        </div>
      </details>

      {/* ── Decay Sources ── */}
      <details className="review-section">
        <summary><h3>Decay Sources</h3></summary>
        <div className="physics-form">
          <label><input type="checkbox" checked={settings.decaySource?.enabled ?? false} onChange={(e) => updateSettings({ decaySource: { ...settings.decaySource, enabled: e.target.checked } })} /> Enable decay source</label>
          {settings.decaySource?.enabled && (
            <>
              <label>Chain files
                <input value={(settings.decaySource?.chains ?? []).join(' ')} onChange={(e) => updateSettings({ decaySource: { ...settings.decaySource!, chains: e.target.value.split(/\s+/).filter(Boolean) } })} placeholder="chain_endfb71.xml" />
              </label>
              <label>Timesteps
                <input value={(settings.decaySource?.timesteps ?? []).join(' ')} onChange={(e) => updateSettings({ decaySource: { ...settings.decaySource!, timesteps: e.target.value.split(/\s+/).map(Number).filter((v) => Number.isFinite(v)) } })} placeholder="1 2 3" />
              </label>
              <label>Units
                <select value={settings.decaySource?.timestepUnits ?? 's'} onChange={(e) => updateSettings({ decaySource: { ...settings.decaySource!, timestepUnits: e.target.value as 's' | 'd' | 'h' } })}>
                  <option value="s">Seconds</option>
                  <option value="d">Days</option>
                  <option value="h">Hours</option>
                </select>
              </label>
              <label>Particles
                <input type="number" value={settings.decaySource?.particles ?? 1000} onChange={(e) => updateSettings({ decaySource: { ...settings.decaySource!, particles: Number(e.target.value) } })} />
              </label>
              <label>Source rate
                <input type="number" value={settings.decaySource?.sourceRate ?? ''} onChange={(e) => updateSettings({ decaySource: { ...settings.decaySource!, sourceRate: Number(e.target.value) || undefined } })} placeholder="optional" />
              </label>
            </>
          )}
        </div>
      </details>

      {/* ── Random Ray Solver ── */}
      <details className="review-section">
        <summary><h3>Random Ray Solver</h3></summary>
        <div className="physics-form">
          <label><input type="checkbox" checked={settings.randomRay?.enabled ?? false} onChange={(e) => updateSettings({ randomRay: { ...settings.randomRay, enabled: e.target.checked } })} /> Enable random ray</label>
          {settings.randomRay?.enabled && (
            <>
              <label>Ray length (cm)
                <input type="number" value={settings.randomRay?.rayLength ?? 100} onChange={(e) => updateSettings({ randomRay: { ...settings.randomRay!, rayLength: Number(e.target.value) } })} />
              </label>
              <label>Rays per cell
                <input type="number" value={settings.randomRay?.raysPerCell ?? 100} onChange={(e) => updateSettings({ randomRay: { ...settings.randomRay!, raysPerCell: Number(e.target.value) } })} />
              </label>
              <label>Source type
                <select value={settings.randomRay?.sourceType ?? 'flat'} onChange={(e) => updateSettings({ randomRay: { ...settings.randomRay!, sourceType: e.target.value as 'flat' | 'linear' } })}>
                  <option value="flat">Flat</option>
                  <option value="linear">Linear</option>
                </select>
              </label>
              <label>Max iterations
                <input type="number" value={settings.randomRay?.maxIterations ?? 500} onChange={(e) => updateSettings({ randomRay: { ...settings.randomRay!, maxIterations: Number(e.target.value) } })} />
              </label>
              <label>Convergence tolerance
                <input type="number" step="1e-8" value={settings.randomRay?.convergenceTolerance ?? 1e-5} onChange={(e) => updateSettings({ randomRay: { ...settings.randomRay!, convergenceTolerance: Number(e.target.value) } })} />
              </label>
            </>
          )}
        </div>
      </details>

      {/* ── CMFD Acceleration ── */}
      <details className="review-section">
        <summary><h3>CMFD Acceleration</h3></summary>
        <div className="physics-form">
          <label><input type="checkbox" checked={settings.cmfd?.enabled ?? false} onChange={(e) => updateSettings({ cmfd: { ...settings.cmfd, enabled: e.target.checked } })} /> Enable CMFD</label>
          {settings.cmfd?.enabled && (
            <>
              <label>Mesh dimension
                <input value={(settings.cmfd?.meshDimension ?? []).join(' ')} onChange={(e) => updateSettings({ cmfd: { ...settings.cmfd!, meshDimension: e.target.value.split(/\s+/).map(Number).filter((v) => Number.isFinite(v)) as [number, number, number] } })} placeholder="10 10 1" />
              </label>
              <label>Lower left
                <input value={(settings.cmfd?.lowerLeft ?? []).join(' ')} onChange={(e) => updateSettings({ cmfd: { ...settings.cmfd!, lowerLeft: e.target.value.split(/\s+/).map(Number).filter((v) => Number.isFinite(v)) as [number, number, number] } })} placeholder="-10 -10 -10" />
              </label>
              <label>Upper right
                <input value={(settings.cmfd?.upperRight ?? []).join(' ')} onChange={(e) => updateSettings({ cmfd: { ...settings.cmfd!, upperRight: e.target.value.split(/\s+/).map(Number).filter((v) => Number.isFinite(v)) as [number, number, number] } })} placeholder="10 10 10" />
              </label>
              <label>Albedo (6 values)
                <input value={(settings.cmfd?.albedo ?? [1,1,1,1,1,1]).join(' ')} onChange={(e) => updateSettings({ cmfd: { ...settings.cmfd!, albedo: e.target.value.split(/\s+/).map(Number).filter((v) => Number.isFinite(v)) as [number, number, number, number, number, number] } })} placeholder="1 1 1 1 1 1" />
              </label>
              <label>Coarse group boundaries
                <input value={(settings.cmfd?.coarseGroupStructure ?? []).join(' ')} onChange={(e) => updateSettings({ cmfd: { ...settings.cmfd!, coarseGroupStructure: e.target.value.split(/\s+/).map(Number).filter((v) => Number.isFinite(v)) } })} placeholder="0 0.625e-6 20e6" />
              </label>
              <h4>Power Iteration</h4>
              <label>Tolerance
                <input type="number" step="1e-8" value={settings.cmfd?.powerIteration?.tolerance ?? 1e-6} onChange={(e) => updateSettings({ cmfd: { ...settings.cmfd!, powerIteration: { ...settings.cmfd?.powerIteration, tolerance: Number(e.target.value) } } })} />
              </label>
              <label>Max iterations
                <input type="number" value={settings.cmfd?.powerIteration?.maxIterations ?? 100} onChange={(e) => updateSettings({ cmfd: { ...settings.cmfd!, powerIteration: { ...settings.cmfd?.powerIteration, maxIterations: Number(e.target.value) } } })} />
              </label>
            </>
          )}
        </div>
      </details>

      {/* ── Photon Transport ── */}
      <details className="review-section">
        <summary><h3>Photon Transport</h3></summary>
        <div className="physics-form">
          <label><input type="checkbox" checked={settings.photonTransport?.enabled ?? false} onChange={(e) => updateSettings({ photonTransport: { ...settings.photonTransport, enabled: e.target.checked } })} /> Enable photon transport</label>
          {settings.photonTransport?.enabled && (
            <>
              <label><input type="checkbox" checked={settings.photonTransport?.captureGamma ?? true} onChange={(e) => updateSettings({ photonTransport: { ...settings.photonTransport!, captureGamma: e.target.checked } })} /> Capture gamma emission</label>
              <label><input type="checkbox" checked={settings.photonTransport?.electronTransport ?? false} onChange={(e) => updateSettings({ photonTransport: { ...settings.photonTransport!, electronTransport: e.target.checked } })} /> Electron transport</label>
              <label><input type="checkbox" checked={settings.photonTransport?.pairProduction ?? true} onChange={(e) => updateSettings({ photonTransport: { ...settings.photonTransport!, pairProduction: e.target.checked } })} /> Pair production</label>
              <label><input type="checkbox" checked={settings.photonTransport?.comptonScattering ?? true} onChange={(e) => updateSettings({ photonTransport: { ...settings.photonTransport!, comptonScattering: e.target.checked } })} /> Compton scattering</label>
              <label><input type="checkbox" checked={settings.photonTransport?.photoelectric ?? true} onChange={(e) => updateSettings({ photonTransport: { ...settings.photonTransport!, photoelectric: e.target.checked } })} /> Photoelectric effect</label>
            </>
          )}
        </div>
      </details>

      {/* ── CAD Import ── */}
      <details className="review-section">
        <summary><h3>CAD Import</h3></summary>
        <div className="physics-form">
          <label><input type="checkbox" checked={settings.cadImport?.enabled ?? false} onChange={(e) => updateSettings({ cadImport: { ...settings.cadImport, enabled: e.target.checked } })} /> Enable CAD import</label>
          {settings.cadImport?.enabled && (
            <>
              <label>File path
                <input value={settings.cadImport?.filePath ?? ''} onChange={(e) => updateSettings({ cadImport: { ...settings.cadImport!, filePath: e.target.value || undefined } })} placeholder="/path/to/model.step" />
              </label>
              <label>Format
                <select value={settings.cadImport?.format ?? 'step'} onChange={(e) => updateSettings({ cadImport: { ...settings.cadImport!, format: e.target.value as 'step' | 'stl' | 'brep' } })}>
                  <option value="step">STEP</option>
                  <option value="stl">STL</option>
                  <option value="brep">BREP</option>
                </select>
              </label>
              <label>Tolerance
                <input type="number" step="0.001" value={settings.cadImport?.tolerance ?? 1e-3} onChange={(e) => updateSettings({ cadImport: { ...settings.cadImport!, tolerance: Number(e.target.value) } })} />
              </label>
            </>
          )}
        </div>
      </details>

      {/* ── MPI Configuration ── */}
      <details className="review-section">
        <summary><h3>MPI / Parallel Execution</h3></summary>
        <div className="physics-form">
          <label><input type="checkbox" checked={settings.mpi?.enabled ?? false} onChange={(e) => updateSettings({ mpi: { ...settings.mpi, enabled: e.target.checked } })} /> Enable MPI</label>
          {settings.mpi?.enabled && (
            <>
              <label>Processes (MPI ranks)
                <input type="number" value={settings.mpi?.processes ?? 1} onChange={(e) => updateSettings({ mpi: { ...settings.mpi!, processes: Number(e.target.value) } })} />
              </label>
              <label>Threads (OpenMP)
                <input type="number" value={settings.mpi?.threads ?? 1} onChange={(e) => updateSettings({ mpi: { ...settings.mpi!, threads: Number(e.target.value) } })} />
              </label>
              <label><input type="checkbox" checked={settings.mpi?.domainDecomposition ?? false} onChange={(e) => updateSettings({ mpi: { ...settings.mpi!, domainDecomposition: e.target.checked } })} /> Domain decomposition</label>
              {settings.mpi?.domainDecomposition && (
                <label>Domains (x y z)
                  <input value={(settings.mpi?.domains ?? [1,1,1]).join(' ')} onChange={(e) => updateSettings({ mpi: { ...settings.mpi!, domains: e.target.value.split(/\s+/).map(Number).filter((v) => Number.isFinite(v)) as [number, number, number] } })} placeholder="2 2 1" />
                </label>
              )}
            </>
          )}
        </div>
      </details>

      {/* ── Perturbation / Sensitivity ── */}
      <details className="review-section">
        <summary><h3>Perturbation / Sensitivity</h3></summary>
        <div className="physics-form">
          <label><input type="checkbox" checked={settings.perturbation?.enabled ?? false} onChange={(e) => updateSettings({ perturbation: { ...settings.perturbation, enabled: e.target.checked } })} /> Enable perturbation</label>
          {settings.perturbation?.enabled && (
            <>
              <label>Method
                <select value={settings.perturbation?.method ?? 'ifp'} onChange={(e) => updateSettings({ perturbation: { ...settings.perturbation!, method: e.target.value as 'ifp' | 'diff' } })}>
                  <option value="ifp">IFP</option>
                  <option value="diff">Differential</option>
                </select>
              </label>
              <label>Nuclides
                <input value={(settings.perturbation?.nuclides ?? []).join(' ')} onChange={(e) => updateSettings({ perturbation: { ...settings.perturbation!, nuclides: e.target.value.split(/\s+/).filter(Boolean) } })} placeholder="U235 U238" />
              </label>
              <label>Reactions
                <input value={(settings.perturbation?.reactions ?? []).join(' ')} onChange={(e) => updateSettings({ perturbation: { ...settings.perturbation!, reactions: e.target.value.split(/\s+/).filter(Boolean) } })} placeholder="fission capture" />
              </label>
              <label><input type="checkbox" checked={settings.perturbation?.deltaK ?? false} onChange={(e) => updateSettings({ perturbation: { ...settings.perturbation!, deltaK: e.target.checked } })} /> Compute delta-k</label>
              <label><input type="checkbox" checked={settings.perturbation?.coefficients ?? false} onChange={(e) => updateSettings({ perturbation: { ...settings.perturbation!, coefficients: e.target.checked } })} /> Compute coefficients</label>
            </>
          )}
        </div>
      </details>
    </div>
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

function ToolPalette({ paintTool, onSelect }: { paintTool: PaintTool; onSelect: (tool: PaintTool) => void }) {
  return (
    <div className="tool-palette" aria-label="Canvas paint tools">
      {paintTools.map((tool) => (
        <button key={tool.id} className={paintTool === tool.id ? 'paint-tool active' : 'paint-tool'} onClick={() => onSelect(tool.id)}>
          <span className="paint-swatch" style={{ '--cell-color': tool.color } as CSSProperties} />
          <span>{tool.label}</span>
        </button>
      ))}
    </div>
  );
}

function OpenMcGeometrySummary({ project }: { project: ProjectBundle }) {
  const geometry = project.model.openmcGeometry;
  if (!geometry || (geometry.surfaces.length === 0 && geometry.cells.length === 0)) {
    return <p className="muted">No OpenMC-native CSG entities yet.</p>;
  }

  return (
    <div className="csg-summary">
      <strong>{geometry.surfaces.length} surfaces</strong>
      <strong>{geometry.cells.length} cells</strong>
      {geometry.cells.map((cell) => (
        <span key={cell.id}>{cell.name}: region {cell.region}</span>
      ))}
    </div>
  );
}

function CsgDiagram({ project }: { project: ProjectBundle }) {
  const geometry = project.model.openmcGeometry;
  if (!geometry || geometry.surfaces.length === 0) {
    return (
      <div className="csg-diagram empty-state">
        <p className="eyebrow">CSG diagram</p>
        <h3>No OpenMC geometry yet</h3>
        <p>Add a sphere, cylinder, or slab. The diagram will show OpenMC surfaces and cells, not a fake reactor drawing.</p>
      </div>
    );
  }

  return (
    <div className="csg-diagram">
      <div className="diagram-header">
        <div>
          <p className="eyebrow">CSG diagram</p>
          <h3>OpenMC surfaces and regions</h3>
        </div>
        <span>{geometry.surfaces.length} surfaces / {geometry.cells.length} cells</span>
      </div>
      <svg viewBox="0 0 640 360" role="img" aria-label="OpenMC constructive solid geometry schematic">
        <defs>
          <radialGradient id="diagramGlow" cx="50%" cy="45%" r="60%">
            <stop offset="0%" stopColor="rgba(94,234,212,0.28)" />
            <stop offset="100%" stopColor="rgba(15,23,42,0)" />
          </radialGradient>
        </defs>
        <rect x="16" y="16" width="608" height="328" rx="24" className="diagram-frame" />
        <rect x="34" y="34" width="572" height="292" rx="18" fill="url(#diagramGlow)" />
        <line x1="320" y1="44" x2="320" y2="316" className="diagram-axis" />
        <line x1="64" y1="180" x2="576" y2="180" className="diagram-axis" />
        {geometry.surfaces.map((surface, index) => <SurfaceGlyph key={surface.id} surface={surface} index={index} />)}
      </svg>
      <div className="diagram-cell-list">
        {geometry.cells.map((cell) => (
          <div key={cell.id} className="diagram-cell">
            <strong>{cell.name}</strong>
            <code>{cell.region}</code>
            <span>{cell.materialId ?? 'void'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SurfaceGlyph({ surface, index }: { surface: NonNullable<ReactorModel['openmcGeometry']>['surfaces'][number]; index: number }) {
  const offset = index * 18;
  const label = `S${surface.openmcId}`;
  if (surface.type === 'sphere') {
    const radius = Math.max(44, Math.min(122, (surface.coeffs[3] ?? 10) * 7));
    return (
      <g>
        <circle cx="320" cy="180" r={radius} className="surface-glyph" />
        <text x={330 + radius * 0.65} y={168 - offset * 0.15} className="surface-label">{label} sphere r={surface.coeffs[3] ?? '?'}</text>
      </g>
    );
  }
  if (surface.type === 'z-cylinder') {
    const radius = Math.max(40, Math.min(132, (surface.coeffs[2] ?? 5) * 13));
    return (
      <g>
        <circle cx="320" cy="180" r={radius} className="surface-glyph cylinder" />
        <text x={330 + radius * 0.55} y={202 + offset * 0.08} className="surface-label">{label} z-cylinder r={surface.coeffs[2] ?? '?'}</text>
      </g>
    );
  }
  if (surface.type === 'x-plane') {
    const x = 320 + Math.max(-220, Math.min(220, (surface.coeffs[0] ?? 0) * 9));
    return (
      <g>
        <line x1={x} y1="58" x2={x} y2="302" className="surface-plane" />
        <text x={x + 8} y={72 + offset} className="surface-label">{label} x={surface.coeffs[0] ?? '?'}</text>
      </g>
    );
  }
  if (surface.type === 'y-plane') {
    const y = 180 - Math.max(-120, Math.min(120, (surface.coeffs[0] ?? 0) * 9));
    return (
      <g>
        <line x1="76" y1={y} x2="564" y2={y} className="surface-plane" />
        <text x="82" y={y - 8} className="surface-label">{label} y={surface.coeffs[0] ?? '?'}</text>
      </g>
    );
  }
  return <text x="54" y={68 + offset} className="surface-label">{label} {surface.type}</text>;
}

function CsgEditor({ project, onChange }: { project: ProjectBundle; onChange: (project: ProjectBundle) => void }) {
  const geometry = project.model.openmcGeometry;
  if (!geometry || geometry.surfaces.length === 0) {
    return null;
  }

  function updateSurface(surfaceId: string, updates: Partial<NonNullable<ReactorModel['openmcGeometry']>['surfaces'][number]>) {
    if (!geometry) return;
    onChange(withOpenMcGeometry(project, { ...geometry, surfaces: geometry.surfaces.map((surface) => (surface.id === surfaceId ? { ...surface, ...updates } : surface)) }));
  }

  function updateCell(cellId: string, updates: Partial<NonNullable<ReactorModel['openmcGeometry']>['cells'][number]>) {
    if (!geometry) return;
    onChange(withOpenMcGeometry(project, { ...geometry, cells: geometry.cells.map((cell) => (cell.id === cellId ? { ...cell, ...updates } : cell)) }));
  }

  function addMaterial(kind: 'water' | 'uo2' | 'steel' | 'graphite') {
    onChange(addMaterialToProject(project, kind));
  }

  function updatePlotBasis(plotBasis: 'xy' | 'xz' | 'yz') {
    onChange({ ...project, model: { ...project.model, settings: { ...project.model.settings, plotBasis } } });
  }

  return (
    <div className="csg-editor">
      <h3>CSG editor</h3>
      <p className="muted">Edit actual OpenMC surface coefficients and cell Boolean regions.</p>
      <div className="tool-grid">
        <button className="tool-button" onClick={() => addMaterial('water')}>Add water</button>
        <button className="tool-button" onClick={() => addMaterial('uo2')}>Add UO2</button>
        <button className="tool-button" onClick={() => addMaterial('steel')}>Add steel</button>
        <button className="tool-button" onClick={() => addMaterial('graphite')}>Add graphite</button>
      </div>
      <label htmlFor="plot-basis">OpenMC plot basis</label>
      <select id="plot-basis" value={project.model.settings.plotBasis ?? (project.model.family === 'shielding-fixed-source' ? 'xz' : 'xy')} onChange={(event) => updatePlotBasis(event.target.value as 'xy' | 'xz' | 'yz')}>
        <option value="xy">xy top slice</option>
        <option value="xz">xz side slice</option>
        <option value="yz">yz side slice</option>
      </select>
      {geometry.surfaces.map((surface) => (
        <div key={surface.id} className="csg-edit-row">
          <strong>{surface.name}</strong>
          <span>{surface.type} #{surface.openmcId}</span>
          {surface.type === 'macrobody' ? (
            <>
              <label htmlFor={`${surface.id}-halfspaces`}>halfspaces (a b c d per line)</label>
              <textarea
                id={`${surface.id}-halfspaces`}
                value={serializeMacrobodyHalfspaces(surface.coeffs)}
                onChange={(event) => updateSurface(surface.id, { coeffs: parseMacrobodyHalfspaces(event.target.value) })}
                rows={5}
              />
              <MacrobodyPreview halfspaces={coeffsToHalfspaces(surface.coeffs)} />
            </>
          ) : (
            <>
              <label htmlFor={`${surface.id}-coeffs`}>coeffs</label>
              <input id={`${surface.id}-coeffs`} value={surface.coeffs.join(' ')} onChange={(event) => updateSurface(surface.id, { coeffs: parseNumberList(event.target.value) })} />
            </>
          )}
          <label htmlFor={`${surface.id}-boundary`}>boundary</label>
          <select id={`${surface.id}-boundary`} value={surface.boundary ?? 'transmission'} onChange={(event) => updateSurface(surface.id, { boundary: event.target.value as NonNullable<typeof surface.boundary> })}>
            {['transmission', 'vacuum', 'reflective', 'periodic', 'white'].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </div>
      ))}
      {geometry.cells.map((cell) => (
        <div key={cell.id} className="csg-edit-row">
          <strong>{cell.name}</strong>
          <span>cell #{cell.openmcId}</span>
          <label htmlFor={`${cell.id}-region`}>region expression</label>
          <input id={`${cell.id}-region`} value={cell.region} onChange={(event) => updateCell(cell.id, { region: event.target.value })} />
          <div className="region-actions">
            {geometry.surfaces.map((surface) => (
              <button key={`${cell.id}-inside-${surface.id}`} className="mini-action" onClick={() => updateCell(cell.id, { region: `-${surface.openmcId}` })}>
                inside {surface.openmcId}
              </button>
            ))}
            {geometry.surfaces.map((surface) => (
              <button key={`${cell.id}-outside-${surface.id}`} className="mini-action" onClick={() => updateCell(cell.id, { region: `+${surface.openmcId}` })}>
                outside {surface.openmcId}
              </button>
            ))}
            {geometry.surfaces.length >= 2 && (
              <button className="mini-action" onClick={() => updateCell(cell.id, { region: `+${geometry.surfaces[0].openmcId} -${geometry.surfaces[1].openmcId}` })}>
                between first two
              </button>
            )}
          </div>
          <label htmlFor={`${cell.id}-material`}>material</label>
          <select id={`${cell.id}-material`} value={cell.materialId ?? ''} onChange={(event) => updateCell(cell.id, { materialId: event.target.value || undefined })}>
            <option value="">void</option>
            {project.model.materials.materials.map((material) => <option key={material.id} value={material.id}>{material.name}</option>)}
          </select>
        </div>
      ))}
    </div>
  );
}

function parseNumberList(value: string): number[] {
  return value.split(/[\s,]+/).filter(Boolean).map(Number).filter((item) => Number.isFinite(item));
}

function coeffsToHalfspaces(coeffs: number[]): [number, number, number, number][] {
  const halfspaces: [number, number, number, number][] = [];
  for (let index = 0; index + 3 < coeffs.length; index += 4) {
    halfspaces.push([coeffs[index], coeffs[index + 1], coeffs[index + 2], coeffs[index + 3]]);
  }
  return halfspaces;
}

function parseMacrobodyHalfspaces(value: string): number[] {
  return value
    .split(/\n+/)
    .flatMap((line) => line.split(/[\s,]+/).filter(Boolean).map(Number))
    .filter((n) => Number.isFinite(n));
}

function serializeMacrobodyHalfspaces(coeffs: number[]): string {
  return coeffsToHalfspaces(coeffs).map((hs) => hs.join(' ')).join('\n');
}

function clipPolygonWithHalfspace(polygon: [number, number][], halfspace: [number, number, number, number]): [number, number][] {
  const [a, b, , d] = halfspace;
  const inside = (p: [number, number]) => a * p[0] + b * p[1] <= d + 1e-8;
  const intersect = (p1: [number, number], p2: [number, number]): [number, number] => {
    const f1 = a * p1[0] + b * p1[1] - d;
    const f2 = a * p2[0] + b * p2[1] - d;
    const t = f1 / (f1 - f2 || 1e-9);
    return [p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1])];
  };

  const result: [number, number][] = [];
  for (let i = 0; i < polygon.length; i += 1) {
    const current = polygon[i];
    const next = polygon[(i + 1) % polygon.length];
    const currentInside = inside(current);
    const nextInside = inside(next);
    if (currentInside && nextInside) result.push(next);
    else if (currentInside && !nextInside) result.push(intersect(current, next));
    else if (!currentInside && nextInside) {
      result.push(intersect(current, next));
      result.push(next);
    }
  }
  return result;
}

function MacrobodyPreview({ halfspaces }: { halfspaces: [number, number, number, number][] }) {
  const polygon = useMemo(() => {
    let poly: [number, number][] = [
      [-20, -20],
      [20, -20],
      [20, 20],
      [-20, 20],
    ];
    for (const halfspace of halfspaces) {
      if (Math.abs(halfspace[0]) < 1e-9 && Math.abs(halfspace[1]) < 1e-9) continue;
      poly = clipPolygonWithHalfspace(poly, halfspace);
      if (poly.length === 0) break;
    }
    return poly;
  }, [halfspaces]);

  const points = polygon
    .map(([x, y]) => `${320 + x * 8},${180 - y * 8}`)
    .join(' ');

  return (
    <div>
      <p className="muted">2D preview (xy slice clipped by halfspaces)</p>
      <svg viewBox="0 0 640 360" role="img" aria-label="Macrobody 2D preview">
        <rect x="16" y="16" width="608" height="328" rx="20" className="diagram-frame" />
        <line x1="320" y1="34" x2="320" y2="326" className="diagram-axis" />
        <line x1="34" y1="180" x2="606" y2="180" className="diagram-axis" />
        {polygon.length >= 3 ? <polygon points={points} className="surface-glyph" fill="rgba(56,189,248,.2)" /> : <text x="44" y="54" className="surface-label">No bounded polygon from current halfspaces.</text>}
      </svg>
    </div>
  );
}

function ComponentBuilder({ project, onChange }: { project: ProjectBundle; onChange: (project: ProjectBundle) => void }) {
  const components = project.model.components ?? { pinCellTypes: [], assemblyTypes: [] };
  const [activeTab, setActiveTab] = useState<'pins' | 'assemblies' | 'core'>('pins');

  function ensureMaterials(): ProjectBundle {
    if (project.model.materials.materials.length > 0) return project;
    let p = addMaterialToProject(project, 'uo2');
    p = addMaterialToProject(p, 'water');
    p = addMaterialToProject(p, 'steel');
    return p;
  }

  function addPinCell() {
    const p = ensureMaterials();
    const mat = p.model.materials.materials;
    const newPin: PinCellType = {
      id: `pin-${safeRandomUUID().slice(0, 8)}`,
      name: `Pin ${components.pinCellTypes.length + 1}`,
      rings: [
        { id: `ring-${safeRandomUUID().slice(0, 8)}`, name: 'fuel', outerRadius: 0.41, materialId: mat[0]?.id ?? '' },
        { id: `ring-${safeRandomUUID().slice(0, 8)}`, name: 'gap', outerRadius: 0.45, materialId: mat[0]?.id ?? '' },
        { id: `ring-${safeRandomUUID().slice(0, 8)}`, name: 'clad', outerRadius: 0.475, materialId: mat.length > 2 ? mat[2].id : mat[0]?.id ?? '' },
      ],
      pitch: 1.26,
      moderatorMaterialId: mat.length > 1 ? mat[1].id : '',
    };
    onChange({ ...p, model: { ...p.model, components: { ...components, pinCellTypes: [...components.pinCellTypes, newPin] } } });
  }

  function addAssembly() {
    const p = ensureMaterials();
    const size = 3;
    const defaultPinId = components.pinCellTypes[0]?.id ?? '';
    const map = Array.from({ length: size }, () => Array.from({ length: size }, () => defaultPinId));
    const newAssembly: AssemblyType = {
      id: `asm-${safeRandomUUID().slice(0, 8)}`,
      name: `Assembly ${components.assemblyTypes.length + 1}`,
      latticeKind: 'rect',
      rows: size,
      columns: size,
      pitch: 1.26,
      pinMap: map,
    };
    onChange({ ...p, model: { ...p.model, components: { ...components, assemblyTypes: [...components.assemblyTypes, newAssembly] } } });
  }

  function updatePinCell(pinId: string, updates: Partial<PinCellType>) {
    onChange({ ...project, model: { ...project.model, components: { ...components, pinCellTypes: components.pinCellTypes.map((pin) => (pin.id === pinId ? { ...pin, ...updates } : pin)) } } });
  }

  function updateAssembly(asmId: string, updates: Partial<AssemblyType>) {
    onChange({ ...project, model: { ...project.model, components: { ...components, assemblyTypes: components.assemblyTypes.map((asm) => (asm.id === asmId ? { ...asm, ...updates } : asm)) } } });
  }

  function updatePinRing(pinId: string, ringId: string, updates: Partial<PinCellType['rings'][number]>) {
    const pin = components.pinCellTypes.find((p) => p.id === pinId);
    if (!pin) return;
    updatePinCell(pinId, { rings: pin.rings.map((ring) => (ring.id === ringId ? { ...ring, ...updates } : ring)) });
  }

  return (
    <div className="component-builder">
      <h3>Component-based builder</h3>
      <p className="muted">Create pin cells, assemble into lattices, compose a core. OpenMC universes and lattices are generated automatically.</p>
      <div className="tab-bar">
        <button className={activeTab === 'pins' ? 'tab active' : 'tab'} onClick={() => setActiveTab('pins')}>Pin cells</button>
        <button className={activeTab === 'assemblies' ? 'tab active' : 'tab'} onClick={() => setActiveTab('assemblies')}>Assemblies</button>
        <button className={activeTab === 'core' ? 'tab active' : 'tab'} onClick={() => setActiveTab('core')}>Core</button>
      </div>

      {activeTab === 'pins' && (
        <div className="component-list">
          {components.pinCellTypes.map((pin) => (
            <div key={pin.id} className="component-card">
              <label htmlFor={`${pin.id}-name`}>Name</label>
              <input id={`${pin.id}-name`} value={pin.name} onChange={(e) => updatePinCell(pin.id, { name: e.target.value })} />
              <label htmlFor={`${pin.id}-pitch`}>Pitch (cm)</label>
              <input id={`${pin.id}-pitch`} type="number" value={pin.pitch} onChange={(e) => updatePinCell(pin.id, { pitch: Number(e.target.value) })} />
              <div className="ring-list">
                {pin.rings.map((ring) => (
                  <div key={ring.id} className="ring-row">
                    <span>{ring.name}</span>
                    <label htmlFor={`${ring.id}-r`}>r</label>
                    <input id={`${ring.id}-r`} type="number" value={ring.outerRadius} onChange={(e) => updatePinRing(pin.id, ring.id, { outerRadius: Number(e.target.value) })} />
                    <label htmlFor={`${ring.id}-mat`}>mat</label>
                    <select id={`${ring.id}-mat`} value={ring.materialId} onChange={(e) => updatePinRing(pin.id, ring.id, { materialId: e.target.value })}>
                      {project.model.materials.materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  </div>
                ))}
              </div>
              <label htmlFor={`${pin.id}-mod`}>Moderator material</label>
              <select id={`${pin.id}-mod`} value={pin.moderatorMaterialId} onChange={(e) => updatePinCell(pin.id, { moderatorMaterialId: e.target.value })}>
                {project.model.materials.materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
          ))}
          <button className="secondary-action full-width" onClick={addPinCell}>+ Pin cell type</button>
        </div>
      )}

      {activeTab === 'assemblies' && (
        <div className="component-list">
          {components.assemblyTypes.map((asm) => (
            <div key={asm.id} className="component-card">
              <label htmlFor={`${asm.id}-name`}>Name</label>
              <input id={`${asm.id}-name`} value={asm.name} onChange={(e) => updateAssembly(asm.id, { name: e.target.value })} />
              <label htmlFor={`${asm.id}-rows`}>Rows</label>
              <input id={`${asm.id}-rows`} type="number" value={asm.rows} onChange={(e) => {
                const newRows = Number(e.target.value);
                const currentMap = asm.pinMap;
                const defaultPinId = components.pinCellTypes[0]?.id ?? '';
                const newMap = Array.from({ length: newRows }, (_, r) => currentMap[r] ?? Array.from({ length: asm.columns }, () => defaultPinId));
                updateAssembly(asm.id, { rows: newRows, pinMap: newMap });
              }} />
              <label htmlFor={`${asm.id}-cols`}>Columns</label>
              <input id={`${asm.id}-cols`} type="number" value={asm.columns} onChange={(e) => {
                const newCols = Number(e.target.value);
                const defaultPinId = components.pinCellTypes[0]?.id ?? '';
                const newMap = asm.pinMap.map((row) => {
                  const newRow = [...row];
                  while (newRow.length < newCols) newRow.push(defaultPinId);
                  return newRow.slice(0, newCols);
                });
                updateAssembly(asm.id, { columns: newCols, pinMap: newMap });
              }} />
              <label htmlFor={`${asm.id}-pitch`}>Pitch (cm)</label>
              <input id={`${asm.id}-pitch`} type="number" value={asm.pitch} onChange={(e) => updateAssembly(asm.id, { pitch: Number(e.target.value) })} />
              <label htmlFor={`${asm.id}-kind`}>Lattice kind</label>
              <select id={`${asm.id}-kind`} value={asm.latticeKind} onChange={(e) => updateAssembly(asm.id, { latticeKind: e.target.value as 'rect' | 'hex' })}>
                <option value="rect">Rectangular</option>
                <option value="hex">Hexagonal</option>
              </select>
              <div className="pin-map-editor">
                <h4>Pin map</h4>
                <p className="muted">Click a cell to change its pin type.</p>
                <div className="pin-map-grid" style={{ gridTemplateColumns: `repeat(${asm.columns}, minmax(36px, 1fr))` }}>
                  {asm.pinMap.flatMap((row, rowIdx) =>
                    row.map((pinId, colIdx) => {
                      const pin = components.pinCellTypes.find((p) => p.id === pinId);
                      return (
                        <button
                          key={`${rowIdx}-${colIdx}`}
                          className="pin-map-cell"
                          title={pin?.name ?? 'empty'}
                          onClick={() => {
                            const currentIdx = components.pinCellTypes.findIndex((p) => p.id === pinId);
                            const nextIdx = (currentIdx + 1) % Math.max(1, components.pinCellTypes.length);
                            const nextPinId = components.pinCellTypes[nextIdx]?.id ?? '';
                            const newMap = asm.pinMap.map((r, ri) => r.map((c, ci) => (ri === rowIdx && ci === colIdx ? nextPinId : c)));
                            updateAssembly(asm.id, { pinMap: newMap });
                          }}
                        >
                          {pin?.name?.slice(0, 3) ?? '—'}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          ))}
          <button className="secondary-action full-width" onClick={addAssembly}>+ Assembly type</button>
        </div>
      )}

      {activeTab === 'core' && (
        <div className="component-list">
          <p className="muted">Core layout assigns assembly types to positions in a lattice.</p>
          <button className="secondary-action full-width" onClick={() => {
            const defaultAsmId = components.assemblyTypes[0]?.id ?? '';
            const size = 3;
            const map = Array.from({ length: size }, () => Array.from({ length: size }, () => defaultAsmId));
            onChange({ ...project, model: { ...project.model, components: { ...components, coreLayout: { latticeKind: 'rect', rows: size, columns: size, assemblyPitch: 21.5, assemblyMap: map } } } });
          }}>+ Core layout (3×3 default)</button>
          {components.coreLayout && (
            <div className="component-card">
              <strong>Core layout</strong>
              <span>{components.coreLayout.rows}×{components.coreLayout.columns} {components.coreLayout.latticeKind} lattice</span>
              <label htmlFor="core-pitch">Assembly pitch (cm)</label>
              <input id="core-pitch" type="number" value={components.coreLayout.assemblyPitch} onChange={(e) => {
                onChange({ ...project, model: { ...project.model, components: { ...components, coreLayout: { ...components.coreLayout!, assemblyPitch: Number(e.target.value) } } } });
              }} />
              <label htmlFor="core-reflector">Reflector material</label>
              <select id="core-reflector" value={components.coreLayout.reflectorMaterialId ?? ''} onChange={(e) => {
                onChange({ ...project, model: { ...project.model, components: { ...components, coreLayout: { ...components.coreLayout!, reflectorMaterialId: e.target.value || undefined } } } });
              }}>
                <option value="">None</option>
                {project.model.materials.materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              <label htmlFor="core-vessel-mat">Vessel material</label>
              <select id="core-vessel-mat" value={components.coreLayout.vesselMaterialId ?? ''} onChange={(e) => {
                onChange({ ...project, model: { ...project.model, components: { ...components, coreLayout: { ...components.coreLayout!, vesselMaterialId: e.target.value || undefined } } } });
              }}>
                <option value="">None</option>
                {project.model.materials.materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              {components.coreLayout.vesselMaterialId && (
                <>
                  <label htmlFor="core-vessel-thick">Vessel thickness (cm)</label>
                  <input id="core-vessel-thick" type="number" value={components.coreLayout.vesselThickness ?? 10} onChange={(e) => {
                    onChange({ ...project, model: { ...project.model, components: { ...components, coreLayout: { ...components.coreLayout!, vesselThickness: Number(e.target.value) } } } });
                  }} />
                </>
              )}
              <div className="pin-map-editor">
                <h4>Assembly map</h4>
                <p className="muted">Click a cell to change its assembly type.</p>
                <div className="pin-map-grid" style={{ gridTemplateColumns: `repeat(${components.coreLayout.columns}, minmax(42px, 1fr))` }}>
                  {components.coreLayout.assemblyMap.flatMap((row, rowIdx) =>
                    row.map((asmId, colIdx) => {
                      const asm = components.assemblyTypes.find((a) => a.id === asmId);
                      return (
                        <button
                          key={`${rowIdx}-${colIdx}`}
                          className="pin-map-cell assembly-cell"
                          title={asm?.name ?? 'empty'}
                          onClick={() => {
                            const currentIdx = components.assemblyTypes.findIndex((a) => a.id === asmId);
                            const nextIdx = (currentIdx + 1) % Math.max(1, components.assemblyTypes.length);
                            const nextAsmId = components.assemblyTypes[nextIdx]?.id ?? '';
                            const newMap = components.coreLayout!.assemblyMap.map((r, ri) => r.map((c, ci) => (ri === rowIdx && ci === colIdx ? nextAsmId : c)));
                            onChange({ ...project, model: { ...project.model, components: { ...components, coreLayout: { ...components.coreLayout!, assemblyMap: newMap } } } });
                          }}
                        >
                          {asm?.name?.slice(0, 4) ?? '—'}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const modelingIntents: { id: ModelingIntent; label: string; description: string }[] = [
  { id: 'core', label: 'Reactor core', description: 'Core map, assemblies, reflector, control positions.' },
  { id: 'assembly', label: 'Assembly / pin cell', description: 'Fuel pins, guide tubes, moderator cells.' },
  { id: 'shielding', label: 'Shielding / source', description: 'Layered fixed-source shielding and detector layouts.' },
  { id: 'custom', label: 'Custom geometry', description: 'Freeform regions before translating to OpenMC CSG.' },
  { id: 'import', label: 'Import existing', description: 'Bring existing OpenMC files into the visual workflow.' },
];

const layoutModes: { id: LayoutMode; label: string; intents: ModelingIntent[] }[] = [
  { id: 'circular-core', label: 'Circular core', intents: ['core', 'custom'] },
  { id: 'rect-lattice', label: 'Rect lattice', intents: ['core', 'assembly', 'custom'] },
  { id: 'hex-lattice', label: 'Hex lattice', intents: ['core', 'assembly', 'custom'] },
  { id: 'freeform', label: 'Freeform', intents: ['custom', 'import'] },
  { id: 'layer-stack', label: 'Layer stack', intents: ['shielding', 'custom'] },
];

const paintTools: { id: PaintTool; label: string; value: string; color: string }[] = [
  { id: 'fuel', label: 'Fuel', value: 'fuel-zone', color: '#f59e0b' },
  { id: 'reflector', label: 'Reflector', value: 'reflector', color: '#60a5fa' },
  { id: 'moderator', label: 'Moderator', value: 'moderator', color: '#38bdf8' },
  { id: 'control', label: 'Control rod', value: 'control', color: '#ef4444' },
  { id: 'source', label: 'Source', value: 'source', color: '#fb7185' },
  { id: 'tally', label: 'Tally', value: 'tally', color: '#a78bfa' },
  { id: 'void', label: 'Void', value: '', color: 'rgba(148, 163, 184, 0.32)' },
];

function layoutModesForIntent(intent: ModelingIntent) {
  return layoutModes.filter((mode) => mode.intents.includes(intent));
}

function valueForPaintTool(tool: PaintTool): string {
  return paintTools.find((item) => item.id === tool)?.value ?? 'fuel-zone';
}

function createVisualProjectBundle(intent: ModelingIntent, mode: LayoutMode): ProjectBundle {
  const family = familyForIntent(intent);
  const now = new Date().toISOString();
  const model = createVisualModel(intent, mode, family);
  return {
    manifest: {
      schemaVersion: 1,
      id: safeRandomUUID(),
      name: `${labelForIntent(intent)} Visual Model`,
      createdAt: now,
      updatedAt: now,
      defaultUnits: 'nuclear-common',
      reactorFamily: family,
      modelPath: 'model/model.json',
    },
    model,
  };
}

function createSphereRecipe(): ProjectBundle {
  const project = createVisualProjectBundle('custom', 'freeform');
  const withMaterial = addMaterialToProject(project, 'water');
  return withOpenMcGeometry(withMaterial, {
    surfaces: [{ id: 'surf-sphere-1', openmcId: 1, name: 'Vacuum sphere boundary', type: 'sphere', coeffs: [0, 0, 0, 10], boundary: 'vacuum' }],
    cells: [{ id: 'cell-sphere-1', openmcId: 1, name: 'Water inside sphere', materialId: 'mat-water', region: '-1' }],
  });
}

function createFuelPinRecipe(): ProjectBundle {
  let project = createVisualProjectBundle('assembly', 'rect-lattice');
  project = addMaterialToProject(addMaterialToProject(project, 'uo2'), 'water');
  return withOpenMcGeometry(project, {
    surfaces: [
      { id: 'surf-fuel-radius', openmcId: 1, name: 'Fuel pellet radius', type: 'z-cylinder', coeffs: [0, 0, 0.41] },
      { id: 'surf-pin-boundary', openmcId: 2, name: 'Pin cell boundary', type: 'z-cylinder', coeffs: [0, 0, 0.63], boundary: 'vacuum' },
    ],
    cells: [
      { id: 'cell-fuel', openmcId: 1, name: 'Fuel pellet', materialId: 'mat-uo2', region: '-1' },
      { id: 'cell-moderator', openmcId: 2, name: 'Moderator around fuel', materialId: 'mat-water', region: '+1 -2' },
    ],
  });
}

function createShieldingSlabRecipe(): ProjectBundle {
  let project = createVisualProjectBundle('shielding', 'layer-stack');
  project = addMaterialToProject(project, 'steel');
  return withOpenMcGeometry(project, {
    surfaces: [
      { id: 'surf-slab-left', openmcId: 1, name: 'Slab left face', type: 'x-plane', coeffs: [-5] },
      { id: 'surf-slab-right', openmcId: 2, name: 'Slab right face', type: 'x-plane', coeffs: [5], boundary: 'vacuum' },
    ],
    cells: [{ id: 'cell-shield', openmcId: 1, name: 'Steel shield layer', materialId: 'mat-steel', region: '+1 -2' }],
  });
}

function createVisualModel(intent: ModelingIntent, mode: LayoutMode, family: ReactorFamily): ReactorModel {
  const fixedSource = intent === 'shielding';
  const lattice = latticeForLayoutMode(mode);
  return {
    schemaVersion: 1,
    family,
    materials: { materials: sampleModel.materials.materials },
    primitives: [],
    regions: [],
    lattices: [lattice],
    root: {
      id: 'root',
      name: labelForIntent(intent),
      role: fixedSource ? 'shield' : 'core',
      latticeId: lattice.id,
      children: nodesForLattice(lattice),
    },
    sources: fixedSource ? [{ id: 'src-visual', name: 'Visual source', type: 'point', energy: { value: 2, unit: 'MeV' }, strength: 1 }] : [],
    tallies: [{ id: 'tally-visual', name: 'Visual flux tally', scores: ['flux'], targetNodeIds: ['root'] }],
    settings: fixedSource ? { mode: 'fixed-source', particles: 10000 } : { mode: 'eigenvalue', particles: 10000, batches: 100, inactive: 20 },
  };
}

function updateProjectLatticeCell(project: ProjectBundle, rowIndex: number, columnIndex: number, value: string): ProjectBundle {
  const lattice = project.model.lattices[0];
  if (!lattice) return project;

  const rows = lattice.map.map((row) => [...row]);
  rows[rowIndex] = rows[rowIndex] ?? [];
  rows[rowIndex][columnIndex] = value;
  const updatedLattice = { ...lattice, map: rows };
  return {
    ...project,
    model: {
      ...project.model,
      lattices: [updatedLattice, ...project.model.lattices.slice(1)],
      root: { ...project.model.root, children: nodesForLattice(updatedLattice) },
    },
  };
}

function addSphereCell(project: ProjectBundle): ProjectBundle {
  return addCsgCell(project, 'sphere', 'Sphere cell');
}

function addCylinderCell(project: ProjectBundle): ProjectBundle {
  return addCsgCell(project, 'z-cylinder', 'Cylinder cell');
}

function addSlabCell(project: ProjectBundle): ProjectBundle {
  const projectWithMaterial = ensureDefaultMaterial(project);
  const geometry = project.model.openmcGeometry ?? { surfaces: [], cells: [] };
  const nextSurfaceId = nextOpenMcId(geometry.surfaces.map((surface) => surface.openmcId));
  const leftId = nextSurfaceId;
  const rightId = nextSurfaceId + 1;
  const cellId = nextOpenMcId(geometry.cells.map((cell) => cell.openmcId));
  const materialId = projectWithMaterial.model.materials.materials[0].id;

  return withOpenMcGeometry(projectWithMaterial, {
    surfaces: [
      ...geometry.surfaces,
      { id: `surf-${leftId}`, openmcId: leftId, name: `Left plane ${leftId}`, type: 'x-plane', coeffs: [-10] },
      { id: `surf-${rightId}`, openmcId: rightId, name: `Right plane ${rightId}`, type: 'x-plane', coeffs: [10], boundary: 'vacuum' },
    ],
    cells: [
      ...geometry.cells,
      { id: `cell-${cellId}`, openmcId: cellId, name: `X slab ${cellId}`, materialId, region: `+${leftId} -${rightId}` },
    ],
  });
}

function addMacrobodyCell(project: ProjectBundle): ProjectBundle {
  const projectWithMaterial = ensureDefaultMaterial(project);
  const geometry = project.model.openmcGeometry ?? { surfaces: [], cells: [] };
  const surfaceId = nextOpenMcId(geometry.surfaces.map((surface) => surface.openmcId));
  const cellId = nextOpenMcId(geometry.cells.map((cell) => cell.openmcId));
  const materialId = projectWithMaterial.model.materials.materials[0].id;
  const halfspaces = [
    1, 0, 0, 10,
    -1, 0, 0, 10,
    0, 1, 0, 10,
    0, -1, 0, 10,
  ];

  return withOpenMcGeometry(projectWithMaterial, {
    surfaces: [
      ...geometry.surfaces,
      { id: `surf-${surfaceId}`, openmcId: surfaceId, name: `Macrobody ${surfaceId}`, type: 'macrobody', coeffs: halfspaces, boundary: 'transmission' },
    ],
    cells: [...geometry.cells, { id: `cell-${cellId}`, openmcId: cellId, name: `Macrobody cell ${cellId}`, materialId, region: `-${surfaceId}` }],
  });
}

function addCsgCell(project: ProjectBundle, type: 'sphere' | 'z-cylinder', label: string): ProjectBundle {
  const projectWithMaterial = ensureDefaultMaterial(project);
  const geometry = project.model.openmcGeometry ?? { surfaces: [], cells: [] };
  const surfaceId = nextOpenMcId(geometry.surfaces.map((surface) => surface.openmcId));
  const cellId = nextOpenMcId(geometry.cells.map((cell) => cell.openmcId));
  const materialId = projectWithMaterial.model.materials.materials[0].id;
  const coeffs = type === 'sphere' ? [0, 0, 0, 10] : [0, 0, 5];

  return withOpenMcGeometry(projectWithMaterial, {
    surfaces: [
      ...geometry.surfaces,
      { id: `surf-${surfaceId}`, openmcId: surfaceId, name: `${label} boundary ${surfaceId}`, type, coeffs, boundary: 'vacuum' },
    ],
    cells: [...geometry.cells, { id: `cell-${cellId}`, openmcId: cellId, name: `${label} ${cellId}`, materialId, region: `-${surfaceId}` }],
  });
}

function withOpenMcGeometry(project: ProjectBundle, openmcGeometry: NonNullable<ReactorModel['openmcGeometry']>): ProjectBundle {
  return {
    ...project,
    model: {
      ...project.model,
      openmcGeometry,
      root: {
        ...project.model.root,
        children: openmcGeometry.cells.map((cell) => ({ id: `node-${cell.id}`, name: cell.name, role: 'region', materialId: cell.materialId, children: [] })),
      },
    },
  };
}

function addMaterialToProject(project: ProjectBundle, kind: 'water' | 'uo2' | 'steel' | 'graphite'): ProjectBundle {
  const material = materialTemplate(kind);
  if (project.model.materials.materials.some((candidate) => candidate.id === material.id)) {
    return project;
  }
  return {
    ...project,
    model: {
      ...project.model,
      materials: { materials: [...project.model.materials.materials, material] },
    },
  };
}

function materialTemplate(kind: 'water' | 'uo2' | 'steel' | 'graphite'): ReactorModel['materials']['materials'][number] {
  if (kind === 'uo2') {
    return {
      id: 'mat-uo2',
      name: 'UO2 Fuel',
      density: { value: 10.4, unit: 'g/cm3' },
      temperature: { value: 900, unit: 'K' },
      nuclides: [
        { name: 'U235', fraction: 0.04, fractionType: 'atom' },
        { name: 'U238', fraction: 0.96, fractionType: 'atom' },
        { name: 'O16', fraction: 2, fractionType: 'atom' },
      ],
    };
  }
  if (kind === 'steel') {
    return {
      id: 'mat-steel',
      name: 'Steel',
      density: { value: 7.9, unit: 'g/cm3' },
      nuclides: [
        { name: 'Fe56', fraction: 0.7, fractionType: 'weight' },
        { name: 'Cr52', fraction: 0.19, fractionType: 'weight' },
        { name: 'Ni58', fraction: 0.11, fractionType: 'weight' },
      ],
    };
  }
  if (kind === 'graphite') {
    return {
      id: 'mat-graphite',
      name: 'Graphite',
      density: { value: 1.75, unit: 'g/cm3' },
      nuclides: [{ name: 'C0', fraction: 1, fractionType: 'atom' }],
    };
  }
  return {
    id: 'mat-water',
    name: 'Light Water',
    density: { value: 0.997, unit: 'g/cm3' },
    temperature: { value: 293.6, unit: 'K' },
    nuclides: [
      { name: 'H1', fraction: 2, fractionType: 'atom' },
      { name: 'O16', fraction: 1, fractionType: 'atom' },
    ],
  };
}

function ensureDefaultMaterial(project: ProjectBundle): ProjectBundle {
  const existing = project.model.materials.materials[0];
  if (existing) return project;
  return {
    ...project,
    model: {
      ...project.model,
      materials: {
        materials: [
          {
            id: 'mat-water',
            name: 'Water placeholder',
            density: { value: 1, unit: 'g/cm3' },
            nuclides: [
              { name: 'H1', fraction: 2, fractionType: 'atom' },
              { name: 'O16', fraction: 1, fractionType: 'atom' },
            ],
          },
        ],
      },
    },
  };
}

function nextOpenMcId(ids: number[]): number {
  return Math.max(0, ...ids) + 1;
}

function latticeForLayoutMode(mode: LayoutMode): LatticeDefinition {
  if (mode === 'hex-lattice') {
    return { id: 'lat-visual-hex', kind: 'hex', name: 'Visual hex lattice', pitch: { value: 12.5, unit: 'cm' }, map: blankMap(7, 7, 'hex') };
  }
  if (mode === 'layer-stack') {
    return { id: 'lat-visual-layers', kind: 'rect', name: 'Visual layer stack', pitch: { value: 10, unit: 'cm' }, map: [['source', 'moderator', 'reflector', 'tally']] };
  }
  if (mode === 'freeform') {
    return { id: 'lat-visual-freeform', kind: 'irregular', name: 'Visual freeform map', map: blankMap(6, 6, 'freeform') };
  }
  return { id: 'lat-visual-core', kind: 'rect', name: mode === 'circular-core' ? 'Visual circular core map' : 'Visual rectangular lattice', pitch: { value: 21.5, unit: 'cm' }, map: blankMap(7, 7, mode) };
}

function blankMap(rows: number, columns: number, mode: LayoutMode | 'hex' | 'freeform'): string[][] {
  const center = (rows - 1) / 2;
  return Array.from({ length: rows }, (_, row) =>
    Array.from({ length: columns }, (_, column) => {
      if (mode === 'circular-core' || mode === 'hex') {
        const distance = Math.hypot(row - center, column - center);
        if (distance > center + 0.15) return '';
        if (distance > center - 1) return 'reflector';
      }
      return '';
    }),
  );
}

function nodesForLattice(lattice: LatticeDefinition): HierarchyNode[] {
  const values = Array.from(new Set(lattice.map.flat().filter(Boolean)));
  return values.map((value) => ({ id: `node-${value}`, name: value.replaceAll('-', ' '), role: value.includes('fuel') ? 'assembly' : 'region', children: [] }));
}

function familyForIntent(intent: ModelingIntent): ReactorFamily {
  if (intent === 'shielding') return 'shielding-fixed-source';
  if (intent === 'assembly' || intent === 'custom' || intent === 'import') return 'custom-irregular';
  return 'custom-irregular';
}

function labelForIntent(intent: ModelingIntent): string {
  return modelingIntents.find((item) => item.id === intent)?.label ?? 'Custom Geometry';
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
  const project = useStudioState((s) => s.project);
  const undoStack = useStudioState((s) => s.undoStack);
  const [diffOpen, setDiffOpen] = useState(false);
  const [diffResults, setDiffResults] = useState<ModelDiffEntry[]>([]);
  const [selectedPreset, setSelectedPreset] = useState('');
  const [show3dView, setShow3dView] = useState(false);

  function runCompareWithPreset(presetId: string) {
    if (!presetId) return;
    const presetProject = createProjectFromPreset({
      id: 'diff-target',
      name: presetId,
      presetId,
    });
    setDiffResults(diffProjectBundle(presetProject, project));
    setDiffOpen(true);
  }

  function runCompareWithPrevious() {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setDiffResults(diffProjectBundle(prev, project));
    setDiffOpen(true);
  }

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

      <div className="review-section" style={{ marginTop: 16 }}>
        <div className="action-row compact" style={{ marginBottom: 10 }}>
          <button className="secondary-action" onClick={() => setShow3dView((current) => !current)}>
            {show3dView ? 'Hide 3D View' : '3D View'}
          </button>
        </div>
        {show3dView && (
          <Suspense fallback={<p className="muted">Loading 3D viewer...</p>}>
            <p className="muted">Simplified geometry preview: hex cells as prisms, rectangular lattices as boxes, and OpenMC surfaces as wireframes.</p>
            <Geometry3DViewer model={project.model} />
          </Suspense>
        )}
      </div>

      <details className="review-section" style={{ marginTop: 16 }}>
        <summary><h3>Model comparison / diff</h3></summary>
        <p className="muted">Compare current model with presets or previous undo state.</p>
        <div>
          <button className="secondary-action" onClick={runCompareWithPrevious} disabled={undoStack.length === 0} style={{ marginRight: 8 }}>
            Diff with previous edit
          </button>
        </div>
        <div style={{ marginTop: 10 }}>
          <select value={selectedPreset} onChange={(e) => setSelectedPreset(e.target.value)} style={{ background: 'rgba(8,17,31,.7)', color: '#edf4ff', border: '1px solid rgba(148,163,184,.24)', borderRadius: 8, padding: 6 }}>
            <option value="">Choose preset to compare...</option>
            {reactorPresets.map((preset) => (
              <option key={preset.id} value={preset.id}>{preset.name}</option>
            ))}
          </select>
          <button className="mini-action" onClick={() => runCompareWithPreset(selectedPreset)} disabled={!selectedPreset} style={{ marginLeft: 8 }}>Compare</button>
        </div>
        {diffOpen && diffResults.length > 0 && (
          <div style={{ marginTop: 12, maxHeight: 320, overflow: 'auto' }}>
            <strong>{diffResults.length} differences found</strong>
            <div className="diagnostic-list" style={{ marginTop: 8 }}>
              {diffResults.slice(0, 200).map((entry, idx) => (
                <div key={idx} className="diagnostic" style={{ borderLeft: entry.type === 'added' ? '3px solid #22c55e' : entry.type === 'removed' ? '3px solid #ef4444' : '3px solid #f59e0b', paddingLeft: 10, marginBottom: 4 }}>
                  <span className={`badge ${entry.type === 'added' ? 'ok' : entry.type === 'removed' ? 'fail' : ''}`} style={{ fontSize: 10, marginRight: 6 }}>{entry.type}</span>
                  <strong style={{ fontSize: 12 }}>{entry.path}</strong>
                  {entry.before !== undefined && <br/>}
                  {entry.before !== undefined && <span style={{ color: '#ef4444', fontSize: 11 }}>before: {entry.before}</span>}
                  {entry.after !== undefined && <br/>}
                  {entry.after !== undefined && <span style={{ color: '#22c55e', fontSize: 11 }}>after: {entry.after}</span>}
                </div>
              ))}
              {diffResults.length > 200 && <p className="muted" style={{ marginTop: 8 }}>... and {diffResults.length - 200} more differences</p>}
            </div>
          </div>
        )}
        {diffOpen && diffResults.length === 0 && <p className="muted" style={{ marginTop: 10 }}>No differences — models are identical.</p>}
      </details>
    </section>
  );
}

function RunPanel({ project }: { project: ProjectBundle }) {
  const artifacts = useMemo(() => generateOpenMcArtifacts(project.model), [project]);
  const [projectDir, setProjectDir] = useState('');
  const [manualCommand, setManualCommand] = useState('conda run -n openmc openmc');
  const [message, setMessage] = useState<string | null>(null);
  const [runLog, setRunLog] = useState<string | null>(null);
  const [plotMessage, setPlotMessage] = useState<string | null>(null);
  const [plotPath, setPlotPath] = useState<string | null>(null);
  const plotUrl = plotPath ? `http://127.0.0.1:8765/image?path=${encodeURIComponent(plotPath)}` : null;
  const [isRunning, setIsRunning] = useState(false);
  const [runHistory, setRunHistory] = useState<RunHistoryEntry[]>([]);
  const [liveStatus, setLiveStatus] = useState<string>('idle');
  const [liveMeta, setLiveMeta] = useState<string>('No active run');
  const [liveBatchProgress, setLiveBatchProgress] = useState<{ current: number; total: number; percent: number } | null>(null);
  const [liveKeff, setLiveKeff] = useState<{ kCombined: number; kStdDev: number } | null>(null);
  const [errorAnalysis, setErrorAnalysis] = useState<{ errors: Array<{ type: string; message: string; fatal: boolean }>; warnings: string[]; hasFatal: boolean; summary: string } | null>(null);
  const [sweepText, setSweepText] = useState('10000,100,20\n20000,120,30\n50000,150,40');
  const [sweepMessage, setSweepMessage] = useState<string | null>(null);
  const [sweepResults, setSweepResults] = useState<Array<{ label: string; ok: boolean; runId?: string; returnCode?: number; message?: string }>>([]);

  useEffect(() => {
    if (!projectDir.trim()) {
      setLiveStatus('idle');
      setLiveMeta('No active run');
      return;
    }

    const intervalId = setInterval(async () => {
      try {
        const status = await liveRunStatus(projectDir.trim());
        if (!status.ok) {
          setLiveStatus('idle');
          setLiveMeta(status.message ?? 'No run found');
          return;
        }

        setLiveStatus(status.status ?? 'unknown');
        setLiveMeta(
          `run: ${status.runId ?? 'n/a'} | code: ${status.returnCode ?? 'n/a'} | start: ${status.startedAt ?? 'n/a'}`,
        );
        setRunLog([status.stdoutTail, status.stderrTail].filter(Boolean).join('\n'));
        if (status.batchProgress) setLiveBatchProgress(status.batchProgress);
        if (status.kFromLog) setLiveKeff(status.kFromLog);
      } catch {
        // keep previous live data when polling fails
      }
    }, 2000);

    return () => clearInterval(intervalId);
  }, [projectDir]);

  async function refreshHistory() {
    if (!projectDir.trim()) {
      setRunHistory([]);
      return;
    }

    setRunHistory(await listRunHistory(projectDir.trim()));
  }

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

  async function executeOpenMc() {
    if (!projectDir.trim()) {
      setMessage('Enter a saved project directory first.');
      return;
    }

    setIsRunning(true);
    setMessage(null);
    setRunLog(null);
    setLiveBatchProgress(null);
    setLiveKeff(null);
    setErrorAnalysis(null);

    try {
      await saveProjectBundle(projectDir.trim(), project);
      await generateOpenMcInputs(projectDir.trim());
      const command = manualCommand.trim() ? splitCommand(manualCommand.trim()) : undefined;
      const targetProjectDir = projectDir.trim();
      const result = await runOpenMc(targetProjectDir, command);
      setMessage(result.ok ? `Run ${result.runId} completed.` : result.message ?? `Run failed with code ${result.returnCode}.`);
      setRunLog([result.stdoutTail, result.stderrTail].filter(Boolean).join('\n'));
      if (result.batchProgress) setLiveBatchProgress(result.batchProgress);
      if (result.kFromLog) setLiveKeff(result.kFromLog);
      if (result.errorAnalysis) setErrorAnalysis(result.errorAnalysis);
      if (result.ok) {
        const payload = {
          projectDir: targetProjectDir,
          runId: result.runId ?? null,
          ts: new Date().toISOString(),
        };
        localStorage.setItem(OPENMC_LAST_RUN_KEY, JSON.stringify(payload));
        window.dispatchEvent(new CustomEvent(OPENMC_RUN_COMPLETE_EVENT, { detail: payload }));
      }
      await refreshHistory();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsRunning(false);
    }
  }

  function parseSweepRows(text: string): Array<{ particles: number; batches: number; inactive: number; label: string }> {
    return text
      .split(/\r?\n/)
      .map((row) => row.trim())
      .filter(Boolean)
      .map((row, index) => {
        const parts = row.split(',').map((value) => Number(value.trim()));
        if (parts.length !== 3 || parts.some((value) => !Number.isFinite(value) || value <= 0)) {
          throw new Error(`Invalid sweep row ${index + 1}: "${row}". Use particles,batches,inactive.`);
        }
        return {
          particles: Math.trunc(parts[0]),
          batches: Math.trunc(parts[1]),
          inactive: Math.trunc(parts[2]),
          label: `p=${Math.trunc(parts[0])},b=${Math.trunc(parts[1])},i=${Math.trunc(parts[2])}`,
        };
      });
  }

  async function runParameterSweep() {
    if (!projectDir.trim()) {
      setSweepMessage('Enter a saved project directory first.');
      return;
    }

    setIsRunning(true);
    setSweepMessage('Running sweep...');
    setSweepResults([]);

    try {
      const rows = parseSweepRows(sweepText);
      const command = manualCommand.trim() ? splitCommand(manualCommand.trim()) : undefined;
      const nextResults: Array<{ label: string; ok: boolean; runId?: string; returnCode?: number; message?: string }> = [];

      for (const row of rows) {
        const sweepProject: ProjectBundle = {
          ...project,
          model: {
            ...project.model,
            settings: {
              ...project.model.settings,
              particles: row.particles,
              batches: row.batches,
              inactive: row.inactive,
            },
          },
        };

        await saveProjectBundle(projectDir.trim(), sweepProject);
        await generateOpenMcInputs(projectDir.trim());
        const result = await runOpenMc(projectDir.trim(), command);

        nextResults.push({
          label: row.label,
          ok: Boolean(result.ok),
          runId: result.runId,
          returnCode: result.returnCode,
          message: result.message,
        });
        setSweepResults([...nextResults]);

        if (!result.ok) {
          setSweepMessage(`Sweep stopped on failure: ${row.label}`);
          setRunLog([result.stdoutTail, result.stderrTail].filter(Boolean).join('\n'));
          await refreshHistory();
          return;
        }
      }

      setSweepMessage(`Sweep completed: ${nextResults.length} runs.`);
      await refreshHistory();
    } catch (caught) {
      setSweepMessage(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsRunning(false);
    }
  }

  async function renderNativePlot() {
    if (!projectDir.trim()) {
      setPlotMessage('Enter a saved project directory first.');
      return;
    }

    setPlotMessage('Rendering OpenMC-native plot...');
    setPlotPath(null);

    try {
      await saveProjectBundle(projectDir.trim(), project);
      await generateOpenMcInputs(projectDir.trim());
      const command = manualCommand.trim() ? splitCommand(manualCommand.trim()) : undefined;
      const result = await renderOpenMcPlot(projectDir.trim(), command);
      setPlotPath(result.imagePath ?? null);
      setPlotMessage(result.ok ? `OpenMC plot rendered at ${result.imagePath}` : result.message ?? `OpenMC plot failed with code ${result.returnCode ?? 'n/a'}.`);
      setRunLog([result.stdoutTail, result.stderrTail].filter(Boolean).join('\n'));
    } catch (caught) {
      setPlotMessage(caught instanceof Error ? caught.message : String(caught));
    }
  }

  return (
    <section className="panel-grid">
      <article className="card hero-card">
        <p className="eyebrow">Run orchestration</p>
        <h2>Use OpenMC itself for 1:1 plot previews.</h2>
        <p>The custom canvas is an editor aid. For exact visuals, write XML plus plots.xml and render with OpenMC using your conda environment.</p>
        <div className="project-storage">
          <div className="history-item">
            <strong>Live status: {liveStatus}</strong>
            <span>{liveMeta}</span>
          </div>
          {liveBatchProgress && (
            <div className="history-item" style={{ marginBottom: 8 }}>
              <strong>Batch: {liveBatchProgress.current}/{liveBatchProgress.total}</strong>
              <div style={{ marginTop: 4, background: 'rgba(148,163,184,.15)', borderRadius: 6, overflow: 'hidden', height: 8 }}>
                <div style={{ width: `${liveBatchProgress.percent}%`, background: 'linear-gradient(90deg, #22c55e, #38bdf8)', height: '100%', transition: 'width 0.3s' }} />
              </div>
              <span style={{ fontSize: 12 }}>{liveBatchProgress.percent}%</span>
            </div>
          )}
          {liveKeff && (
            <div className="history-item" style={{ marginBottom: 8 }}>
              <strong>Live k-eff: {liveKeff.kCombined.toFixed(5)} ± {liveKeff.kStdDev.toFixed(5)}</strong>
            </div>
          )}
          {errorAnalysis && errorAnalysis.summary !== 'No issues detected' && (
            <div className="history-item" style={{ marginBottom: 8, borderColor: errorAnalysis.hasFatal ? 'rgba(239,68,68,.4)' : 'rgba(249,115,22,.4)' }}>
              <strong style={{ color: errorAnalysis.hasFatal ? '#ef4444' : '#f97316' }}>{errorAnalysis.summary}</strong>
              {errorAnalysis.errors.map((err, i) => (
                <div key={i} style={{ fontSize: 12, marginTop: 4, color: err.fatal ? '#ef4444' : '#f97316' }}>
                  [{err.type}] {err.message}
                </div>
              ))}
              {errorAnalysis.warnings.length > 0 && (
                <div style={{ fontSize: 12, marginTop: 4, color: '#fbbf24' }}>
                  {errorAnalysis.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
                </div>
              )}
            </div>
          )}
          <label htmlFor="run-project-dir">Project directory (save + run location)</label>
          <input id="run-project-dir" value={projectDir} onChange={(event) => setProjectDir(event.target.value)} placeholder="Example: /home/patrick/projects/my-openmc-case" />
          <label htmlFor="openmc-command">OpenMC command override (advanced)</label>
          <input id="openmc-command" value={manualCommand} onChange={(event) => setManualCommand(event.target.value)} placeholder="conda run -n openmc openmc" />
          <p className="muted">Quick start: 1) Write inputs → 2) Run OpenMC → 3) Check live status + log.</p>
          <div className="action-row compact">
            <button className="secondary-action" onClick={writeInputs}>1) Write OpenMC input files</button>
            <button className="primary-action" disabled={isRunning} onClick={executeOpenMc}>{isRunning ? 'Running...' : '2) Run OpenMC simulation'}</button>
            <button className="secondary-action" onClick={refreshHistory}>3) Refresh run history</button>
            <button className="secondary-action" onClick={renderNativePlot}>Render native OpenMC plot</button>
          </div>
          <details className="review-section">
            <summary><h3>Parameter sweep (particles,batches,inactive)</h3></summary>
            <p className="muted">One row per run. Example: 10000,100,20</p>
            <textarea
              value={sweepText}
              onChange={(event) => setSweepText(event.target.value)}
              style={{ width: '100%', minHeight: 120, background: 'rgba(8,17,31,.7)', color: '#edf4ff', border: '1px solid rgba(148,163,184,.24)', borderRadius: 12, padding: 10 }}
            />
            <div className="action-row compact">
              <button className="primary-action" disabled={isRunning} onClick={runParameterSweep}>{isRunning ? 'Running...' : 'Run sweep'}</button>
            </div>
            {sweepMessage && <p className="muted">{sweepMessage}</p>}
            {sweepResults.length > 0 && (
              <div className="history-list">
                {sweepResults.map((item, index) => (
                  <div key={`${item.label}-${index}`} className="history-item">
                    <strong>{item.label}</strong>
                    <span>{item.ok ? 'OK' : 'FAILED'} (code: {item.returnCode ?? 'n/a'})</span>
                    <span>{item.runId ?? item.message ?? 'no run id'}</span>
                  </div>
                ))}
              </div>
            )}
          </details>
          {message && <p className="muted">{message}</p>}
          {plotMessage && <p className="muted">{plotMessage}</p>}
          {plotPath && <p className="muted">Open the generated PNG from: {plotPath}</p>}
          {plotUrl && <PlotViewer imageUrl={plotUrl} materials={project.model.materials.materials.map((material) => material.name)} />}
          {runLog && <pre>{runLog}</pre>}
        </div>
      </article>
      <article className="card artifact-preview">
        <h3>plots.xml preview</h3>
        <pre>{artifacts.plotsXml}</pre>
        <h3>settings.xml preview</h3>
        <pre>{artifacts.settingsXml}</pre>
        <h3>materials.xml preview</h3>
        <pre>{artifacts.materialsXml.slice(0, 900)}</pre>
        <h3>Run history</h3>
        {runHistory.length === 0 ? (
          <p className="muted">No runs found for this project directory.</p>
        ) : (
          <div className="history-list">
            {runHistory.map((entry) => (
              <div key={entry.runId} className="history-item">
                <strong>{entry.runId}</strong>
                <span>{entry.ok ? 'OK' : 'FAILED'} (code: {entry.returnCode ?? 'n/a'})</span>
                <span>k-eff: {entry.kEffective ?? 'n/a'} ± {entry.kStdDev ?? 'n/a'}</span>
                <span>{entry.startedAt ?? 'unknown start'}</span>
              </div>
            ))}
          </div>
        )}
      </article>
    </section>
  );
}

function splitCommand(command: string): string[] {
  return command.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((part) => part.replace(/^"|"$/g, '')) ?? [command];
}

function csvEscape(value: string): string {
  if (!value) return '';
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function PlotViewer({ imageUrl, materials }: { imageUrl: string; materials: string[] }) {
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [lastX, setLastX] = useState(0);
  const [lastY, setLastY] = useState(0);

  function onWheel(event: React.WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    const delta = event.deltaY < 0 ? 0.1 : -0.1;
    setZoom((value) => Math.max(0.5, Math.min(6, Number((value + delta).toFixed(2)))));
  }

  function onMouseDown(event: React.MouseEvent<HTMLDivElement>) {
    setDragging(true);
    setLastX(event.clientX);
    setLastY(event.clientY);
  }

  function onMouseMove(event: React.MouseEvent<HTMLDivElement>) {
    if (!dragging) return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    setPanX((value) => value + dx);
    setPanY((value) => value + dy);
    setLastX(event.clientX);
    setLastY(event.clientY);
  }

  function onMouseUp() {
    setDragging(false);
  }

  function resetView() {
    setZoom(1);
    setPanX(0);
    setPanY(0);
  }

  const palette = ['#5eead4', '#38bdf8', '#f59e0b', '#ef4444', '#a78bfa', '#22c55e', '#f97316', '#eab308'];

  return (
    <div className="surface-panel" style={{ padding: 12 }}>
      <div className="action-row compact" style={{ marginTop: 0 }}>
        <button className="secondary-action" onClick={() => setZoom((v) => Math.min(6, Number((v + 0.1).toFixed(2))))}>Zoom +</button>
        <button className="secondary-action" onClick={() => setZoom((v) => Math.max(0.5, Number((v - 0.1).toFixed(2))))}>Zoom -</button>
        <button className="secondary-action" onClick={resetView}>Reset view</button>
        <span className="muted">zoom {zoom.toFixed(2)}x</span>
      </div>
      <div
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        style={{
          marginTop: 10,
          height: 420,
          overflow: 'hidden',
          borderRadius: 14,
          border: '1px solid rgba(148,163,184,.25)',
          background: 'rgba(8,17,31,.65)',
          cursor: dragging ? 'grabbing' : 'grab',
          position: 'relative',
        }}
      >
        <img
          src={imageUrl}
          alt="OpenMC native geometry plot"
          draggable={false}
          style={{
            transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
            transformOrigin: 'center center',
            userSelect: 'none',
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            pointerEvents: 'none',
          }}
        />
      </div>
      {materials.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <strong>Material legend</strong>
          <div className="category-chips" style={{ marginTop: 6 }}>
            {materials.map((name, index) => (
              <span key={`${name}-${index}`} className="material-chip" style={{ borderColor: palette[index % palette.length] }}>
                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 999, background: palette[index % palette.length] }} />
                {name}
              </span>
            ))}
          </div>
          <p className="muted" style={{ marginTop: 6 }}>Legend ini berdasarkan material project, bukan auto-read dari pixel PNG.</p>
        </div>
      )}
    </div>
  );
}

function ResultsPanel({ project }: { project: ProjectBundle }) {
  const [projectDir, setProjectDir] = useState('');
  const [summary, setSummary] = useState<string | null>(null);
  const [statepointSummary, setStatepointSummary] = useState<StatepointSummary | null>(null);
  const [customStatepointPath, setCustomStatepointPath] = useState('');
  const [customSpMessage, setCustomSpMessage] = useState<string | null>(null);
  const [depletionSummary, setDepletionSummary] = useState<DepletionSummary | null>(null);
  const [spectrumData, setSpectrumData] = useState<{ tallies: TallySpectrumData[] } | null>(null);
  const [proofMessage, setProofMessage] = useState<string | null>(null);
  const [bundleMessage, setBundleMessage] = useState<string | null>(null);
  const [draftMessage, setDraftMessage] = useState<string | null>(null);
  const [history, setHistory] = useState<RunHistoryEntry[]>([]);
  const [proofPacks, setProofPacks] = useState<ProofPackEntry[]>([]);
  const [volumeCellIds, setVolumeCellIds] = useState<number[]>([]);
  const [volumeSamples, setVolumeSamples] = useState<number>(1_000_000);
  const [volumeResults, setVolumeResults] = useState<StochasticVolumeResult[]>([]);
  const [volumeMessage, setVolumeMessage] = useState<string | null>(null);
  const [sensitivityResults, setSensitivityResults] = useState<Array<{ tallyName: string; score: string; nuclide: string; mean: number; stdDev: number }> | null>(null);
  const [isStep1Loading, setIsStep1Loading] = useState(false);
  const [isStep2Loading, setIsStep2Loading] = useState(false);
  const [isStep3Loading, setIsStep3Loading] = useState(false);
  const [step1Action, setStep1Action] = useState<'summary' | 'statepoint' | 'custom' | null>(null);
  const [step2Action, setStep2Action] = useState<'depletion' | 'spectrum' | null>(null);
  const [step3Action, setStep3Action] = useState<'proof' | 'zip' | 'list' | 'draft' | null>(null);
  const [step1Error, setStep1Error] = useState<string | null>(null);
  const [step2Error, setStep2Error] = useState<string | null>(null);
  const [step3Error, setStep3Error] = useState<string | null>(null);
  const [activityLog, setActivityLog] = useState<Array<{ ts: string; step: '1' | '2' | '3'; action: string; status: 'started' | 'success' | 'failed'; note?: string }>>([]);
  const [autoPipelineMessage, setAutoPipelineMessage] = useState<string | null>(null);
  const [qualityGateDetails, setQualityGateDetails] = useState<string[]>([]);
  const [noisiestTallyId, setNoisiestTallyId] = useState<number | null>(null);

  const hasRunSummary = Boolean(summary && summary.startsWith('Runs:'));
  const hasStatepoint = Boolean(statepointSummary);
  const hasArtifacts = Boolean(
    (proofMessage && proofMessage.startsWith('Proof pack created at'))
    || (bundleMessage && bundleMessage.startsWith('Submission ZIP created at')),
  );


  const spinnerGlyphStyle: CSSProperties = {
    fontSize: 11,
    lineHeight: 1,
    color: '#f59e0b',
  };

  function pushActivity(step: '1' | '2' | '3', action: string, status: 'started' | 'success' | 'failed', note?: string) {
    const ts = new Date().toISOString();
    setActivityLog((current) => [{ ts, step, action, status, note }, ...current].slice(0, 20));
  }

  const stepState = (done: boolean, pending: boolean, error: string | null) => (error ? 'failed' : pending ? 'pending' : done ? 'done' : 'idle');

  const stepBadgeStyleByState = (state: 'idle' | 'pending' | 'done' | 'failed'): CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    padding: '3px 10px',
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: '.01em',
    border: state === 'failed'
      ? '1px solid rgba(239,68,68,.5)'
      : state === 'pending'
        ? '1px solid rgba(245,158,11,.5)'
        : state === 'done'
          ? '1px solid rgba(34,197,94,.45)'
          : '1px solid rgba(148,163,184,.35)',
    color: state === 'failed' ? '#fca5a5' : state === 'pending' ? '#fde68a' : state === 'done' ? '#86efac' : '#cbd5e1',
    background: state === 'failed' ? 'rgba(239,68,68,.16)' : state === 'pending' ? 'rgba(245,158,11,.16)' : state === 'done' ? 'rgba(34,197,94,.14)' : 'rgba(148,163,184,.12)',
  });

  const stepBadgeTextByState = (state: 'idle' | 'pending' | 'done' | 'failed') => (state === 'failed' ? 'Failed' : state === 'pending' ? 'In progress' : state === 'done' ? 'Done' : 'Not started');

  async function runAutoImportPipeline(targetProjectDir: string, source: 'startup' | 'run-complete') {
    const normalizedDir = targetProjectDir.trim();
    if (!normalizedDir) return;

    setProjectDir(normalizedDir);
    setAutoPipelineMessage('Auto-import in progress...');

    setIsStep1Loading(true);
    setStep1Action('summary');
    setStep1Error(null);
    pushActivity('1', 'autoImport.summary', 'started', source);

    let summaryOk = false;
    let statepointOk = false;
    try {
      await saveProjectBundle(normalizedDir, project);
      const value = await summarizeResults(normalizedDir);
      setSummary(`Runs: ${value.totalRuns}, success: ${value.successfulRuns}, failed: ${value.failedRuns}, latest: ${value.latestRunId ?? 'n/a'}`);
      setHistory(await listRunHistory(normalizedDir));
      summaryOk = true;
      pushActivity('1', 'autoImport.summary', 'success', source);

      setStep1Action('statepoint');
      const result = await summarizeStatepoint(normalizedDir);
      if (!result.ok || !result.summary) {
        const msg = result.message ?? 'No statepoint summary available.';
        setStep1Error(msg);
        setStatepointSummary(null);
        pushActivity('1', 'autoImport.statepoint', 'failed', msg);
      } else {
        setStatepointSummary(result.summary);
        statepointOk = true;
        pushActivity('1', 'autoImport.statepoint', 'success', source);
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setStep1Error(message);
      setSummary(message);
      pushActivity('1', 'autoImport.summary', 'failed', message);
    } finally {
      setIsStep1Loading(false);
      setStep1Action(null);
    }

    setIsStep2Loading(true);
    setStep2Action('spectrum');
    setStep2Error(null);
    try {
      const spectrum = await summarizeTallySpectrum(normalizedDir);
      if (spectrum.ok && spectrum.summary && spectrum.summary.tallies.length > 0) {
        setSpectrumData(spectrum.summary);
        pushActivity('2', 'autoImport.spectrum', 'success', source);
      } else {
        pushActivity('2', 'autoImport.spectrum', 'failed', spectrum.message ?? 'No spectrum data');
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      pushActivity('2', 'autoImport.spectrum', 'failed', message);
    } finally {
      setIsStep2Loading(false);
      setStep2Action(null);
    }

    setAutoPipelineMessage(
      summaryOk && statepointOk
        ? 'Auto-import done: summary + statepoint loaded.'
        : summaryOk
          ? 'Auto-import partial: summary loaded, statepoint missing/failed.'
          : 'Auto-import failed. Check Step 1 error and run logs.',
    );
  }

  useEffect(() => {
    const handleRunComplete = (event: Event) => {
      const customEvent = event as CustomEvent<{ projectDir?: string }>;
      const targetProjectDir = customEvent.detail?.projectDir;
      if (targetProjectDir) {
        void runAutoImportPipeline(targetProjectDir, 'run-complete');
      }
    };

    const raw = localStorage.getItem(OPENMC_LAST_RUN_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { projectDir?: string; ts?: string };
        if (parsed.projectDir && parsed.ts) {
          const ageMs = Date.now() - Date.parse(parsed.ts);
          if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs < 10 * 60 * 1000) {
            void runAutoImportPipeline(parsed.projectDir, 'startup');
          }
        }
      } catch {
        // ignore stale localStorage payload
      }
    }

    window.addEventListener(OPENMC_RUN_COMPLETE_EVENT, handleRunComplete as EventListener);
    return () => window.removeEventListener(OPENMC_RUN_COMPLETE_EVENT, handleRunComplete as EventListener);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!statepointSummary) {
      setQualityGateDetails([]);
      return;
    }

    const details: string[] = [];
    const kStd = statepointSummary.kStdDev ?? Number.NaN;
    const generations = statepointSummary.kGenerationMean?.length ?? 0;
    const inactive = (project.model.settings as { inactive?: number } | undefined)?.inactive ?? 0;
    const activeGenerations = Math.max(0, generations - inactive);
    const nTallies = statepointSummary.nTallies ?? 0;

    if (!Number.isFinite(kStd)) details.push('FAIL: k-eff uncertainty missing (kStdDev unavailable).');
    else if (kStd > 0.005) details.push(`FAIL: k-eff uncertainty too high (σ=${kStd.toExponential(2)} > 5e-3).`);
    else if (kStd > 0.0025) details.push(`WARN: k-eff uncertainty moderate (σ=${kStd.toExponential(2)} > 2.5e-3).`);
    else details.push(`PASS: k-eff uncertainty acceptable (σ=${kStd.toExponential(2)}).`);

    if (activeGenerations < 30) details.push(`WARN: active generations low (${activeGenerations}). Target >= 30 for trustable trend.`);
    else details.push(`PASS: active generations count looks healthy (${activeGenerations}).`);

    if (nTallies <= 0) details.push('WARN: no tally values parsed from statepoint.');
    else details.push(`PASS: tally extraction successful (${nTallies} tallies).`);

    if (statepointSummary.parseWarning) details.push(`WARN: parser warning: ${statepointSummary.parseWarning}`);

    setQualityGateDetails(details);
  }, [project.model.settings, statepointSummary]);

  useEffect(() => {
    if (!statepointSummary || !Array.isArray(statepointSummary.tallies) || statepointSummary.tallies.length === 0 || typeof statepointSummary.tallies[0] !== 'object') {
      setNoisiestTallyId(null);
      return;
    }

    const tallyRows = statepointSummary.tallies as unknown as Array<Record<string, unknown>>;
    let bestId: number | null = null;
    let bestScore = -Infinity;

    for (const tally of tallyRows) {
      const mean = Array.isArray(tally.mean) ? (tally.mean as number[]) : [];
      const std = Array.isArray(tally.stdDev) ? (tally.stdDev as number[]) : [];
      if (mean.length === 0 || std.length === 0) continue;
      const rel = std.map((value, idx) => {
        const denom = Math.abs(mean[idx] ?? 0);
        return denom > 0 ? Math.abs(value) / denom : 0;
      });
      const peakRel = rel.length > 0 ? Math.max(...rel) : 0;
      if (peakRel > bestScore) {
        bestScore = peakRel;
        bestId = typeof tally.id === 'number' ? tally.id : Number(tally.id);
      }
    }

    setNoisiestTallyId(Number.isFinite(bestId as number) ? (bestId as number) : null);
  }, [statepointSummary]);

  function exportResultsCsv() {
    if (!projectDir.trim()) {
      setSummary('Enter a project directory first.');
      return;
    }

    const lines: string[] = [];
    lines.push('section,run_id,ok,return_code,k_effective,k_std_dev,started_at,ended_at,run_dir,time,k_eff_step,k_std_step,generation,k_eff_generation,k_std_generation');

    for (const entry of history) {
      lines.push([
        'run_history',
        csvEscape(entry.runId),
        entry.ok === undefined ? '' : String(entry.ok),
        entry.returnCode ?? '',
        entry.kEffective ?? '',
        entry.kStdDev ?? '',
        csvEscape(entry.startedAt ?? ''),
        csvEscape(entry.endedAt ?? ''),
        csvEscape(entry.runDir),
        '',
        '',
        '',
        '',
        '',
        '',
      ].join(','));
    }

    if (depletionSummary) {
      const maxLen = Math.max(depletionSummary.time.length, depletionSummary.kEffective.length, depletionSummary.kStdDev.length);
      for (let index = 0; index < maxLen; index += 1) {
        lines.push([
          'depletion_k_eff',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          depletionSummary.time[index] ?? '',
          depletionSummary.kEffective[index] ?? '',
          depletionSummary.kStdDev[index] ?? '',
          '',
          '',
          '',
        ].join(','));
      }
    }

    if (statepointSummary?.kGenerationMean?.length) {
      for (let index = 0; index < statepointSummary.kGenerationMean.length; index += 1) {
        lines.push([
          'generation_k_eff',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          index + 1,
          statepointSummary.kGenerationMean[index] ?? '',
          statepointSummary.kGenerationStd?.[index] ?? '',
        ].join(','));
      }
    }

    if (lines.length === 1) {
      setSummary('No run/depletion/statepoint data loaded yet. Click load buttons first.');
      return;
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    link.href = url;
    link.download = `openmc-results-${stamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setSummary(`CSV exported: ${link.download}`);
  }

  async function loadSummary() {
    if (!projectDir.trim()) {
      setSummary('Enter a project directory first.');
      return;
    }

    setIsStep1Loading(true);
    setStep1Action('summary');
    setStep1Error(null);
    pushActivity('1', 'loadSummary', 'started');
    try {
      await saveProjectBundle(projectDir.trim(), project);
      const value = await summarizeResults(projectDir.trim());
      setSummary(
        `Runs: ${value.totalRuns}, success: ${value.successfulRuns}, failed: ${value.failedRuns}, latest: ${value.latestRunId ?? 'n/a'}`,
      );
      setHistory(await listRunHistory(projectDir.trim()));
      pushActivity('1', 'loadSummary', 'success');
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setSummary(message);
      setStep1Error(message);
      pushActivity('1', 'loadSummary', 'failed', message);
    } finally {
      setIsStep1Loading(false);
      setStep1Action(null);
    }
  }

  async function generateProofPack() {
    if (!projectDir.trim()) {
      setProofMessage('Enter a project directory first.');
      return;
    }

    setIsStep3Loading(true);
    setStep3Action('proof');
    setStep3Error(null);
    pushActivity('3', 'generateProofPack', 'started');
    try {
      await saveProjectBundle(projectDir.trim(), project);
      const result = await exportProofPack(projectDir.trim(), 'https://github.com/rinopatrick/openmc-studio');
      setProofMessage(`Proof pack created at ${result.proofPackDir}`);
      setProofPacks(await listProofPacks(projectDir.trim()));
      pushActivity('3', 'generateProofPack', 'success');
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setProofMessage(message);
      setStep3Error(message);
      pushActivity('3', 'generateProofPack', 'failed', message);
    } finally {
      setIsStep3Loading(false);
      setStep3Action(null);
    }
  }

  async function refreshProofPacks() {
    if (!projectDir.trim()) {
      setProofPacks([]);
      return;
    }
    setIsStep3Loading(true);
    setStep3Action('list');
    setStep3Error(null);
    pushActivity('3', 'refreshProofPacks', 'started');
    try {
      setProofPacks(await listProofPacks(projectDir.trim()));
      pushActivity('3', 'refreshProofPacks', 'success');
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setStep3Error(message);
      pushActivity('3', 'refreshProofPacks', 'failed', message);
    } finally {
      setIsStep3Loading(false);
      setStep3Action(null);
    }
  }

  async function exportSubmissionZip() {
    if (!projectDir.trim()) {
      setBundleMessage('Enter a project directory first.');
      return;
    }

    setIsStep3Loading(true);
    setStep3Action('zip');
    setStep3Error(null);
    pushActivity('3', 'exportSubmissionZip', 'started');
    try {
      await saveProjectBundle(projectDir.trim(), project);
      const result = await exportSubmissionBundle(projectDir.trim(), 'https://github.com/rinopatrick/openmc-studio');
      setBundleMessage(`Submission ZIP created at ${result.bundlePath}`);
      pushActivity('3', 'exportSubmissionZip', 'success');
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setBundleMessage(message);
      setStep3Error(message);
      pushActivity('3', 'exportSubmissionZip', 'failed', message);
    } finally {
      setIsStep3Loading(false);
      setStep3Action(null);
    }
  }

  async function generateMimoAnswerDraft() {
    if (!projectDir.trim()) {
      setDraftMessage('Enter a project directory first.');
      return;
    }

    setIsStep3Loading(true);
    setStep3Action('draft');
    setStep3Error(null);
    pushActivity('3', 'generateMimoAnswerDraft', 'started');
    try {
      await saveProjectBundle(projectDir.trim(), project);
      const result = await generateMimoDraft(projectDir.trim(), 'https://github.com/rinopatrick/openmc-studio');
      setDraftMessage(`Mimo draft generated at ${result.draftPath}`);
      pushActivity('3', 'generateMimoAnswerDraft', 'success');
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setDraftMessage(message);
      setStep3Error(message);
      pushActivity('3', 'generateMimoAnswerDraft', 'failed', message);
    } finally {
      setIsStep3Loading(false);
      setStep3Action(null);
    }
  }

  async function loadStatepointSummary() {
    if (!projectDir.trim()) {
      setSummary('Enter a project directory first.');
      return;
    }

    setIsStep1Loading(true);
    setStep1Action('statepoint');
    setStep1Error(null);
    pushActivity('1', 'loadStatepointSummary', 'started');
    try {
      const result = await summarizeStatepoint(projectDir.trim());
      if (!result.ok || !result.summary) {
        const msg = result.message ?? 'No statepoint summary available.';
        setSummary(msg);
        setStatepointSummary(null);
        setStep1Error(msg);
        pushActivity('1', 'loadStatepointSummary', 'failed', msg);
        return;
      }
      setStatepointSummary(result.summary);
      pushActivity('1', 'loadStatepointSummary', 'success');
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setSummary(message);
      setStatepointSummary(null);
      setStep1Error(message);
      pushActivity('1', 'loadStatepointSummary', 'failed', message);
    } finally {
      setIsStep1Loading(false);
      setStep1Action(null);
    }
  }

  async function loadDepletionSummary() {
    if (!projectDir.trim()) {
      setSummary('Enter a project directory first.');
      return;
    }

    setIsStep2Loading(true);
    setStep2Action('depletion');
    setStep2Error(null);
    pushActivity('2', 'loadDepletionSummary', 'started');
    try {
      const result = await summarizeDepletion(projectDir.trim());
      if (!result.ok || !result.summary) {
        const msg = result.message ?? 'No depletion summary available.';
        setSummary(msg);
        setDepletionSummary(null);
        setStep2Error(msg);
        pushActivity('2', 'loadDepletionSummary', 'failed', msg);
        return;
      }
      setDepletionSummary(result.summary);
      pushActivity('2', 'loadDepletionSummary', 'success');
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setSummary(message);
      setDepletionSummary(null);
      setStep2Error(message);
      pushActivity('2', 'loadDepletionSummary', 'failed', message);
    } finally {
      setIsStep2Loading(false);
      setStep2Action(null);
    }
  }

  async function loadTallySpectrum() {
    if (!projectDir.trim()) {
      setSummary('Enter a project directory first.');
      return;
    }

    setIsStep2Loading(true);
    setStep2Action('spectrum');
    setStep2Error(null);
    pushActivity('2', 'loadTallySpectrum', 'started');
    try {
      const result = await summarizeTallySpectrum(projectDir.trim());
      if (!result.ok || !result.summary || result.summary.tallies.length === 0) {
        const msg = result.message ?? 'No energy spectrum data found. Add energy filters to tallies and run OpenMC first.';
        setSummary(msg);
        setSpectrumData(null);
        setStep2Error(msg);
        pushActivity('2', 'loadTallySpectrum', 'failed', msg);
        return;
      }
      setSpectrumData(result.summary);
      pushActivity('2', 'loadTallySpectrum', 'success');
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setSummary(message);
      setSpectrumData(null);
      setStep2Error(message);
      pushActivity('2', 'loadTallySpectrum', 'failed', message);
    } finally {
      setIsStep2Loading(false);
      setStep2Action(null);
    }
  }

  async function loadCustomStatepoint() {
    if (!customStatepointPath.trim()) {
      setCustomSpMessage('Enter or drop a statepoint.*.h5 file path.');
      return;
    }
    setCustomSpMessage('Loading...');
    setIsStep1Loading(true);
    setStep1Action('custom');
    try {
      const result = await summarizeStatepointFile(customStatepointPath.trim());
      if (!result.ok || !result.summary) {
        setCustomSpMessage(result.message ?? 'Failed to parse statepoint.');
        return;
      }
      setStatepointSummary(result.summary);
      setCustomSpMessage(`Loaded: ${result.summary.statepointPath}`);
    } catch (caught) {
      setCustomSpMessage(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsStep1Loading(false);
      setStep1Action(null);
    }
  }

  function loadMockSensitivityResults() {
    const rows = project.model.tallies.flatMap((tally, tallyIndex) => {
      if (!tally.sensitivity?.enabled) return [];
      const nuclides = tally.sensitivity.nuclides;
      const scores = tally.sensitivity.scores.length > 0 ? tally.sensitivity.scores : tally.scores;
      return nuclides.flatMap((nuclide, nuclideIndex) =>
        scores.map((score, scoreIndex) => ({
          tallyName: tally.name,
          score,
          nuclide,
          mean: Number((1e-4 * (tallyIndex + 1) * (nuclideIndex + 1) * (scoreIndex + 1)).toExponential(6)),
          stdDev: Number((2.5e-6 * (scoreIndex + 1)).toExponential(6)),
        })),
      );
    });
    setSensitivityResults(rows.length > 0 ? rows : null);
    if (rows.length === 0) {
      setSummary('No sensitivity-enabled tallies found. Configure sensitivity in Model → Tallies first.');
    }
  }

  async function copyBridgePayloadTemplate() {
    const targetProjectDir = projectDir.trim() || '/tmp/openmc-gui-demo';
    const targetStatepoint = customStatepointPath.trim() || `${targetProjectDir}/generated/statepoint.100.h5`;
    const template = {
      summarize_statepoint: {
        request: {
          projectDir: targetProjectDir,
        },
      },
      statepoint_from_file: {
        request: {
          statepointPath: targetStatepoint,
        },
      },
    };
    const text = JSON.stringify(template, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setSummary('Bridge payload template copied to clipboard.');
    } catch {
      setSummary(`Copy failed. Use this payload manually:\n${text}`);
    }
  }

  async function copyBridgeCurlTemplate() {
    const targetProjectDir = projectDir.trim() || '/tmp/openmc-gui-demo';
    const targetStatepoint = customStatepointPath.trim() || `${targetProjectDir}/generated/statepoint.100.h5`;
    const summarizePayload = JSON.stringify({ request: { projectDir: targetProjectDir } });
    const filePayload = JSON.stringify({ request: { statepointPath: targetStatepoint } });
    const curlTemplate = [
      `curl -sS -X POST http://127.0.0.1:8765/summarize_statepoint -H 'content-type: application/json' -d '${summarizePayload}'`,
      `curl -sS -X POST http://127.0.0.1:8765/statepoint_from_file -H 'content-type: application/json' -d '${filePayload}'`,
    ].join('\n');
    try {
      await navigator.clipboard.writeText(curlTemplate);
      setSummary('Bridge curl template copied to clipboard.');
    } catch {
      setSummary(`Copy failed. Use this command manually:\n${curlTemplate}`);
    }
  }

  async function calculateStochasticVolume() {
    if (volumeCellIds.length === 0) {
      setVolumeMessage('Select at least one cell first.');
      setVolumeResults([]);
      return;
    }

    if (!projectDir.trim()) {
      setVolumeMessage('Enter a project directory first.');
      setVolumeResults([]);
      return;
    }

    try {
      await saveProjectBundle(projectDir.trim(), project);
      const workerResult = await runStochasticVolume(projectDir.trim(), volumeCellIds, volumeSamples);
      if (workerResult.ok && workerResult.results.length > 0) {
        setVolumeResults(workerResult.results);
        setVolumeMessage('Stochastic volume calculation completed.');
        return;
      }

      const mockResults = volumeCellIds.map((cellId, index) => ({
        cellId,
        volume: Number((100 + cellId * 10 + index * 0.25).toFixed(6)),
        stdDev: Number((0.1 + index * 0.01).toFixed(6)),
      }));
      setVolumeResults(mockResults);
      setVolumeMessage(workerResult.message ?? 'Mock stochastic volume results shown (worker returned no computed values).');
    } catch (caught) {
      const mockResults = volumeCellIds.map((cellId, index) => ({
        cellId,
        volume: Number((100 + cellId * 10 + index * 0.25).toFixed(6)),
        stdDev: Number((0.1 + index * 0.01).toFixed(6)),
      }));
      setVolumeResults(mockResults);
      setVolumeMessage(`Mock stochastic volume results shown: ${caught instanceof Error ? caught.message : String(caught)}`);
    }
  }

  const volumeCells = project.model.openmcGeometry?.cells ?? [];

  async function retryFailedStep(step: '1' | '2' | '3') {
    if (step === '1') {
      if (step1Action === 'summary' || step1Error?.includes('Runs:')) return loadSummary();
      if (step1Action === 'statepoint') return loadStatepointSummary();
      if (step1Action === 'custom') return loadCustomStatepoint();
      if (customStatepointPath.trim()) return loadCustomStatepoint();
      return loadSummary();
    }
    if (step === '2') {
      if (step2Action === 'depletion') return loadDepletionSummary();
      if (step2Action === 'spectrum') return loadTallySpectrum();
      return loadTallySpectrum();
    }
    if (step3Action === 'proof') return generateProofPack();
    if (step3Action === 'zip') return exportSubmissionZip();
    if (step3Action === 'list') return refreshProofPacks();
    if (step3Action === 'draft') return generateMimoAnswerDraft();
    return generateProofPack();
  }

  const step1State = stepState(hasRunSummary && hasStatepoint, isStep1Loading, step1Error);
  const step2State = stepState(hasStatepoint || Boolean(depletionSummary) || Boolean(spectrumData), isStep2Loading, step2Error);
  const step3State = stepState(hasArtifacts, isStep3Loading, step3Error);
  const qualityGateStatus: 'pass' | 'warn' | 'fail' | 'pending' = !statepointSummary
    ? 'pending'
    : qualityGateDetails.some((item) => item.startsWith('FAIL'))
      ? 'fail'
      : qualityGateDetails.some((item) => item.startsWith('WARN'))
        ? 'warn'
        : 'pass';

  return (
    <section className="panel-grid">
      <article className="card">
        <h3>Eigenvalue metrics</h3>
        <p>k-eff trend, rolling sigma, entropy stabilization, and convergence score.</p>
      </article>
      <article className="card">
        <h3>Results review + submission tools</h3>
        <p>For non-coding workflow: import results first, then inspect metrics/charts, then export evidence package.</p>
        {autoPipelineMessage && <p className="muted">{autoPipelineMessage}</p>}
        <div className="history-item" style={{ marginBottom: 10 }}>
          <strong>Simulation quality gate</strong>
          <span style={{ display: 'inline-flex', marginTop: 4, borderRadius: 999, padding: '3px 10px', fontWeight: 700, fontSize: 12,
            color: qualityGateStatus === 'pass' ? '#86efac' : qualityGateStatus === 'warn' ? '#fde68a' : qualityGateStatus === 'fail' ? '#fca5a5' : '#cbd5e1',
            background: qualityGateStatus === 'pass' ? 'rgba(34,197,94,.14)' : qualityGateStatus === 'warn' ? 'rgba(245,158,11,.16)' : qualityGateStatus === 'fail' ? 'rgba(239,68,68,.16)' : 'rgba(148,163,184,.12)',
            border: qualityGateStatus === 'pass' ? '1px solid rgba(34,197,94,.45)' : qualityGateStatus === 'warn' ? '1px solid rgba(245,158,11,.5)' : qualityGateStatus === 'fail' ? '1px solid rgba(239,68,68,.5)' : '1px solid rgba(148,163,184,.35)'
          }}>
            {qualityGateStatus === 'pass' ? 'PASS' : qualityGateStatus === 'warn' ? 'WARN' : qualityGateStatus === 'fail' ? 'FAIL' : 'PENDING'}
          </span>
          {qualityGateDetails.length === 0 ? (
            <span className="muted">Run/import statepoint first to evaluate quality.</span>
          ) : (
            <ul style={{ marginTop: 8, paddingLeft: 18 }}>
              {qualityGateDetails.map((item, idx) => (
                <li key={`quality-${idx}`} style={{ fontSize: 12 }}>{item}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="history-item" style={{ marginBottom: 10 }}>
          <strong>Step status</strong>
          <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <span>Step 1 — Import results</span>
            <span style={stepBadgeStyleByState(step1State)}>
              {step1State === 'pending' && <span style={spinnerGlyphStyle} aria-hidden="true">⏳</span>}
              {stepBadgeTextByState(step1State)}
            </span>
          </span>
          {step1Error && (
            <span style={{ color: '#fca5a5', fontSize: 12 }}>
              {step1Error}
              <button className="secondary-action" style={{ marginLeft: 8 }} onClick={() => retryFailedStep('1')} disabled={isStep1Loading}>Retry</button>
            </span>
          )}
          <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <span>Step 2 — Review + analysis</span>
            <span style={stepBadgeStyleByState(step2State)}>
              {step2State === 'pending' && <span style={spinnerGlyphStyle} aria-hidden="true">⏳</span>}
              {stepBadgeTextByState(step2State)}
            </span>
          </span>
          {step2Error && (
            <span style={{ color: '#fca5a5', fontSize: 12 }}>
              {step2Error}
              <button className="secondary-action" style={{ marginLeft: 8 }} onClick={() => retryFailedStep('2')} disabled={isStep2Loading}>Retry</button>
            </span>
          )}
          <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <span>Step 3 — Submission artifacts</span>
            <span style={stepBadgeStyleByState(step3State)}>
              {step3State === 'pending' && <span style={spinnerGlyphStyle} aria-hidden="true">⏳</span>}
              {stepBadgeTextByState(step3State)}
            </span>
          </span>
          {step3Error && (
            <span style={{ color: '#fca5a5', fontSize: 12 }}>
              {step3Error}
              <button className="secondary-action" style={{ marginLeft: 8 }} onClick={() => retryFailedStep('3')} disabled={isStep3Loading}>Retry</button>
            </span>
          )}
        </div>
        <div className="project-storage">
          <label htmlFor="results-project-dir">Project directory (where OpenMC outputs are saved)</label>
          <input id="results-project-dir" value={projectDir} onChange={(event) => setProjectDir(event.target.value)} placeholder="Example: /home/patrick/projects/my-openmc-case" />
          <p className="muted">Step 1 — Import results</p>
          <div className="action-row compact">
            <button className="primary-action" onClick={loadSummary} disabled={isStep1Loading} title={isStep1Loading ? 'Step 1 action in progress. Please wait.' : 'Import aggregated run summary.'}>{step1Action === 'summary' ? '⏳ Importing run summary...' : '1A) Import run summary'}</button>
            <button className="secondary-action" onClick={loadStatepointSummary} disabled={isStep1Loading} title={isStep1Loading ? 'Step 1 action in progress. Please wait.' : 'Import latest auto-detected statepoint summary.'}>{step1Action === 'statepoint' ? '⏳ Importing latest statepoint...' : '1B) Import latest statepoint summary'}</button>
            <button className="secondary-action" onClick={loadCustomStatepoint} disabled={isStep1Loading} title={isStep1Loading ? 'Step 1 action in progress. Please wait.' : 'Import statepoint from custom .h5 path.'}>{step1Action === 'custom' ? '⏳ Importing .h5 file...' : '1C) Import specific .h5 file'}</button>
            <input id="custom-sp-path" value={customStatepointPath} onChange={(e) => setCustomStatepointPath(e.target.value)} placeholder="Optional: paste full path statepoint.*.h5" style={{ fontSize: 12, padding: 6 }} />
            <button className="secondary-action" onClick={copyBridgePayloadTemplate} disabled={isStep1Loading} title={isStep1Loading ? 'Step 1 action in progress. Please wait.' : 'Copy valid bridge payload JSON template for debugging.'}>Copy bridge payload template</button>
            <button className="secondary-action" onClick={copyBridgeCurlTemplate} disabled={isStep1Loading} title={isStep1Loading ? 'Step 1 action in progress. Please wait.' : 'Copy ready-to-run curl commands for bridge endpoints.'}>Copy bridge curl command</button>
            {customSpMessage && <p className="muted">{customSpMessage}</p>}
            <button className="secondary-action" onClick={loadDepletionSummary} disabled={isStep2Loading} title={isStep2Loading ? 'Step 2 action in progress. Please wait.' : 'Import depletion k-eff timeline.'}>{step2Action === 'depletion' ? '⏳ Loading depletion summary...' : 'Import depletion summary'}</button>
          </div>
          <p className="muted">Step 2 — Review + analysis</p>
          <div className="action-row compact">
            <button className="secondary-action" onClick={loadTallySpectrum} disabled={isStep2Loading} title={isStep2Loading ? 'Step 2 action in progress. Please wait.' : 'Load energy-dependent tally spectrum.'}>{step2Action === 'spectrum' ? '⏳ Loading spectrum plot...' : 'Load spectrum plot'}</button>
            <button className="secondary-action" onClick={loadMockSensitivityResults} disabled={isStep2Loading} title={isStep2Loading ? 'Step 2 action in progress. Please wait.' : 'Load mock sensitivity values for quick inspection.'}>{isStep2Loading ? '⏳ Step 2 busy...' : 'Load sensitivity results (mock)'}</button>
            <button className="secondary-action" onClick={exportResultsCsv} disabled={isStep2Loading} title={isStep2Loading ? 'Step 2 action in progress. Please wait.' : 'Export currently loaded results to CSV.'}>{isStep2Loading ? '⏳ Step 2 busy...' : 'Export results CSV'}</button>
          </div>
          <p className="muted">Step 3 — Submission artifacts</p>
          <div className="action-row compact">
            <button className="primary-action" onClick={generateProofPack} disabled={isStep3Loading} title={isStep3Loading ? 'Step 3 action in progress. Please wait.' : 'Export proof pack artifacts.'}>{step3Action === 'proof' ? '⏳ Exporting proof pack...' : 'Export proof pack'}</button>
            <button className="primary-action" onClick={exportSubmissionZip} disabled={isStep3Loading} title={isStep3Loading ? 'Step 3 action in progress. Please wait.' : 'Export final submission ZIP.'}>{step3Action === 'zip' ? '⏳ Exporting submission ZIP...' : 'Export submission ZIP'}</button>
            <button className="secondary-action" onClick={refreshProofPacks} disabled={isStep3Loading} title={isStep3Loading ? 'Step 3 action in progress. Please wait.' : 'List existing proof packs from project folder.'}>{step3Action === 'list' ? '⏳ Loading proof packs...' : 'List proof packs'}</button>
            <button className="secondary-action" onClick={generateMimoAnswerDraft} disabled={isStep3Loading} title={isStep3Loading ? 'Step 3 action in progress. Please wait.' : 'Generate text draft for submission answer.'}>{step3Action === 'draft' ? '⏳ Generating Mimo draft...' : 'Generate Mimo draft'}</button>
          </div>
          {summary && <p className="muted">{summary}</p>}
          <RunTrendChart history={history} />
          {statepointSummary && (
            <div className="history-item">
              <strong>Latest statepoint</strong>
              <span>{statepointSummary.statepointPath}</span>
              <span>Size: {statepointSummary.sizeBytes} bytes</span>
              <span>k-eff: {statepointSummary.kEffective ?? 'n/a'} ± {statepointSummary.kStdDev ?? 'n/a'}</span>
              {statepointSummary.tallies && Array.isArray(statepointSummary.tallies) && statepointSummary.tallies.length > 0 && typeof statepointSummary.tallies[0] === 'string' && (
                <span>Tallies: {statepointSummary.tallies.join(', ')}</span>
              )}
              {statepointSummary.tallies && Array.isArray(statepointSummary.tallies) && statepointSummary.tallies.length > 0 && typeof statepointSummary.tallies[0] === 'object' && statepointSummary.tallies.every(
                (t) => t && typeof t === 'object' && 'id' in t,
              ) && (() => {
                const tallyResults = statepointSummary.tallies as unknown as Array<Record<string, unknown>>;
                return (
                  <details className="review-section" style={{ marginTop: 10 }} open={Boolean(noisiestTallyId)}>
                    <summary>
                      <strong>Tally results ({statepointSummary.nTallies ?? tallyResults.length})</strong>
                    </summary>
                    {noisiestTallyId && (
                      <p className="muted" style={{ marginTop: 8 }}>
                        Auto-focus noisy tally: id={noisiestTallyId} (highest relative stddev bin).
                      </p>
                    )}
                    <div style={{ marginTop: 10 }}>
                      {tallyResults.map((tally) => {
                        const tallyId = Number(tally.id);
                        const isNoisy = Number.isFinite(tallyId) && tallyId === noisiestTallyId;
                        return (
                        <div key={String(tally.id)} className="history-item" style={{ marginBottom: 8, border: isNoisy ? '1px solid rgba(245,158,11,.55)' : undefined, background: isNoisy ? 'rgba(245,158,11,.12)' : undefined }}>
                          <strong>{String(tally.name)} (id={String(tally.id)}) {isNoisy ? '⭐' : ''}</strong>
                          <span>Scores: {(tally.scores as string[] || []).join(', ')}</span>
                          {(tally.filters as Array<{ type: string; bins: unknown[] | null }>)?.map((f, fi) => (
                            <span key={fi} style={{ fontSize: 12 }}>
                              Filter: {f.type} {f.bins && Array.isArray(f.bins) && f.bins.length > 0 ? (f.bins.length > 4 ? `${String(f.bins[0])}..${String(f.bins[f.bins.length - 1])}` : `(n=${f.bins.length})`) : ''}
                            </span>
                          ))}
                          <span style={{ fontSize: 12 }}>Bins: {(tally.mean as number[]).length} | Mean total: {((tally.mean as number[]) || []).reduce((a, b) => a + b, 0).toExponential(4)}</span>
                          <span style={{ fontSize: 12 }}>Max stddev: {Math.max(...(((tally.stdDev as number[]) || []).map(Math.abs))).toExponential(4)}</span>
                        </div>
                        );
                      })}
                    </div>
                  </details>
                );
              })()}
              {statepointSummary.parseWarning && <span>{statepointSummary.parseWarning}</span>}
              {statepointSummary.kGenerationMean && statepointSummary.kGenerationMean.length > 1 && (
                <KeffConvergenceChart
                  meanSeries={statepointSummary.kGenerationMean}
                  stdSeries={statepointSummary.kGenerationStd}
                />
              )}
            </div>
          )}
          {depletionSummary && (
            <div className="history-item">
              <strong>Latest depletion results</strong>
              <span>{depletionSummary.resultsPath}</span>
              <span>Size: {depletionSummary.sizeBytes} bytes</span>
              {depletionSummary.parseWarning && <span>{depletionSummary.parseWarning}</span>}
              {depletionSummary.kEffective.length > 1 && (
                <DepletionKeffChart
                  timeSeries={depletionSummary.time}
                  meanSeries={depletionSummary.kEffective}
                  stdSeries={depletionSummary.kStdDev}
                />
              )}
            </div>
          )}
          <details className="review-section" style={{ marginTop: 10 }}>
            <summary>Stochastic volume calculation</summary>
            <p className="muted">Select OpenMC cell IDs and estimate volume using stochastic sampling (currently mocked in UI when worker has no data).</p>
            <label htmlFor="volume-samples">Samples</label>
            <input
              id="volume-samples"
              type="number"
              min={1}
              value={volumeSamples}
              onChange={(event) => setVolumeSamples(Math.max(1, Number(event.target.value) || 1_000_000))}
            />
            <div className="history-list" style={{ marginTop: 8 }}>
              {volumeCells.length === 0 ? (
                <p className="muted">No OpenMC cells available in current model.</p>
              ) : (
                volumeCells.map((cell) => (
                  <label key={cell.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={volumeCellIds.includes(cell.openmcId)}
                      onChange={(event) => {
                        if (event.target.checked) {
                          setVolumeCellIds((current) => Array.from(new Set([...current, cell.openmcId])));
                        } else {
                          setVolumeCellIds((current) => current.filter((id) => id !== cell.openmcId));
                        }
                      }}
                    />
                    <span>Cell #{cell.openmcId} — {cell.name}</span>
                  </label>
                ))
              )}
            </div>
            <div className="action-row compact" style={{ marginTop: 8 }}>
              <button className="primary-action" onClick={calculateStochasticVolume}>Calculate volume</button>
            </div>
            {volumeMessage && <p className="muted">{volumeMessage}</p>}
            {volumeResults.length > 0 && (
              <div className="history-list">
                {volumeResults.map((item) => (
                  <div key={`volume-${item.cellId}`} className="history-item">
                    <strong>Cell #{item.cellId}</strong>
                    <span>{item.volume.toExponential(6)} ± {item.stdDev.toExponential(6)}</span>
                  </div>
                ))}
              </div>
            )}
          </details>
          {proofMessage && <p className="muted">{proofMessage}</p>}
          {spectrumData && spectrumData.tallies.map((tally, tallyIdx) => (
            <TallySpectrumChart key={`${tally.tallyId}-${tallyIdx}`} tally={tally} />
          ))}
          <details className="review-section" style={{ marginTop: 10 }} open>
            <summary>Sensitivity Results</summary>
            <p className="muted">This panel shows mock sensitivity derivative values scaffolded from tally sensitivity settings. Full values require OpenMC sensitivity-capable statepoint processing.</p>
            {!sensitivityResults && <p className="muted">No sensitivity results loaded.</p>}
            {sensitivityResults && sensitivityResults.length > 0 && (
              <div className="history-list">
                {sensitivityResults.map((row, idx) => (
                  <div key={`sens-${idx}`} className="history-item">
                    <strong>{row.tallyName} | {row.score} wrt {row.nuclide}</strong>
                    <span>{row.mean.toExponential(6)} ± {row.stdDev.toExponential(6)}</span>
                  </div>
                ))}
              </div>
            )}
          </details>
          {bundleMessage && <p className="muted">{bundleMessage}</p>}
          {draftMessage && <p className="muted">{draftMessage}</p>}
          {proofPacks.length > 0 && (
            <div className="history-list">
              {proofPacks.map((pack) => (
                <div key={pack.name} className="history-item">
                  <strong>{pack.name}</strong>
                  <span>{pack.path}</span>
                  <span>{pack.modifiedAt}</span>
                </div>
              ))}
            </div>
          )}
          <details className="review-section" style={{ marginTop: 10 }}>
            <summary>Recent activity log</summary>
            {activityLog.length === 0 ? (
              <p className="muted">No activity yet.</p>
            ) : (
              <div className="history-list">
                {activityLog.map((item, idx) => (
                  <div key={`${item.ts}-${idx}`} className="history-item">
                    <strong>Step {item.step} • {item.action}</strong>
                    <span>{item.status.toUpperCase()} • {new Date(item.ts).toLocaleTimeString()}</span>
                    {item.note && <span style={{ color: '#fca5a5' }}>{item.note}</span>}
                  </div>
                ))}
              </div>
            )}
          </details>
          <div className="history-item">
            <strong>Submit-ready checklist</strong>
            <span>1. Import run summary and confirm at least one successful run.</span>
            <span>2. Import statepoint summary (.h5) and review k-eff + tally table.</span>
            <span>3. Export proof pack / submission ZIP and attach generated artifacts.</span>
            <span>4. Submit public repo URL + verification screenshots.</span>
          </div>
        </div>
      </article>
    </section>
  );
}

function KeffConvergenceChart({ meanSeries, stdSeries }: { meanSeries: number[]; stdSeries?: number[] }) {
  if (meanSeries.length < 2) return null;

  const width = 420;
  const height = 160;
  const minK = Math.min(...meanSeries);
  const maxK = Math.max(...meanSeries);
  const span = Math.max(1e-6, maxK - minK);
  const padX = 16;
  const padY = 20;

  const xScale = (index: number) => (meanSeries.length === 1 ? width / 2 : padX + (index / (meanSeries.length - 1)) * (width - padX * 2));
  const yScale = (value: number) => padY + ((maxK - value) / span) * (height - padY * 2);

  const linePath = meanSeries
    .map((value, index) => `${index === 0 ? 'M' : 'L'} ${xScale(index)} ${yScale(value)}`)
    .join(' ');

  return (
    <div className="trend-chart">
      <strong>k-eff convergence by generation</strong>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="k-effective convergence chart">
        <line x1={padX} y1={height - padY} x2={width - padX} y2={height - padY} className="axis" />
        <line x1={padX} y1={padY} x2={width - padX} y2={padY} className="axis" />
        <path d={linePath} className="trend-line" />
        {meanSeries.map((value, index) => (
          <circle key={`k-${index}`} cx={xScale(index)} cy={yScale(value)} r="2.8" className="trend-ok">
            <title>
              gen {index + 1}: {value.toFixed(6)}
              {stdSeries?.[index] !== undefined ? ` ± ${stdSeries[index].toFixed(6)}` : ''}
            </title>
          </circle>
        ))}
      </svg>
      <span>min {minK.toFixed(6)} / max {maxK.toFixed(6)} / last {meanSeries[meanSeries.length - 1].toFixed(6)}</span>
    </div>
  );
}

function DepletionKeffChart({ timeSeries, meanSeries, stdSeries }: { timeSeries: number[]; meanSeries: number[]; stdSeries?: number[] }) {
  if (meanSeries.length < 2) return null;

  const width = 420;
  const height = 170;
  const minK = Math.min(...meanSeries);
  const maxK = Math.max(...meanSeries);
  const span = Math.max(1e-6, maxK - minK);
  const padX = 18;
  const padY = 20;

  const xScale = (index: number) => (meanSeries.length === 1 ? width / 2 : padX + (index / (meanSeries.length - 1)) * (width - padX * 2));
  const yScale = (value: number) => padY + ((maxK - value) / span) * (height - padY * 2);

  const linePath = meanSeries.map((value, index) => `${index === 0 ? 'M' : 'L'} ${xScale(index)} ${yScale(value)}`).join(' ');

  return (
    <div className="trend-chart">
      <strong>depletion k-eff trend</strong>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="depletion k-effective trend">
        <line x1={padX} y1={height - padY} x2={width - padX} y2={height - padY} className="axis" />
        <line x1={padX} y1={padY} x2={width - padX} y2={padY} className="axis" />
        <path d={linePath} className="trend-line" />
        {meanSeries.map((value, index) => (
          <circle key={`d-${index}`} cx={xScale(index)} cy={yScale(value)} r="2.8" className="trend-ok">
            <title>
              step {index + 1}
              {timeSeries[index] !== undefined ? ` | t=${timeSeries[index].toFixed(3)}` : ''}
              : {value.toFixed(6)}
              {stdSeries?.[index] !== undefined ? ` ± ${stdSeries[index].toFixed(6)}` : ''}
            </title>
          </circle>
        ))}
      </svg>
      <span>steps {meanSeries.length} | min {minK.toFixed(6)} | max {maxK.toFixed(6)}</span>
    </div>
  );
}

function RunTrendChart({ history }: { history: RunHistoryEntry[] }) {
  if (history.length === 0) {
    return <p className="muted">No run history loaded yet.</p>;
  }

  const orderedHistory = [...history].reverse();
  const points = orderedHistory.map((entry, index) => ({
    x: index,
    y: entry.ok ? 1 : 0,
    runId: entry.runId,
  }));

  const width = 420;
  const height = 130;
  const xScale = (index: number) => (points.length === 1 ? width / 2 : (index / (points.length - 1)) * (width - 20) + 10);
  const yScale = (value: number) => (value === 1 ? 24 : height - 24);
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${xScale(point.x)} ${yScale(point.y)}`).join(' ');

  return (
    <div className="trend-chart">
      <strong>Run success trend</strong>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Run success trend chart">
        <line x1="10" y1={height - 24} x2={width - 10} y2={height - 24} className="axis" />
        <line x1="10" y1="24" x2={width - 10} y2="24" className="axis" />
        <path d={path} className="trend-line" />
        {points.map((point, index) => (
          <circle key={`${point.x}-${point.y}`} cx={xScale(point.x)} cy={yScale(point.y)} r="3.5" className={point.y ? 'trend-ok' : 'trend-fail'}>
            <title>{point.runId}: {point.y ? 'OK' : 'FAILED'}</title>
          </circle>
        ))}
      </svg>
    </div>
  );
}

function TallySpectrumChart({ tally }: { tally: TallySpectrumData }) {
  const bins = tally.energyBins;
  const mean = tally.mean;
  const stdDev = tally.stdDev;
  if (bins.length < 2 || mean.length === 0) return null;

  const binCenters: number[] = [];
  for (let i = 0; i < bins.length - 1; i += 1) {
    binCenters.push((bins[i] + bins[i + 1]) / 2);
  }

  const xs = binCenters.length > 0 ? binCenters : bins.slice(0, -1);
  const ys = mean.length === xs.length ? mean : mean.slice(0, xs.length);
  if (xs.length < 1) return null;

  const width = 520;
  const height = 200;
  const padX = 60;
  const padY = 20;

  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMax = Math.max(...ys, 1e-12);
  const logYMax = Math.log10(yMax);

  const xScale = (value: number) => padX + (value - xMin) / Math.max(1e-12, xMax - xMin) * (width - padX * 2);
  const yScale = (value: number) => padY + (1 - Math.log10(Math.max(value, 1e-30)) / logYMax) * (height - padY * 2);

  const points = xs.map((x, i) => ({ x: xScale(x), y: yScale(ys[i]) }));
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  const errPoints: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (let i = 0; i < xs.length && i < stdDev.length; i += 1) {
    const upper = Math.max(ys[i] + stdDev[i], 1e-30);
    const lower = Math.max(ys[i] - stdDev[i], 1e-30);
    errPoints.push({ x1: points[i].x, y1: yScale(upper), x2: points[i].x, y2: yScale(lower) });
  }

  return (
    <div className="trend-chart" style={{ marginTop: 12 }}>
      <strong>{tally.tallyName} ({tally.scores.join(', ')}) — energy spectrum</strong>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="tally energy spectrum chart">
        <line x1={padX} y1={height - padY} x2={width - padX} y2={height - padY} className="axis" />
        <line x1={padX} y1={padY} x2={width - padX} y2={padY} className="axis" />
        {errPoints.map((ep, i) => (
          <line key={`err-${i}`} x1={ep.x1} y1={ep.y1} x2={ep.x2} y2={ep.y2} stroke="rgba(148,163,184,.3)" strokeWidth="1" />
        ))}
        <path d={linePath} className="trend-line" />
        {points.map((p, i) => (
          <circle key={`sp-${i}`} cx={p.x} cy={p.y} r="2.5" className="trend-ok">
            <title>E={xs[i].toFixed(2)} eV: {ys[i].toFixed(6)} ± {stdDev[i]?.toFixed(6) ?? '?'}</title>
          </circle>
        ))}
        <text x={padX} y={height - 4} fontSize="10" fill="rgba(148,163,184,.6)">Energy (eV)</text>
      </svg>
      <span>bins: {bins.length - 1} | max response: {yMax.toExponential(2)}</span>
    </div>
  );
}
