import { validateModelBasics, type ReactorModel } from '@openmc-studio/schema';
import { useMemo } from 'react';
import { create } from 'zustand';

type StudioStep = 'environment' | 'model' | 'validate' | 'run' | 'results';

interface StudioState {
  step: StudioStep;
  setStep: (step: StudioStep) => void;
}

const useStudioState = create<StudioState>((set) => ({
  step: 'environment',
  setStep: (step) => set({ step }),
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
  const { step, setStep } = useStudioState();
  const diagnostics = useMemo(() => validateModelBasics(sampleModel), []);

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
          <span className="status-pill">Sprint 1 scaffold</span>
        </header>
        {step === 'environment' && <EnvironmentPanel />}
        {step === 'model' && <ModelPanel />}
        {step === 'validate' && <ValidationPanel diagnostics={diagnostics} />}
        {step === 'run' && <RunPanel />}
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
  return (
    <section className="panel-grid">
      <article className="card hero-card">
        <p className="eyebrow">First launch workflow</p>
        <h2>Detect OpenMC without forcing users into a terminal.</h2>
        <p>
          The desktop shell will call the on-demand Python worker to detect PATH, Python module, conda, cross sections,
          and manual profiles.
        </p>
      </article>
      <article className="card checklist">
        <h3>Health checks</h3>
        <ul>
          <li>OpenMC executable or Python module</li>
          <li>Cross-section library</li>
          <li>Version probe</li>
          <li>Sample smoke run</li>
        </ul>
      </article>
    </section>
  );
}

function ModelPanel() {
  return (
    <section className="canvas-layout">
      <article className="card tree-card">
        <h3>Hierarchy</h3>
        <div className="tree-node">Core</div>
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
