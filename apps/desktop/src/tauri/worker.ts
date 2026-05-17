import { invoke } from '@tauri-apps/api/core';

export interface WorkerResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export interface OpenMcCandidate {
  kind: string;
  command: string[];
  label: string;
}

export interface DetectEnvironmentResponse {
  ok: boolean;
  candidates: OpenMcCandidate[];
  crossSections?: string | null;
}

export interface HealthCheck {
  id: string;
  ok: boolean;
  message: string;
  command?: string[];
}

export interface HealthCheckResponse {
  ok: boolean;
  checks: HealthCheck[];
}

export async function workerHandshake(): Promise<WorkerResult> {
  return invokeWorker('worker_handshake');
}

export async function detectOpenMcEnvironment(): Promise<DetectEnvironmentResponse> {
  const result = await invokeWorker('detect_openmc_environment');
  return parseWorkerJson<DetectEnvironmentResponse>(result);
}

export async function healthCheckOpenMc(command?: string[]): Promise<HealthCheckResponse> {
  const result = await invokeWorker('health_check_openmc', { request: { command } });
  return parseWorkerJson<HealthCheckResponse>(result);
}

export async function setWorkerPython(pythonPath?: string): Promise<string> {
  if (!canUseTauriInvoke()) {
    return pythonPath?.trim() ? `Preview mode: ${pythonPath.trim()}` : 'Preview mode: default python';
  }
  const value = pythonPath?.trim();
  return invoke<string>('set_worker_python', { pythonPath: value && value.length > 0 ? value : null });
}

export async function getWorkerPython(): Promise<string | null> {
  if (!canUseTauriInvoke()) {
    return null;
  }
  const value = await invoke<string | null>('get_worker_python');
  return value ?? null;
}

export async function generateOpenMcInputs(projectDir: string): Promise<{ ok: boolean; generatedDir: string; files: string[] }> {
  const result = await invokeWorker('generate_openmc_inputs', { request: { projectDir } });
  return parseWorkerJson<{ ok: boolean; generatedDir: string; files: string[] }>(result);
}

export interface OpenMcRunResult {
  ok: boolean;
  runId?: string;
  runDir?: string;
  returnCode?: number;
  stdoutTail?: string;
  stderrTail?: string;
  message?: string;
  batchProgress?: { current: number; total: number; percent: number };
  kFromLog?: { kCombined: number; kStdDev: number };
  errorAnalysis?: {
    errors: Array<{ type: string; message: string; fatal: boolean }>;
    warnings: string[];
    hasFatal: boolean;
    summary: string;
  };
}

export interface LiveRunStatus {
  ok: boolean;
  runId?: string;
  status?: 'running' | 'completed' | 'failed';
  returnCode?: number;
  startedAt?: string;
  endedAt?: string;
  stdoutTail?: string;
  stderrTail?: string;
  runDir?: string;
  message?: string;
  batchProgress?: { current: number; total: number; percent: number };
  kFromLog?: { kCombined: number; kStdDev: number };
}

export interface RunHistoryEntry {
  runId: string;
  ok?: boolean;
  returnCode?: number;
  kEffective?: number;
  kStdDev?: number;
  startedAt?: string;
  endedAt?: string;
  runDir: string;
}

export interface ResultsSummary {
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  latestRunId?: string | null;
  latestReturnCode?: number | null;
  latestStartedAt?: string | null;
}

export interface TallyFilterInfo {
  type: string;
  bins: unknown[] | null;
}

export interface TallyResult {
  id: number;
  name: string;
  scores: string[];
  mean: number[];
  stdDev: number[];
  filters: TallyFilterInfo[];
}

export interface StatepointSummary {
  statepointPath: string;
  sizeBytes: number;
  modifiedAt: string;
  kEffective?: number | null;
  kStdDev?: number | null;
  kGenerationMean?: number[];
  kGenerationStd?: number[];
  tallies?: TallyResult[] | string[] | null;
  nTallies?: number;
  parseWarning?: string;
}

