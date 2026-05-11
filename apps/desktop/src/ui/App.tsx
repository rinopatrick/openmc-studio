import {
  createProjectBundle,
  validateModelBasics,
  type ProjectBundle,
  type ReactorFamily,
  type ReactorModel,
} from '@openmc-studio/schema';
import { useMemo, useState } from 'react';
import { create } from 'zustand';
import {
  detectOpenMcEnvironment,
  healthCheckOpenMc,
  workerHandshake,
  type DetectEnvironmentResponse,
  type HealthCheckResponse,
  type OpenMcCandidate,
} from '../tauri/worker.js';

type StudioStep = 'environment' | 'model' | 'validate' | 'run' | 'results';

interface StudioState {
  step: StudioStep;
  project: ProjectBundle;
  setStep: (step: StudioStep) => void;
  createProject: (family: ReactorFamily) => void;
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
  createProject: (family) =>
    set({
      step: 'model',
      project: createProjectBundle({
        id: crypto.randomUUID(),
        name: defaultProjectName(family),
        family,
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
        {step === 'run' && <RunPanel />}
        {step === 'results' && <ResultsPanel />}
      </section>
    </main>
  );
}

function defaultProjectName(family: ReactorFamily): string {
  return {
    pwr: 'PWR Project',
    bwr: 'BWR Project',
    'phwr-candu': 'PHWR/CANDU Project',
    htgr: 'HTGR Project',
    sfr: 'SFR Project',
    lfr: 'LFR Project',
    msr: 'MSR Project',
    smr: 'SMR Project',
    research: 'Research Reactor Project',
    'shielding-fixed-source': 'Shielding Project',
    'custom-irregular': 'Custom Irregular Reactor',
  }[family];
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
  const createProject = useStudioState((state) => state.createProject);

  return (
    <section className="canvas-layout">
      <article className="card tree-card">
        <h3>Hierarchy</h3>
        <p className="muted">{project.model.family}</p>
        <div className="preset-grid">
          {(['pwr', 'bwr', 'phwr-candu', 'htgr', 'sfr', 'lfr', 'msr', 'smr', 'research', 'shielding-fixed-source', 'custom-irregular'] as ReactorFamily[]).map((family) => (
            <button key={family} className="preset-button" onClick={() => createProject(family)}>
              {defaultProjectName(family)}
            </button>
          ))}
        </div>
        <div className="tree-node">{project.model.root.name}</div>
        <div className="tree-node child">Assembly / Block / Region</div>
        <div className="tree-node child">Pin / Cell / Custom shape</div>
      </article>
      <article className="card canvas-card">
        <div className="canvas-header">
          <h3>Top View</h3>
          <span>Rect / Hex / Irregular</span>
        </div>
        <div className="mock-canvas top-view" />
      </article>
      <article className="card canvas-card">
        <div className="canvas-header">
          <h3>Sectional View</h3>
          <span>Synced selection</span>
        </div>
        <div className="mock-canvas section-view" />
      </article>
    </section>
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

function RunPanel() {
  return (
    <section className="card hero-card">
      <p className="eyebrow">Run orchestration</p>
      <h2>Jobs will run through the Python worker on demand.</h2>
      <p>Planned controls: start, cancel, retry, live logs, ETA, run manifests, and reproducibility snapshots.</p>
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
