use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Serialize)]
struct WorkerResult {
    ok: bool,
    stdout: String,
    stderr: String,
}

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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LoadProjectResult {
    manifest_json: String,
    model_json: String,
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

fn find_python_command() -> &'static str {
    if cfg!(target_os = "windows") {
        "python"
    } else {
        "python3"
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
            health_check_openmc,
            save_project_bundle,
            load_project_bundle
        ])
        .run(tauri::generate_context!())
        .expect("error while running OpenMC Studio");
}
