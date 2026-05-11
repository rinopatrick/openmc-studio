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

export interface StatepointSummary {
  statepointPath: string;
  sizeBytes: number;
  modifiedAt: string;
  kEffective?: number | null;
  kStdDev?: number | null;
  tallies?: string[] | null;
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

export async function listRunHistory(projectDir: string): Promise<RunHistoryEntry[]> {
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

export async function listProofPacks(projectDir: string): Promise<ProofPackEntry[]> {
  const result = await invokeWorker('list_proof_packs', { request: { projectDir } });
  const parsed = parseWorkerJson<{ ok: boolean; proofPacks: ProofPackEntry[] }>(result);
  return parsed.proofPacks;
}

export async function exportSubmissionBundle(projectDir: string, repoUrl: string): Promise<{ ok: boolean; bundlePath: string }> {
  const result = await invokeWorker('export_submission_bundle', { request: { projectDir, repoUrl } });
  return parseWorkerJson<{ ok: boolean; bundlePath: string }>(result);
}

export async function generateMimoDraft(projectDir: string, repoUrl: string): Promise<{ ok: boolean; draftPath: string }> {
  const result = await invokeWorker('generate_mimo_draft', { request: { projectDir, repoUrl } });
  return parseWorkerJson<{ ok: boolean; draftPath: string }>(result);
}

async function invokeWorker(command: string, args?: Record<string, unknown>): Promise<WorkerResult> {
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

function parseWorkerJson<T>(result: WorkerResult): T {
  if (!result.stdout.trim()) {
    throw new Error(result.stderr || 'Worker returned no JSON output.');
  }

  return JSON.parse(result.stdout) as T;
}