export interface ProofPackEntry {
  name: string;
  path: string;
  hasChecklist: boolean;
  modifiedAt: string;
}

export async function runOpenMc(projectDir: string, command?: string[]): Promise<OpenMcRunResult> {
  const result = await invokeWorker('run_openmc', { request: { projectDir, command, timeoutSeconds: 3600 } });
  return parseWorkerJson<OpenMcRunResult>(result);
}

export interface OpenMcPlotResult {
  ok: boolean;
  imagePath?: string | null;
  generatedDir?: string;
  returnCode?: number;
  stdoutTail?: string;
  stderrTail?: string;
  message?: string | null;
}

export async function renderOpenMcPlot(projectDir: string, command?: string[]): Promise<OpenMcPlotResult> {
  const result = await invokeWorker('render_openmc_plot', { request: { projectDir, command, timeoutSeconds: 120 } });
  return parseWorkerJson<OpenMcPlotResult>(result);
}

export async function liveRunStatus(projectDir: string, runId?: string, tail = 3000): Promise<LiveRunStatus> {
  const result = await invokeWorker('live_run_status', { request: { projectDir, runId, tail } });
  return parseWorkerJson<LiveRunStatus>(result);
}

export async function listRunHistory(projectDir: string): Promise<RunHistoryEntry[]> {
  if (!canUseTauriInvoke()) {
    return [];
  }

  try {
    return await invoke<RunHistoryEntry[]>('list_run_history', { request: { projectDir } });
  } catch {
    return [];
  }
}

export async function summarizeResults(projectDir: string): Promise<ResultsSummary> {
  const result = await invokeWorker('summarize_results', { request: { projectDir } });
  const parsed = parseWorkerJson<{ ok: boolean; summary: ResultsSummary }>(result);
  return parsed.summary;
}

export async function exportProofPack(projectDir: string, repoUrl: string): Promise<{ ok: boolean; proofPackDir: string }> {
  const result = await invokeWorker('export_proof_pack', { request: { projectDir, repoUrl } });
  return parseWorkerJson<{ ok: boolean; proofPackDir: string }>(result);
}

export async function summarizeStatepoint(projectDir: string): Promise<{ ok: boolean; message?: string; summary?: StatepointSummary | null }> {
  const result = await invokeWorker('summarize_statepoint', { request: { projectDir } });
  return parseWorkerJson<{ ok: boolean; message?: string; summary?: StatepointSummary | null }>(result);
}

export interface DepletionSummary {
  resultsPath: string;
  sizeBytes: number;
  modifiedAt: string;
  time: number[];
  kEffective: number[];
  kStdDev: number[];
  parseWarning?: string;
}

export async function summarizeDepletion(projectDir: string): Promise<{ ok: boolean; message?: string; summary?: DepletionSummary | null }> {
  const result = await invokeWorker('summarize_depletion', { request: { projectDir } });
  return parseWorkerJson<{ ok: boolean; message?: string; summary?: DepletionSummary | null }>(result);
}

export interface TallySpectrumData {
  tallyId: number;
  tallyName: string;
  scores: string[];
  energyBins: number[];
  mean: number[];
  stdDev: number[];
}

export interface StochasticVolumeResult {
  cellId: number;
  volume: number;
  stdDev: number;
}

export async function summarizeTallySpectrum(projectDir: string, tallyId?: number): Promise<{ ok: boolean; message?: string; summary?: { statepointPath: string; tallies: TallySpectrumData[] } | null }> {
  const result = await invokeWorker('summarize_tally_spectrum', { request: { projectDir, tallyId } });
  return parseWorkerJson<{ ok: boolean; message?: string; summary?: { statepointPath: string; tallies: TallySpectrumData[] } | null }>(result);
}

