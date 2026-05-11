use serde::{Deserialize, Serialize};
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
            health_check_openmc
        ])
        .run(tauri::generate_context!())
        .expect("error while running OpenMC Studio");
}
