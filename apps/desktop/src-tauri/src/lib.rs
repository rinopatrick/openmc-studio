use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};

#[derive(Debug, Serialize)]
struct WorkerResult {
    ok: bool,
    stdout: String,
    stderr: String,
}

static WORKER_PYTHON_OVERRIDE: OnceLock<Mutex<Option<String>>> = OnceLock::new();

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HealthCheckRequest {
    command: Option<Vec<String>>,
    openmc_executable: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveProjectRequest {
    directory: String,
    manifest_json: String,
    model_json: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoadProjectRequest {
    directory: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GenerateInputsRequest {
    project_dir: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectDirRequest {
    project_dir: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunOpenMcRequest {
    project_dir: String,
    command: Option<Vec<String>>,
    timeout_seconds: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResultsSummaryRequest {
    project_dir: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProofPackRequest {
    project_dir: String,
    repo_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StatepointSummaryRequest {
    project_dir: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListProofPacksRequest {
    project_dir: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SubmissionBundleRequest {
    project_dir: String,
    repo_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MimoDraftRequest {
    project_dir: String,
    repo_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LiveRunStatusRequest {
    project_dir: String,
    run_id: Option<String>,
    tail: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LoadProjectResult {
    manifest_json: String,
    model_json: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListRunsRequest {
    project_dir: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RunHistoryEntry {
    run_id: String,
    ok: Option<bool>,
    return_code: Option<i64>,
    k_effective: Option<f64>,
    k_std_dev: Option<f64>,
    started_at: Option<String>,
    ended_at: Option<String>,
    run_dir: String,
}

#[tauri::command]
fn handshake() -> String {
    "openmc-studio".to_string()
}

#[tauri::command]
fn worker_handshake() -> Result<WorkerResult, String> {
    run_worker(&["handshake"], None)
}

#[tauri::command]
fn detect_openmc_environment() -> Result<WorkerResult, String> {
    run_worker(&["detect-env"], None)
}

#[tauri::command]
fn set_worker_python(python_path: Option<String>) -> Result<String, String> {
    let storage = WORKER_PYTHON_OVERRIDE.get_or_init(|| Mutex::new(None));
    let mut guard = storage.lock().map_err(|_| "Failed to lock worker python override".to_string())?;
    *guard = python_path.and_then(|value| {
        let trimmed = value.trim().to_string();
        if trimmed.is_empty() { None } else { Some(trimmed) }
    });
    Ok(guard.clone().unwrap_or_else(|| "python3/python (default)".to_string()))
}

#[tauri::command]
fn get_worker_python() -> Result<Option<String>, String> {
    let storage = WORKER_PYTHON_OVERRIDE.get_or_init(|| Mutex::new(None));
    let guard = storage.lock().map_err(|_| "Failed to lock worker python override".to_string())?;
    Ok(guard.clone())
}

#[tauri::command]
fn health_check_openmc(request: HealthCheckRequest) -> Result<WorkerResult, String> {
    let payload = serde_json::to_string(&serde_json::json!({
        "command": request.command,
        "openmcExecutable": request.openmc_executable,
    }))
    .map_err(|error| error.to_string())?;

    run_worker(&["health-check", "--json"], Some(payload))
}

#[tauri::command]
fn save_project_bundle(request: SaveProjectRequest) -> Result<(), String> {
    let root = PathBuf::from(request.directory);
    let model_dir = root.join("model");
    fs::create_dir_all(&model_dir).map_err(|error| error.to_string())?;
    fs::create_dir_all(root.join("generated")).map_err(|error| error.to_string())?;
    fs::create_dir_all(root.join("runs")).map_err(|error| error.to_string())?;
    fs::create_dir_all(root.join("reports")).map_err(|error| error.to_string())?;

    fs::write(root.join("project.json"), request.manifest_json).map_err(|error| error.to_string())?;
    fs::write(model_dir.join("model.json"), request.model_json).map_err(|error| error.to_string())?;

    Ok(())
}

#[tauri::command]
fn load_project_bundle(request: LoadProjectRequest) -> Result<LoadProjectResult, String> {
    let root = PathBuf::from(request.directory);
    let manifest_json = fs::read_to_string(root.join("project.json")).map_err(|error| error.to_string())?;
    let model_json = fs::read_to_string(root.join("model/model.json")).map_err(|error| error.to_string())?;

    Ok(LoadProjectResult {
        manifest_json,
        model_json,
    })
}

#[tauri::command]
fn generate_openmc_inputs(request: GenerateInputsRequest) -> Result<WorkerResult, String> {
    run_worker(&["generate-inputs", "--project-dir"], Some(request.project_dir))
}

#[tauri::command]
fn run_openmc(request: RunOpenMcRequest) -> Result<WorkerResult, String> {
    let payload = serde_json::to_string(&serde_json::json!({
        "command": request.command,
        "timeoutSeconds": request.timeout_seconds.unwrap_or(3600),
    }))
    .map_err(|error| error.to_string())?;

    run_worker(
        &["run-openmc", "--project-dir", request.project_dir.as_str(), "--json"],
        Some(payload),
    )
}

#[tauri::command]
fn summarize_results(request: ResultsSummaryRequest) -> Result<WorkerResult, String> {
    run_worker(&["summarize-results", "--project-dir"], Some(request.project_dir))
}

#[tauri::command]
fn export_proof_pack(request: ProofPackRequest) -> Result<WorkerResult, String> {
    let repo_url = request.repo_url.unwrap_or_default();
    run_worker(
        &["export-proof-pack", "--project-dir", request.project_dir.as_str(), "--repo-url"],
        Some(repo_url),
    )
}

#[tauri::command]
fn summarize_statepoint(request: StatepointSummaryRequest) -> Result<WorkerResult, String> {
    run_worker(&["summarize-statepoint", "--project-dir"], Some(request.project_dir))
}

#[tauri::command]
fn list_proof_packs(request: ListProofPacksRequest) -> Result<WorkerResult, String> {
    run_worker(&["list-proof-packs", "--project-dir"], Some(request.project_dir))
}

#[tauri::command]
fn export_submission_bundle(request: SubmissionBundleRequest) -> Result<WorkerResult, String> {
    let repo_url = request.repo_url.unwrap_or_default();
    run_worker(
        &["export-submission-bundle", "--project-dir", request.project_dir.as_str(), "--repo-url"],
        Some(repo_url),
    )
}

#[tauri::command]
fn generate_mimo_draft(request: MimoDraftRequest) -> Result<WorkerResult, String> {
    let repo_url = request.repo_url.unwrap_or_default();
    run_worker(
        &["generate-mimo-draft", "--project-dir", request.project_dir.as_str(), "--repo-url"],
        Some(repo_url),
    )
}

#[tauri::command]
fn generate_notebook(request: ProjectDirRequest) -> Result<WorkerResult, String> {
    run_worker(&["generate-notebook", "--project-dir"], Some(request.project_dir))
}

#[tauri::command]
fn live_run_status(request: LiveRunStatusRequest) -> Result<WorkerResult, String> {
    let run_id = request.run_id.unwrap_or_default();
    let tail = request.tail.unwrap_or(3000).to_string();
    run_worker(
        &[
            "live-run-status",
            "--project-dir",
            request.project_dir.as_str(),
            "--run-id",
            run_id.as_str(),
            "--tail",
        ],
        Some(tail),
    )
}

#[tauri::command]
fn list_run_history(request: ListRunsRequest) -> Result<Vec<RunHistoryEntry>, String> {
    let runs_dir = PathBuf::from(request.project_dir).join("runs");
    if !runs_dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut entries: Vec<RunHistoryEntry> = Vec::new();

    for entry_result in fs::read_dir(&runs_dir).map_err(|error| error.to_string())? {
        let entry = entry_result.map_err(|error| error.to_string())?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let manifest_path = path.join("manifest.json");
        if !manifest_path.is_file() {
            continue;
        }

        let text = fs::read_to_string(&manifest_path).map_err(|error| error.to_string())?;
        let value: serde_json::Value = serde_json::from_str(&text).map_err(|error| error.to_string())?;

        entries.push(RunHistoryEntry {
            run_id: value
                .get("runId")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("unknown")
                .to_string(),
            ok: value.get("ok").and_then(serde_json::Value::as_bool),
            return_code: value.get("returnCode").and_then(serde_json::Value::as_i64),
            k_effective: value.get("kEffective").and_then(serde_json::Value::as_f64),
            k_std_dev: value.get("kStdDev").and_then(serde_json::Value::as_f64),
            started_at: value.get("startedAt").and_then(serde_json::Value::as_str).map(ToString::to_string),
            ended_at: value.get("endedAt").and_then(serde_json::Value::as_str).map(ToString::to_string),
            run_dir: path.to_string_lossy().to_string(),
        });
    }

    entries.sort_by(|left, right| right.run_id.cmp(&left.run_id));
    Ok(entries)
}

fn run_worker(args: &[&str], trailing_arg: Option<String>) -> Result<WorkerResult, String> {
    let worker_dir = find_worker_dir()?;
    let python = find_python_command();
    let mut command = Command::new(python);
    command.current_dir(worker_dir).arg("-m").arg("openmc_worker");

    for arg in args {
        command.arg(arg);
    }

    if let Some(value) = trailing_arg {
        command.arg(value);
    }

    let output = command.output().map_err(|error| error.to_string())?;

    Ok(WorkerResult {
        ok: output.status.success(),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    })
}

fn find_python_command() -> String {
    if let Some(storage) = WORKER_PYTHON_OVERRIDE.get() {
        if let Ok(guard) = storage.lock() {
            if let Some(path) = guard.clone() {
                return path;
            }
        }
    }

    if let Ok(path) = std::env::var("OPENMC_WORKER_PYTHON") {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }

    if cfg!(target_os = "windows") {
        "python".to_string()
    } else {
        "python3".to_string()
    }
}

fn find_worker_dir() -> Result<PathBuf, String> {
    let current_dir = std::env::current_dir().map_err(|error| error.to_string())?;
    let candidates = [
        current_dir.join("services/openmc-worker"),
        current_dir.join("../services/openmc-worker"),
        current_dir.join("../../services/openmc-worker"),
        current_dir.join("../../../services/openmc-worker"),
    ];

    candidates
        .into_iter()
        .find(|candidate| is_worker_dir(candidate))
        .ok_or_else(|| "Unable to locate services/openmc-worker from the current app directory.".to_string())
}

fn is_worker_dir(path: &Path) -> bool {
    path.join("openmc_worker").join("cli.py").is_file()
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            handshake,
            worker_handshake,
            detect_openmc_environment,
            set_worker_python,
            get_worker_python,
            health_check_openmc,
            save_project_bundle,
            load_project_bundle,
            generate_openmc_inputs,
            run_openmc,
            list_run_history,
            summarize_results,
            export_proof_pack,
            summarize_statepoint,
            list_proof_packs,
            export_submission_bundle,
            generate_mimo_draft,
            generate_notebook,
            live_run_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running OpenMC Studio");
}