export async function listProofPacks(projectDir: string): Promise<ProofPackEntry[]> {
  const result = await invokeWorker('list_proof_packs', { request: { projectDir } });
  const parsed = parseWorkerJson<{ ok: boolean; proofPacks: ProofPackEntry[] }>(result);
  return parsed.proofPacks;
}

export async function runStochasticVolume(projectDir: string, cellIds: number[], samples = 1_000_000): Promise<{ ok: boolean; results: StochasticVolumeResult[]; message?: string }> {
  const result = await invokeWorker('run_stochastic_volume', { request: { projectDir, cellIds, samples } });
  return parseWorkerJson<{ ok: boolean; results: StochasticVolumeResult[]; message?: string }>(result);
}

export async function exportSubmissionBundle(projectDir: string, repoUrl: string): Promise<{ ok: boolean; bundlePath: string }> {
  const result = await invokeWorker('export_submission_bundle', { request: { projectDir, repoUrl } });
  return parseWorkerJson<{ ok: boolean; bundlePath: string }>(result);
}

export async function generateMimoDraft(projectDir: string, repoUrl: string): Promise<{ ok: boolean; draftPath: string }> {
  const result = await invokeWorker('generate_mimo_draft', { request: { projectDir, repoUrl } });
  return parseWorkerJson<{ ok: boolean; draftPath: string }>(result);
}

export interface OpenmcErrorAnalysis {
  errors: Array<{ type: string; message: string; fatal: boolean }>;
  warnings: string[];
  hasFatal: boolean;
  summary: string;
}

export async function parseOpenmcErrors(projectDir: string, runId?: string): Promise<OpenmcErrorAnalysis> {
  const result = await invokeWorker('parse_openmc_errors', { request: { projectDir, runId } });
  return parseWorkerJson<OpenmcErrorAnalysis>(result);
}

export async function summarizeStatepointFile(statepointPath: string): Promise<{ ok: boolean; message?: string; summary?: StatepointSummary | null }> {
  const result = await invokeWorker('statepoint_from_file', { request: { statepointPath } });
  return parseWorkerJson<{ ok: boolean; message?: string; summary?: StatepointSummary | null }>(result);
}

async function invokeWorker(command: string, args?: Record<string, unknown>): Promise<WorkerResult> {
  if (!canUseTauriInvoke()) {
    return invokeBrowserBridge(command, args);
  }

  try {
    return await invoke<WorkerResult>(command, args);
  } catch (error) {
    return {
      ok: false,
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
    };
  }
}

function canUseTauriInvoke(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function invokeBrowserBridge(command: string, args?: Record<string, unknown>): Promise<WorkerResult> {
  try {
    const response = await fetch(`http://127.0.0.1:8765/${command}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(args ?? {}),
    });
    if (!response.ok) {
      throw new Error(`Worker bridge returned HTTP ${response.status}.`);
    }
    return (await response.json()) as WorkerResult;
  } catch {
    return browserPreviewResult(command);
  }
}

function browserPreviewResult(command: string): WorkerResult {
  const message = 'Browser preview mode: OpenMC worker commands are available only in the Tauri desktop app.';

  if (command === 'detect_openmc_environment') {
    return jsonWorkerResult({ ok: false, candidates: [], crossSections: null, message });
  }

  if (command === 'health_check_openmc') {
    return jsonWorkerResult({
      ok: false,
      checks: [{ id: 'tauri-runtime', ok: false, message }],
    });
  }

  if (command === 'worker_handshake') {
    return { ok: false, stdout: '', stderr: message };
  }

  return jsonWorkerResult({ ok: false, message });
}

function jsonWorkerResult(payload: unknown): WorkerResult {
  return {
    ok: false,
    stdout: JSON.stringify(payload),
    stderr: '',
  };
}

function parseWorkerJson<T>(result: WorkerResult): T {
  if (!result.stdout.trim()) {
    throw new Error(result.stderr || 'Worker returned no JSON output.');
  }

  return JSON.parse(result.stdout) as T;
}
