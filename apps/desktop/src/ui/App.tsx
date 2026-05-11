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
import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import {
  detectOpenMcEnvironment,
  healthCheckOpenMc,
  generateOpenMcInputs,
  listRunHistory,
  exportProofPack,
  exportSubmissionBundle,
  generateMimoDraft,
  liveRunStatus,
  listProofPacks,
  runOpenMc,
  summarizeStatepoint,
  summarizeResults,
  workerHandshake,
  type DetectEnvironmentResponse,
  type HealthCheckResponse,
  type OpenMcCandidate,
  type RunHistoryEntry,
  type StatepointSummary,
  type ProofPackEntry,
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
  const [manualCommand, setManualCommand] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [runLog, setRunLog] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [runHistory, setRunHistory] = useState<RunHistoryEntry[]>([]);
  const [liveStatus, setLiveStatus] = useState<string>('idle');
  const [liveMeta, setLiveMeta] = useState<string>('No active run');

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

    try {
      await saveProjectBundle(projectDir.trim(), project);
      await generateOpenMcInputs(projectDir.trim());
      const command = manualCommand.trim() ? splitCommand(manualCommand.trim()) : undefined;
      const result = await runOpenMc(projectDir.trim(), command);
      setMessage(result.ok ? `Run ${result.runId} completed.` : result.message ?? `Run failed with code ${result.returnCode}.`);
      setRunLog([result.stdoutTail, result.stderrTail].filter(Boolean).join('\n'));
      await refreshHistory();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <section className="panel-grid">
      <article className="card hero-card">
        <p className="eyebrow">Run orchestration</p>
        <h2>Generated OpenMC artifacts are now traceable from the GUI model.</h2>
        <p>Next step: write these files into the project `generated` folder and launch OpenMC through the worker.</p>
        <div className="project-storage">
          <div className="history-item">
            <strong>Live status: {liveStatus}</strong>
            <span>{liveMeta}</span>
          </div>
          <label htmlFor="run-project-dir">Project directory</label>
          <input id="run-project-dir" value={projectDir} onChange={(event) => setProjectDir(event.target.value)} placeholder="Project folder to write generated inputs" />
          <label htmlFor="openmc-command">OpenMC command override</label>
          <input id="openmc-command" value={manualCommand} onChange={(event) => setManualCommand(event.target.value)} placeholder="optional, e.g. openmc or python -m openmc" />
          <div className="action-row compact">
            <button className="secondary-action" onClick={writeInputs}>Write generated OpenMC inputs</button>
            <button className="primary-action" disabled={isRunning} onClick={executeOpenMc}>{isRunning ? 'Running...' : 'Run OpenMC'}</button>
            <button className="secondary-action" onClick={refreshHistory}>Refresh run history</button>
          </div>
          {message && <p className="muted">{message}</p>}
          {runLog && <pre>{runLog}</pre>}
        </div>
      </article>
      <article className="card artifact-preview">
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

function ResultsPanel({ project }: { project: ProjectBundle }) {
  const [projectDir, setProjectDir] = useState('');
  const [summary, setSummary] = useState<string | null>(null);
  const [statepointSummary, setStatepointSummary] = useState<StatepointSummary | null>(null);
  const [proofMessage, setProofMessage] = useState<string | null>(null);
  const [bundleMessage, setBundleMessage] = useState<string | null>(null);
  const [draftMessage, setDraftMessage] = useState<string | null>(null);
  const [history, setHistory] = useState<RunHistoryEntry[]>([]);
  const [proofPacks, setProofPacks] = useState<ProofPackEntry[]>([]);

  async function loadSummary() {
    if (!projectDir.trim()) {
      setSummary('Enter a project directory first.');
      return;
    }

    try {
      await saveProjectBundle(projectDir.trim(), project);
      const value = await summarizeResults(projectDir.trim());
      setSummary(
        `Runs: ${value.totalRuns}, success: ${value.successfulRuns}, failed: ${value.failedRuns}, latest: ${value.latestRunId ?? 'n/a'}`,
      );
      setHistory(await listRunHistory(projectDir.trim()));
    } catch (caught) {
      setSummary(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function generateProofPack() {
    if (!projectDir.trim()) {
      setProofMessage('Enter a project directory first.');
      return;
    }

    try {
      await saveProjectBundle(projectDir.trim(), project);
      const result = await exportProofPack(projectDir.trim(), 'https://github.com/rinopatrick/openmc-studio');
      setProofMessage(`Proof pack created at ${result.proofPackDir}`);
      setProofPacks(await listProofPacks(projectDir.trim()));
    } catch (caught) {
      setProofMessage(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function refreshProofPacks() {
    if (!projectDir.trim()) {
      setProofPacks([]);
      return;
    }
    setProofPacks(await listProofPacks(projectDir.trim()));
  }

  async function exportSubmissionZip() {
    if (!projectDir.trim()) {
      setBundleMessage('Enter a project directory first.');
      return;
    }

    try {
      await saveProjectBundle(projectDir.trim(), project);
      const result = await exportSubmissionBundle(projectDir.trim(), 'https://github.com/rinopatrick/openmc-studio');
      setBundleMessage(`Submission ZIP created at ${result.bundlePath}`);
    } catch (caught) {
      setBundleMessage(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function generateMimoAnswerDraft() {
    if (!projectDir.trim()) {
      setDraftMessage('Enter a project directory first.');
      return;
    }

    try {
      await saveProjectBundle(projectDir.trim(), project);
      const result = await generateMimoDraft(projectDir.trim(), 'https://github.com/rinopatrick/openmc-studio');
      setDraftMessage(`Mimo draft generated at ${result.draftPath}`);
    } catch (caught) {
      setDraftMessage(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function loadStatepointSummary() {
    if (!projectDir.trim()) {
      setSummary('Enter a project directory first.');
      return;
    }

    try {
      const result = await summarizeStatepoint(projectDir.trim());
      if (!result.ok || !result.summary) {
        setSummary(result.message ?? 'No statepoint summary available.');
        setStatepointSummary(null);
        return;
      }
      setStatepointSummary(result.summary);
    } catch (caught) {
      setSummary(caught instanceof Error ? caught.message : String(caught));
      setStatepointSummary(null);
    }
  }

  return (
    <section className="panel-grid">
      <article className="card">
        <h3>Eigenvalue metrics</h3>
        <p>k-eff trend, rolling sigma, entropy stabilization, and convergence score.</p>
      </article>
      <article className="card">
        <h3>Results and proof tools</h3>
        <p>Summarize run history and export Mimo100T proof pack artifacts from the project folder.</p>
        <div className="project-storage">
          <label htmlFor="results-project-dir">Project directory</label>
          <input id="results-project-dir" value={projectDir} onChange={(event) => setProjectDir(event.target.value)} placeholder="Project folder path" />
          <div className="action-row compact">
            <button className="secondary-action" onClick={loadSummary}>Load run summary</button>
            <button className="secondary-action" onClick={loadStatepointSummary}>Load statepoint summary</button>
            <button className="primary-action" onClick={generateProofPack}>Export proof pack</button>
            <button className="secondary-action" onClick={refreshProofPacks}>List proof packs</button>
            <button className="primary-action" onClick={exportSubmissionZip}>Export submission ZIP</button>
            <button className="secondary-action" onClick={generateMimoAnswerDraft}>Generate Mimo draft</button>
          </div>
          {summary && <p className="muted">{summary}</p>}
          <RunTrendChart history={history} />
          {statepointSummary && (
            <div className="history-item">
              <strong>Latest statepoint</strong>
              <span>{statepointSummary.statepointPath}</span>
              <span>Size: {statepointSummary.sizeBytes} bytes</span>
              <span>k-eff: {statepointSummary.kEffective ?? 'n/a'} ± {statepointSummary.kStdDev ?? 'n/a'}</span>
              {statepointSummary.tallies && <span>Tallies: {statepointSummary.tallies.join(', ')}</span>}
              {statepointSummary.parseWarning && <span>{statepointSummary.parseWarning}</span>}
            </div>
          )}
          {proofMessage && <p className="muted">{proofMessage}</p>}
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
          <div className="history-item">
            <strong>Submit-ready checklist</strong>
            <span>1. Run `Load run summary` and ensure at least one successful run.</span>
            <span>2. Run `Load statepoint summary` and capture screenshot.</span>
            <span>3. Run `Export proof pack` and attach generated files.</span>
            <span>4. Submit GitHub public URL + terminal verification screenshots.</span>
          </div>
        </div>
      </article>
    </section>
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
