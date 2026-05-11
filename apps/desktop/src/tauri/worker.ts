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
  startedAt?: string;
  endedAt?: string;
  runDir: string;
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
