from __future__ import annotations

import argparse
import copy
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import zipfile
from datetime import datetime, timezone
from dataclasses import asdict, dataclass
from typing import Any

from . import __version__


@dataclass(frozen=True)
class Candidate:
    kind: str
    command: list[str]
    label: str


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="openmc-worker")
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("handshake")
    subparsers.add_parser("detect-env")

    health = subparsers.add_parser("health-check")
    health.add_argument("--json", default="{}")

    generate = subparsers.add_parser("generate-inputs")
    generate.add_argument("--project-dir", required=True)

    run = subparsers.add_parser("run-openmc")
    run.add_argument("--project-dir", required=True)
    run.add_argument("--json", default="{}")

    live = subparsers.add_parser("live-run-status")
    live.add_argument("--project-dir", required=True)
    live.add_argument("--run-id", default="")
    live.add_argument("--tail", type=int, default=3000)

    preview = subparsers.add_parser("render-openmc-plot")
    preview.add_argument("--project-dir", required=True)
    preview.add_argument("--json", default="{}")

    summarize = subparsers.add_parser("summarize-results")
    summarize.add_argument("--project-dir", required=True)

    statepoint = subparsers.add_parser("summarize-statepoint")
    statepoint.add_argument("--project-dir", required=True)

    convergence = subparsers.add_parser("get-keff-convergence")
    convergence.add_argument("--project-dir", required=True)

    depletion = subparsers.add_parser("get-depletion-results")
    depletion.add_argument("--project-dir", required=True)

    validate = subparsers.add_parser("validate-geometry")
    validate.add_argument("--project-dir", required=True)

    sweep = subparsers.add_parser("run-sweep")
    sweep.add_argument("--project-dir", required=True)
    sweep.add_argument("--json", default="{}")

    proof = subparsers.add_parser("export-proof-pack")
    proof.add_argument("--project-dir", required=True)
    proof.add_argument("--repo-url", default="")

    proof_list = subparsers.add_parser("list-proof-packs")
    proof_list.add_argument("--project-dir", required=True)

    bundle = subparsers.add_parser("export-submission-bundle")
    bundle.add_argument("--project-dir", required=True)
    bundle.add_argument("--repo-url", default="")

    mimo = subparsers.add_parser("generate-mimo-draft")
    mimo.add_argument("--project-dir", required=True)
    mimo.add_argument("--repo-url", default="")

    stochastic_volume = subparsers.add_parser("run-stochastic-volume")
    stochastic_volume.add_argument("--project-dir", required=True)
    stochastic_volume.add_argument("--cell-ids", default="[]")
    stochastic_volume.add_argument("--samples", type=int, default=1_000_000)

    notebook = subparsers.add_parser("generate-notebook")
    notebook.add_argument("--project-dir", required=True)
    stochastic_volume.add_argument("--samples", type=int, default=1_000_000)

    args = parser.parse_args(argv)

    if args.command == "handshake":
        return emit({"ok": True, "workerVersion": __version__, "python": sys.version.split()[0]})

    if args.command == "detect-env":
        return emit(detect_environment())

    if args.command == "health-check":
        payload = json.loads(args.json)
        return emit(health_check(payload))

    if args.command == "generate-inputs":
        return emit(generate_inputs(Path(args.project_dir)))

    if args.command == "run-openmc":
        payload = json.loads(args.json)
        return emit(run_openmc(Path(args.project_dir), payload))

    if args.command == "live-run-status":
        return emit(live_run_status(Path(args.project_dir), args.run_id, args.tail))

    if args.command == "render-openmc-plot":
        payload = json.loads(args.json)
        return emit(render_openmc_plot(Path(args.project_dir), payload))

    if args.command == "summarize-results":
        return emit(summarize_results(Path(args.project_dir)))

    if args.command == "summarize-statepoint":
        return emit(summarize_statepoint(Path(args.project_dir)))

    if args.command == "get-keff-convergence":
        return emit(get_keff_convergence(Path(args.project_dir)))

    if args.command == "get-depletion-results":
        return emit(get_depletion_results(Path(args.project_dir)))

    if args.command == "validate-geometry":
        return emit(validate_geometry_advanced(Path(args.project_dir)))

    if args.command == "run-sweep":
        payload = json.loads(args.json)
        return emit(run_parameter_sweep(Path(args.project_dir), payload))

    if args.command == "export-proof-pack":
        return emit(export_proof_pack(Path(args.project_dir), args.repo_url))

    if args.command == "list-proof-packs":
        return emit(list_proof_packs(Path(args.project_dir)))

    if args.command == "export-submission-bundle":
        return emit(export_submission_bundle(Path(args.project_dir), args.repo_url))

    if args.command == "generate-mimo-draft":
        return emit(generate_mimo_draft(Path(args.project_dir), args.repo_url))

    if args.command == "run-stochastic-volume":
        raw_cell_ids = json.loads(args.cell_ids)
        if not isinstance(raw_cell_ids, list):
            return emit({"ok": False, "message": "--cell-ids must be a JSON array"})
        cell_ids = [int(value) for value in raw_cell_ids]
        return emit(run_stochastic_volume(Path(args.project_dir), cell_ids, int(args.samples)))

    if args.command == "generate-notebook":
        return emit(generate_notebook(Path(args.project_dir)))

    return 2


def _json_safe(value: Any) -> Any:
    if hasattr(value, "item"):
        try:
            return value.item()
        except Exception:
            return str(value)
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    return value


def detect_environment() -> dict[str, Any]:
    candidates = detect_candidates()
    return {
        "ok": True,
        "candidates": [asdict(candidate) for candidate in candidates],
        "crossSections": os.environ.get("OPENMC_CROSS_SECTIONS"),
    }


def detect_candidates() -> list[Candidate]:
    candidates: list[Candidate] = []
    openmc_path = shutil.which("openmc")
    if openmc_path:
        candidates.append(Candidate(kind="path", command=[openmc_path], label=f"OpenMC executable at {openmc_path}"))

    python_path = shutil.which("python") or sys.executable
    if python_path:
        candidates.append(Candidate(kind="python-module", command=[python_path, "-m", "openmc"], label="OpenMC Python module"))

    conda_path = shutil.which("conda")
    if conda_path:
        candidates.append(Candidate(kind="conda", command=[conda_path, "run", "openmc"], label="Conda OpenMC candidate"))
        candidates.append(Candidate(kind="conda-env", command=[conda_path, "run", "-n", "openmc", "openmc"], label="Conda environment: openmc"))

    candidates.extend(detect_wsl_candidates())

    return candidates


def detect_wsl_candidates() -> list[Candidate]:
    if is_running_inside_wsl():
        return []

    wsl = shutil.which("wsl.exe")
    if not wsl:
        return []

    try:
        distros = subprocess.run(
            [wsl, "-l", "-q"],
            check=False,
            capture_output=True,
            text=True,
            timeout=8,
        )
    except (OSError, subprocess.TimeoutExpired):
        return []

    candidates: list[Candidate] = []
    for raw in distros.stdout.splitlines():
        distro = raw.replace("\x00", "").strip()
        if not distro:
            continue

        try:
            probe = subprocess.run(
                [wsl, "-d", distro, "--", "bash", "-lc", "command -v openmc"],
                check=False,
                capture_output=True,
                text=True,
                timeout=8,
            )
        except (OSError, subprocess.TimeoutExpired):
            continue
        if probe.returncode == 0:
            candidates.append(
                Candidate(
                    kind="wsl",
                    command=[wsl, "-d", distro, "--", "bash", "-lc", "openmc"],
                    label=f"WSL OpenMC candidate ({distro})",
                )
            )

    return candidates


def is_running_inside_wsl() -> bool:
    try:
        return "microsoft" in Path("/proc/sys/kernel/osrelease").read_text(encoding="utf-8").lower()
    except OSError:
        return False


def health_check(payload: dict[str, Any]) -> dict[str, Any]:
    command = payload.get("command")
    executable = payload.get("openmcExecutable")
    if command and isinstance(command, list):
        base_command = [str(part) for part in command]
    elif executable:
        base_command = [str(executable)]
    else:
        candidates = detect_candidates()
        base_command = candidates[0].command if candidates else []

    checks: list[dict[str, Any]] = []
    if not base_command:
        return {
            "ok": False,
            "checks": [{"id": "openmc-command", "ok": False, "message": "OpenMC executable was not found."}],
        }

    checks.append({"id": "openmc-command", "ok": True, "message": "OpenMC command candidate found.", "command": base_command})
    checks.append({
        "id": "cross-sections",
        "ok": bool(os.environ.get("OPENMC_CROSS_SECTIONS")),
        "message": "OPENMC_CROSS_SECTIONS is configured." if os.environ.get("OPENMC_CROSS_SECTIONS") else "OPENMC_CROSS_SECTIONS is not configured.",
    })

    version = run_version_probe(base_command)
    checks.append(version)

    return {"ok": all(check["ok"] for check in checks if check["id"] != "cross-sections"), "checks": checks}


def run_version_probe(base_command: list[str]) -> dict[str, Any]:
    try:
        result = subprocess.run(
            [*base_command, "--version"],
            check=False,
            capture_output=True,
            text=True,
            timeout=10,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {"id": "openmc-version", "ok": False, "message": str(exc)}

    output = (result.stdout or result.stderr).strip()
    return {
        "id": "openmc-version",
        "ok": result.returncode == 0,
        "message": output or f"Version probe exited with code {result.returncode}.",
    }


def generate_inputs(project_dir: Path) -> dict[str, Any]:
    model_path = project_dir / "model" / "model.json"
    if not model_path.is_file():
        return {"ok": False, "message": f"Model file not found: {model_path}"}

    model = json.loads(model_path.read_text(encoding="utf-8"))
    generated_dir = project_dir / "generated"
    generated_dir.mkdir(parents=True, exist_ok=True)

    artifacts = {
        "materials.xml": generate_materials_xml(model),
        "geometry.xml": generate_geometry_xml(model),
        "settings.xml": generate_settings_xml(model),
        "tallies.xml": generate_tallies_xml(model),
        "plots.xml": generate_plots_xml(model),
    }

    for filename, content in artifacts.items():
        (generated_dir / filename).write_text(content, encoding="utf-8")

    return {"ok": True, "generatedDir": str(generated_dir), "files": sorted(artifacts.keys())}


def run_openmc(project_dir: Path, payload: dict[str, Any]) -> dict[str, Any]:
    generated_dir = project_dir / "generated"
    if not generated_dir.is_dir():
        generation = generate_inputs(project_dir)
        if not generation.get("ok"):
            return generation

    command = payload.get("command")
    if command and isinstance(command, list):
        base_command = [str(part) for part in command]
    else:
        candidates = detect_candidates()
        base_command = candidates[0].command if candidates else []

    if not base_command:
        return {"ok": False, "message": "OpenMC command was not found. Run environment detection or set a manual command."}

    run_id = datetime.now(timezone.utc).strftime("run-%Y%m%dT%H%M%SZ")
    run_dir = project_dir / "runs" / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    started_at = datetime.now(timezone.utc).isoformat()

    # Write initial run-status for live polling
    run_status = {
        "runId": run_id,
        "runDir": str(run_dir),
        "startedAt": started_at,
        "endedAt": None,
        "ok": None,
        "returnCode": None,
        "pid": None,
        "status": "running",
    }
    (run_dir / "run-status.json").write_text(json.dumps(run_status, indent=2), encoding="utf-8")

    stdout_path = run_dir / "stdout.log"
    stderr_path = run_dir / "stderr.log"

    try:
        with open(stdout_path, "w", encoding="utf-8") as stdout_f, open(stderr_path, "w", encoding="utf-8") as stderr_f:
            process = subprocess.Popen(
                base_command,
                cwd=generated_dir,
                stdout=stdout_f,
                stderr=stderr_f,
            )
        run_status["pid"] = process.pid
        (run_dir / "run-status.json").write_text(json.dumps(run_status, indent=2), encoding="utf-8")

        # Poll until done with timeout
        timeout_secs = int(payload.get("timeoutSeconds", 3600))
        try:
            return_code = process.wait(timeout=timeout_secs)
        except subprocess.TimeoutExpired:
            process.kill()
            return_code = -9
            stderr = "Process killed: timeout exceeded.\n"
            with open(stderr_path, "a", encoding="utf-8") as f:
                f.write(stderr)
        else:
            return_code = return_code

        ok = return_code == 0
    except OSError as exc:
        return_code = -1
        ok = False
        with open(stderr_path, "w", encoding="utf-8") as f:
            f.write(str(exc))

    # Parse stdout for batch progress
    stdout_content = stdout_path.read_text(encoding="utf-8")
    stderr_content = stderr_path.read_text(encoding="utf-8")
    batch_progress = _parse_batch_progress(stdout_content)
    k_from_log = _parse_k_from_log(stdout_content)

    ended_at = datetime.now(timezone.utc).isoformat()
    run_status["endedAt"] = ended_at
    run_status["ok"] = ok
    run_status["returnCode"] = return_code
    run_status["status"] = "completed" if ok else "failed"
    run_status["batchProgress"] = batch_progress
    run_status["kFromLog"] = k_from_log
    (run_dir / "run-status.json").write_text(json.dumps(run_status, indent=2), encoding="utf-8")

    # Parse errors/warnings from output
    error_analysis = parse_openmc_errors(stdout_content, stderr_content)

    # Also read keff from statepoint if available
    statepoint_info = summarize_statepoint(project_dir).get("summary")
    k_effective = statepoint_info.get("kEffective") if isinstance(statepoint_info, dict) else None
    k_std_dev = statepoint_info.get("kStdDev") if isinstance(statepoint_info, dict) else None

    manifest = {
        "runId": run_id,
        "ok": ok,
        "command": base_command,
        "projectDir": str(project_dir),
        "workingDir": str(generated_dir),
        "returnCode": return_code,
        "startedAt": started_at,
        "endedAt": ended_at,
        "kEffective": k_effective,
        "kStdDev": k_std_dev,
        "stdoutLog": str(stdout_path),
        "stderrLog": str(stderr_path),
        "errorAnalysis": error_analysis,
    }
    (run_dir / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8")

    return {
        "ok": ok,
        "runId": run_id,
        "runDir": str(run_dir),
        "returnCode": return_code,
        "stdoutTail": tail(stdout_content),
        "stderrTail": tail(stderr_content),
        "manifest": manifest,
        "batchProgress": batch_progress,
        "kFromLog": k_from_log,
        "errorAnalysis": error_analysis,
    }


def _parse_batch_progress(stdout: str) -> dict[str, Any] | None:
    """Parse OpenMC stdout for batch progress (e.g., 'Batch 90/100')."""
    import re
    matches = list(re.finditer(r"Batch\s+(\d+)/(\d+)", stdout))
    if not matches:
        return None
    last = matches[-1]
    return {"current": int(last.group(1)), "total": int(last.group(2)), "percent": round(int(last.group(1)) / int(last.group(2)) * 100, 1)}


def _parse_k_from_log(stdout: str) -> dict[str, Any] | None:
    """Parse OpenMC stdout for running k-eff estimate."""
    import re
    pattern = r"combined:\s+([\d.e+-]+)\s+[\+/\-]+\s+([\d.e+-]+)"
    matches = list(re.finditer(pattern, stdout))
    if not matches:
        return None
    last = matches[-1]
    return {"kCombined": float(last.group(1)), "kStdDev": float(last.group(2))}


def parse_openmc_errors(stdout: str, stderr: str) -> dict[str, Any]:
    """Parse OpenMC stdout/stderr for common error patterns."""
    import re
    combined = stdout + "\n" + stderr
    result: dict[str, Any] = {
        "errors": [],
        "warnings": [],
        "hasFatal": False,
        "summary": None,
    }

    # Fatal errors
    error_patterns = [
        (r"ERROR:\s+(.*?)(?:\n|$)", "fatal_error", True),
        (r"Particle lost with (id=\d+|tally=.*?)(?:.*\n)*?at position\s+\((.*?)\)", "lost_particle", False),
        (r"Overlapping cells detected", "overlap_cells", False),
        (r"RuntimeError:\s+(.*?)(?:\n|$)", "runtime_error", True),
        (r"FileNotFoundError:\s+(.*?)(?:\n|$)", "file_not_found", True),
        (r"Surface\s+(\d+)\s+not found", "missing_surface", False),
        (r"Unable to find material\s+(\d+)", "missing_material", False),
        (r"Particle left geometry\. No boundary surfaces found", "lost_particle", False),
    ]

    for pattern, error_type, is_fatal in error_patterns:
        for match in re.finditer(pattern, combined, re.DOTALL):
            entry = {
                "type": error_type,
                "message": match.group(1) if match.lastindex else match.group(0).strip(),
                "fatal": is_fatal,
            }
            result["errors"].append(entry)
            if is_fatal:
                result["hasFatal"] = True

    # Warnings
    warning_patterns = [
        r"WARNING:\s+(.*?)(?:\n|$)",
        r"Runtime warning:\s+(.*?)(?:\n|$)",
    ]
    for pattern in warning_patterns:
        for match in re.finditer(pattern, combined, re.DOTALL):
            result["warnings"].append(match.group(1).strip())

    if result["hasFatal"]:
        result["summary"] = f"{len(result['errors'])} error(s), {len(result['warnings'])} warning(s)"
    elif result["warnings"]:
        result["summary"] = f"{len(result['warnings'])} warning(s)"
    else:
        result["summary"] = "No issues detected"

    return result


def render_openmc_plot(project_dir: Path, payload: dict[str, Any]) -> dict[str, Any]:
    generated_dir = project_dir / "generated"
    if not generated_dir.is_dir() or not (generated_dir / "plots.xml").is_file():
        generation = generate_inputs(project_dir)
        if not generation.get("ok"):
            return generation

    command = payload.get("command")
    if command and isinstance(command, list):
        base_command = [str(part) for part in command]
    else:
        candidates = detect_candidates()
        base_command = candidates[0].command if candidates else []

    if not base_command:
        return {"ok": False, "message": "OpenMC command was not found. If you normally run `conda activate openmc`, use `conda run -n openmc openmc`."}

    try:
        result = subprocess.run(
            [*base_command, "--plot"],
            cwd=generated_dir,
            check=False,
            capture_output=True,
            text=True,
            timeout=int(payload.get("timeoutSeconds", 120)),
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {"ok": False, "message": str(exc), "stdoutTail": "", "stderrTail": str(exc)}

    images = sorted([path for path in generated_dir.glob("*.png") if path.is_file()], key=lambda path: path.stat().st_mtime, reverse=True)
    return {
        "ok": result.returncode == 0 and bool(images),
        "returnCode": result.returncode,
        "imagePath": str(images[0]) if images else None,
        "generatedDir": str(generated_dir),
        "stdoutTail": tail(result.stdout),
        "stderrTail": tail(result.stderr),
        "message": None if images else "OpenMC plot did not produce a PNG image.",
    }


def live_run_status(project_dir: Path, run_id: str, tail_size: int) -> dict[str, Any]:
    runs_dir = project_dir / "runs"
    if not runs_dir.is_dir():
        return {"ok": False, "message": "No runs directory found."}

    run_dir = resolve_run_dir(runs_dir, run_id)
    if run_dir is None:
        return {"ok": False, "message": "No run found."}

    manifest_path = run_dir / "manifest.json"
    status_path = run_dir / "run-status.json"
    stdout_path = run_dir / "stdout.log"
    stderr_path = run_dir / "stderr.log"

    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.is_file() else {}
    run_status = json.loads(status_path.read_text(encoding="utf-8")) if status_path.is_file() else {}
    stdout = stdout_path.read_text(encoding="utf-8", errors="replace") if stdout_path.is_file() else ""
    stderr = stderr_path.read_text(encoding="utf-8", errors="replace") if stderr_path.is_file() else ""

    # Prefer live run-status over manifest during execution
    status = run_status.get("status") or ("completed" if manifest else "running")
    if manifest and not manifest.get("ok", False):
        status = "failed"

    # Live batch progress from run-status or parse from stdout
    batch_progress = run_status.get("batchProgress")
    if not batch_progress:
        batch_progress = _parse_batch_progress(stdout)

    # Live k-eff from log
    k_from_log = run_status.get("kFromLog")
    if not k_from_log:
        k_from_log = _parse_k_from_log(stdout)

    return {
        "ok": True,
        "runId": manifest.get("runId") or run_status.get("runId") or run_dir.name,
        "status": status,
        "returnCode": manifest.get("returnCode") or run_status.get("returnCode"),
        "startedAt": manifest.get("startedAt") or run_status.get("startedAt"),
        "endedAt": manifest.get("endedAt") or run_status.get("endedAt"),
        "stdoutTail": tail(stdout, max(500, tail_size)),
        "stderrTail": tail(stderr, max(500, tail_size)),
        "runDir": str(run_dir),
        "batchProgress": batch_progress,
        "kFromLog": k_from_log,
    }


def resolve_run_dir(runs_dir: Path, run_id: str) -> Path | None:
    if run_id:
        candidate = runs_dir / run_id
        if candidate.is_dir():
            return candidate
        return None

    run_candidates = [item for item in runs_dir.iterdir() if item.is_dir()]
    if not run_candidates:
        return None
    return sorted(run_candidates, key=lambda path: path.name, reverse=True)[0]


def generate_materials_xml(model: dict[str, Any]) -> str:
    chunks = []
    for index, material in enumerate(model.get("materials", {}).get("materials", []), start=1):
        chunks.append(f'  <material id="{index}" name="{xml_escape(material.get("name", "Material"))}">')
        density = material.get("density", {})
        chunks.append(f'    <density value="{density.get("value", 1)}" units="{xml_escape(density.get("unit", "g/cm3"))}" />')
        for nuclide in material.get("nuclides", []):
            attr = "ao" if nuclide.get("fractionType") == "atom" else "wo"
            chunks.append(f'    <nuclide name="{xml_escape(nuclide.get("name", ""))}" {attr}="{nuclide.get("fraction", 0)}" />')
        chunks.append("  </material>")
    return xml_doc("materials", "\n".join(chunks))


def generate_geometry_xml(model: dict[str, Any]) -> str:
    components = model.get("components") or {}
    pin_cell_types = components.get("pinCellTypes") or []
    assembly_types = components.get("assemblyTypes") or []
    core_layout = components.get("coreLayout")
    if pin_cell_types or core_layout:
        return generate_component_geometry_xml(model)

    openmc_geometry = model.get("openmcGeometry") or {}
    surfaces = openmc_geometry.get("surfaces") or []
    cells = openmc_geometry.get("cells") or []
    if surfaces and cells:
        chunks: list[str] = []
        for surface in surfaces:
            boundary = surface.get("boundary")
            boundary_attr = f' boundary="{xml_escape(boundary)}"' if boundary and boundary != "transmission" else ""
            coeffs = " ".join(str(value) for value in surface.get("coeffs", []))
            chunks.append(
                f'  <surface id="{int(surface.get("openmcId", 0))}" name="{xml_escape(surface.get("name", "Surface"))}" type="{xml_escape(surface.get("type", "sphere"))}" coeffs="{xml_escape(coeffs)}"{boundary_attr} />'
            )

        for cell in cells:
            fill = cell.get("fillUniverse")
            if fill:
                fill_attrs = f' fill="{int(fill)}"'
            else:
                material_id = cell.get("materialOpenMcId") or material_openmc_id(model, str(cell.get("materialId", "")))
                material = str(material_id) if material_id else "void"
                fill_attrs = f' material="{material}"'
            chunks.append(
                f'  <cell id="{int(cell.get("openmcId", 0))}" name="{xml_escape(cell.get("name", "Cell"))}" universe="{int(cell.get("universe", 0))}"{fill_attrs} region="{xml_escape(cell.get("region", ""))}" />'
            )

        return xml_doc("geometry", "\n".join(chunks))

    names: list[str] = []

    def visit(node: dict[str, Any]) -> None:
        names.append(str(node.get("name", "Node")))
        for child in node.get("children", []):
            visit(child)

    visit(model.get("root", {"name": "Root", "children": []}))
    cells = "\n".join(f'  <cell id="{index}" name="{xml_escape(name)}" />' for index, name in enumerate(names, start=1))
    return xml_doc("geometry", "  <!-- Preview geometry generated from OpenMC Studio hierarchy. -->\n" + cells)


def material_openmc_id(model: dict[str, Any], material_id: str) -> int:
    materials = model.get("materials", {}).get("materials", [])
    for index, material in enumerate(materials, start=1):
        if material.get("id") == material_id:
            return index
    return 0


def generate_component_geometry_xml(model: dict[str, Any]) -> str:
    components = model.get("components") or {}
    lines: list[str] = []
    next_surface_id = 1
    next_cell_id = 1
    next_universe_id = 1
    next_lattice_id = 1
    pin_universe_ids: dict[str, int] = {}
    assembly_universe_ids: dict[str, int] = {}

    pin_cell_types = components.get("pinCellTypes") or []
    assembly_types = components.get("assemblyTypes") or []
    core_layout = components.get("coreLayout")

    for pin_type in pin_cell_types:
        universe_id = next_universe_id
        next_universe_id += 1
        pin_universe_ids[pin_type["id"]] = universe_id

        pitch = float(pin_type.get("pitch", 1.26))
        moderator_outer_radius = pitch * 0.7
        outer_surface_id = next_surface_id
        next_surface_id += 1
        lines.append(f'  <surface id="{outer_surface_id}" name="{xml_escape(pin_type.get("name", "Pin"))} outer boundary" type="z-cylinder" coeffs="0 0 {moderator_outer_radius}" boundary="reflective" />')

        surface_ids: list[int] = []
        for ring in pin_type.get("rings", []):
            surface_id = next_surface_id
            next_surface_id += 1
            surface_ids.append(surface_id)
            lines.append(f'  <surface id="{surface_id}" name="{xml_escape(pin_type.get("name", "Pin"))} {xml_escape(ring.get("name", "ring"))} outer" type="z-cylinder" coeffs="0 0 {ring.get("outerRadius", 0.5)}" />')

        for i, ring in enumerate(pin_type.get("rings", [])):
            cell_id = next_cell_id
            next_cell_id += 1
            mat_id = material_openmc_id(model, ring.get("materialId", ""))
            temp = ring.get("temperature")
            temp_attr = f' temperature="{temp}"' if temp else ""
            if i == 0:
                region = f"-{surface_ids[0]}"
            else:
                region = f"+{surface_ids[i - 1]} -{surface_ids[i]}"
            lines.append(f'  <cell id="{cell_id}" name="{xml_escape(pin_type.get("name", "Pin"))} {xml_escape(ring.get("name", "ring"))}" universe="{universe_id}" material="{mat_id}"{temp_attr} region="{region}" />')

        moderator_mat_id_str = pin_type.get("moderatorMaterialId")
        if moderator_mat_id_str:
            moderator_cell_id = next_cell_id
            next_cell_id += 1
            moderator_mat_id = material_openmc_id(model, moderator_mat_id_str)
            last_ring_surface_id = surface_ids[-1] if surface_ids else outer_surface_id
            lines.append(f'  <cell id="{moderator_cell_id}" name="{xml_escape(pin_type.get("name", "Pin"))} moderator" universe="{universe_id}" material="{moderator_mat_id}" region="+{last_ring_surface_id} -{outer_surface_id}" />')

    for assembly_type in assembly_types:
        universe_id = next_universe_id
        next_universe_id += 1
        assembly_universe_ids[assembly_type["id"]] = universe_id
        lattice_id = next_lattice_id
        next_lattice_id += 1
        rows = int(assembly_type.get("rows", 3))
        columns = int(assembly_type.get("columns", 3))
        pitch = float(assembly_type.get("pitch", 1.26))
        half_width = (columns * pitch) / 2
        half_height = (rows * pitch) / 2

        outer_universe_id = next_universe_id
        next_universe_id += 1
        outer_cell_id = next_cell_id
        next_cell_id += 1
        outer_mat_id = material_openmc_id(model, assembly_type.get("outerMaterialId", ""))
        lines.append(f'  <cell id="{outer_cell_id}" name="{xml_escape(assembly_type.get("name", "Assembly"))} outer" universe="{outer_universe_id}" material="{outer_mat_id}" />')

        pin_map = assembly_type.get("pinMap") or []
        hex_rings = assembly_type.get("hexRings")
        if assembly_type.get("latticeKind") == "hex":
            n_rings = max(rows, columns)
            lines.append(f'  <hex_lattice id="{lattice_id}" name="{xml_escape(assembly_type.get("name", "Assembly"))}" n_rings="{n_rings}" outer="{outer_universe_id}">')
            lines.append(f"    <center>0 0</center>")
            lines.append(f"    <pitch>{pitch}</pitch>")
            lines.append(f"    <universes>")
            # Use hexRings if available (already in OpenMC's outermost-first format)
            if hex_rings:
                for ring in hex_rings:
                    ids = [str(pin_universe_ids.get(pin_id, 0)) for pin_id in ring]
                    lines.append(f"      {' '.join(ids)}")
            else:
                # Fallback: convert pinMap (diamond shape) to ring format
                for row in pin_map:
                    ids = [str(pin_universe_ids.get(pin_id, 0)) for pin_id in row]
                    lines.append(f"      {' '.join(ids)}")
            lines.append(f"    </universes>")
            lines.append(f"  </hex_lattice>")
        else:
            lines.append(f'  <lattice id="{lattice_id}" name="{xml_escape(assembly_type.get("name", "Assembly"))}" dimension="{columns} {rows}" outer="{outer_universe_id}">')
            lines.append(f"    <lower_left>-{half_width} -{half_height}</lower_left>")
            lines.append(f"    <pitch>{pitch} {pitch}</pitch>")
            lines.append(f"    <universes>")
            for row in pin_map:
                ids = [str(pin_universe_ids.get(pin_id, 0)) for pin_id in row]
                lines.append(f"      {' '.join(ids)}")
            lines.append(f"    </universes>")
            lines.append(f"  </lattice>")

        fill_cell_id = next_cell_id
        next_cell_id += 1
        lines.append(f'  <cell id="{fill_cell_id}" name="{xml_escape(assembly_type.get("name", "Assembly"))} fill" universe="{universe_id}" fill="{lattice_id}" />')

    if core_layout:
        core_universe_id = 0
        core_lattice_id = next_lattice_id
        next_lattice_id += 1
        rows = int(core_layout.get("rows", 3))
        columns = int(core_layout.get("columns", 3))
        assembly_pitch = float(core_layout.get("assemblyPitch", 21.5))
        half_width = (columns * assembly_pitch) / 2
        half_height = (rows * assembly_pitch) / 2

        if core_layout.get("reflectorMaterialId"):
            reflector_cell_id = next_cell_id
            next_cell_id += 1
            reflector_mat_id = material_openmc_id(model, core_layout["reflectorMaterialId"])
            lines.append(f'  <cell id="{reflector_cell_id}" name="reflector" universe="{core_universe_id}" material="{reflector_mat_id}" />')

        assembly_map = core_layout.get("assemblyMap") or []
        core_hex_rings = core_layout.get("hexRings")
        if core_layout.get("latticeKind") == "hex":
            n_rings = max(rows, columns)
            lines.append(f'  <hex_lattice id="{core_lattice_id}" name="core lattice" n_rings="{n_rings}">')
            lines.append(f"    <center>0 0</center>")
            lines.append(f"    <pitch>{assembly_pitch}</pitch>")
            lines.append(f"    <universes>")
            # Use hexRings if available (already in OpenMC's outermost-first format)
            if core_hex_rings:
                for ring in core_hex_rings:
                    ids = [str(assembly_universe_ids.get(asm_id, 0)) for asm_id in ring]
                    lines.append(f"      {' '.join(ids)}")
            else:
                # Fallback: convert assemblyMap (diamond shape) to ring format
                for row in assembly_map:
                    ids = [str(assembly_universe_ids.get(asm_id, 0)) for asm_id in row]
                    lines.append(f"      {' '.join(ids)}")
            lines.append(f"    </universes>")
            lines.append(f"  </hex_lattice>")
        else:
            lines.append(f'  <lattice id="{core_lattice_id}" name="core lattice" dimension="{columns} {rows}">')
            lines.append(f"    <lower_left>-{half_width} -{half_height}</lower_left>")
            lines.append(f"    <pitch>{assembly_pitch} {assembly_pitch}</pitch>")
            lines.append(f"    <universes>")
            for row in assembly_map:
                ids = [str(assembly_universe_ids.get(asm_id, 0)) for asm_id in row]
                lines.append(f"      {' '.join(ids)}")
            lines.append(f"    </universes>")
            lines.append(f"  </lattice>")

        vessel_material_id = core_layout.get("vesselMaterialId")
        vessel_thickness = core_layout.get("vesselThickness")
        if vessel_material_id and vessel_thickness:
            vessel_surface_id = next_surface_id
            next_surface_id += 1
            vessel_outer_radius = max(half_width, half_height) + float(vessel_thickness)
            lines.append(f'  <surface id="{vessel_surface_id}" name="vessel outer" type="z-cylinder" coeffs="0 0 {vessel_outer_radius}" boundary="vacuum" />')
            core_fill_cell_id = next_cell_id
            next_cell_id += 1
            lines.append(f'  <cell id="{core_fill_cell_id}" name="core fill" universe="{core_universe_id}" fill="{core_lattice_id}" />')
        else:
            core_fill_cell_id = next_cell_id
            next_cell_id += 1
            lines.append(f'  <cell id="{core_fill_cell_id}" name="core fill" universe="{core_universe_id}" fill="{core_lattice_id}" />')

    return xml_doc("geometry", "\n".join(lines))


def generate_settings_xml(model: dict[str, Any]) -> str:
    settings = model.get("settings", {})
    mode = "fixed source" if settings.get("mode") == "fixed-source" else "eigenvalue"
    lines = [f"  <run_mode>{mode}</run_mode>", f"  <particles>{settings.get('particles', 1000)}</particles>"]
    if settings.get("batches"):
        lines.append(f"  <batches>{settings['batches']}</batches>")
    if settings.get("inactive"):
        lines.append(f"  <inactive>{settings['inactive']}</inactive>")

    temperature = settings.get("temperature") or {}
    if temperature.get("default"):
        lines.append(f"  <temperature_default>{temperature['default']}</temperature_default>")
    if temperature.get("method"):
        lines.append(f"  <temperature_method>{temperature['method']}</temperature_method>")
    if temperature.get("multipole"):
        lines.append(f"  <temperature_multipole>true</temperature_multipole>")
    if temperature.get("range"):
        lines.append(f"  <temperature_range>{temperature['range'][0]} {temperature['range'][1]}</temperature_range>")

    entropy_mesh = settings.get("entropyMesh") or {}
    if entropy_mesh.get("dimension"):
        lines.append("  <entropy_mesh>")
        lines.append(f"    <dimension>{' '.join(str(v) for v in entropy_mesh['dimension'])}</dimension>")
        lines.append(f"    <lower_left>{' '.join(str(v) for v in entropy_mesh.get('lowerLeft', [-50, -50]))}</lower_left>")
        lines.append(f"    <upper_right>{' '.join(str(v) for v in entropy_mesh.get('upperRight', [50, 50]))}</upper_right>")
        lines.append("  </entropy_mesh>")

    cross_sections = settings.get("crossSections") or {}
    if cross_sections.get("path"):
        lines.append(f"  <cross_sections>{xml_escape(cross_sections['path'])}</cross_sections>")

    sources = model.get("sources") or []
    if settings.get("mode") == "fixed-source" and sources:
        lines.append("  <source>")
        for source in sources:
            stype = source.get("type", "point")
            lines.append(f"    <space type=\"{stype}\" />")
            if stype == "point" and source.get("parameters"):
                p = source["parameters"]
                lines.append(f"      <parameters>{p.get('x', 0)} {p.get('y', 0)} {p.get('z', 0)}</parameters>")
            energy = source.get("energy") or {}
            if energy.get("value"):
                lines.append("    <energy type=\"monoenergetic\" />")
                lines.append(f"      <parameters>{energy_in_ev(energy)}</parameters>")
            angle = source.get("angle") or {}
            if angle.get("type") == "isotropic":
                lines.append("    <angle type=\"isotropic\" />")
            elif angle.get("type") == "monodirectional":
                lines.append("    <angle type=\"monodirectional\" />")
                lines.append(f"      <parameters>{angle.get('u', 0)} {angle.get('v', 0)} {angle.get('w', 1)}</parameters>")
        lines.append("  </source>")

    # ── Variance Reduction ──
    vr = settings.get("varianceReduction") or {}
    ww = vr.get("weightWindows") or {}
    if ww.get("enabled"):
        lines.append("  <weight_windows>")
        if ww.get("method"):
            lines.append(f"    <method>{ww['method']}</method>")
        if ww.get("survivalRatio"):
            lines.append(f"    <survival_ratio>{ww['survivalRatio']}</survival_ratio>")
        if ww.get("maxSplit"):
            lines.append(f"    <max_split>{ww['maxSplit']}</max_split>")
        if ww.get("weightCutoff"):
            lines.append(f"    <weight_cutoff>{ww['weightCutoff']}</weight_cutoff>")
        lines.append("  </weight_windows>")

    sb = vr.get("survivalBiasing") or {}
    if sb.get("enabled"):
        lines.append("  <survival_biasing>")
        if sb.get("cutoff"):
            lines.append(f"    <cutoff>{sb['cutoff']}</cutoff>")
        if sb.get("survivalMultiplier"):
            lines.append(f"    <survival_multiplier>{sb['survivalMultiplier']}</survival_multiplier>")
        lines.append("  </survival_biasing>")

    rr = vr.get("russianRoulette") or {}
    if rr.get("enabled"):
        lines.append("  <russian_roulette>")
        if rr.get("weightThreshold"):
            lines.append(f"    <weight_threshold>{rr['weightThreshold']}</weight_threshold>")
        if rr.get("survivalWeight"):
            lines.append(f"    <survival_weight>{rr['survivalWeight']}</survival_weight>")
        lines.append("  </russian_roulette>")

    # ── Multi-Group Cross Sections ──
    mgxs = settings.get("mgxs") or {}
    if mgxs.get("enabled"):
        lines.append("  <multi_group_cross_sections>")
        if mgxs.get("libraryPath"):
            lines.append(f"    <library_path>{xml_escape(mgxs['libraryPath'])}</library_path>")
        eg = mgxs.get("energyGroups") or {}
        if eg.get("boundaries"):
            lines.append(f"    <energy_groups name=\"{xml_escape(eg.get('name', ''))}\">")
            lines.append(f"      <boundaries>{' '.join(str(v) for v in eg['boundaries'])}</boundaries>")
            lines.append("    </energy_groups>")
        if mgxs.get("domainType"):
            lines.append(f"    <domain_type>{mgxs['domainType']}</domain_type>")
        if mgxs.get("domainIds"):
            lines.append(f"    <domain_ids>{' '.join(str(v) for v in mgxs['domainIds'])}</domain_ids>")
        if mgxs.get("scatterFormat"):
            lines.append(f"    <scatter_format>{mgxs['scatterFormat']}</scatter_format>")
        if mgxs.get("order"):
            lines.append(f"    <order>{mgxs['order']}</order>")
        if mgxs.get("temperature"):
            lines.append(f"    <temperature>{mgxs['temperature']}</temperature>")
        lines.append("  </multi_group_cross_sections>")

    # ── Stochastic Volume Calculation ──
    sv = settings.get("stochasticVolume") or {}
    if sv.get("enabled"):
        lines.append("  <stochastic_volume>")
        if sv.get("domainType"):
            lines.append(f"    <domain_type>{sv['domainType']}</domain_type>")
        if sv.get("domainIds"):
            lines.append(f"    <domain_ids>{' '.join(str(v) for v in sv['domainIds'])}</domain_ids>")
        if sv.get("samples"):
            lines.append(f"    <samples>{sv['samples']}</samples>")
        if sv.get("lowerLeft"):
            lines.append(f"    <lower_left>{' '.join(str(v) for v in sv['lowerLeft'])}</lower_left>")
        if sv.get("upperRight"):
            lines.append(f"    <upper_right>{' '.join(str(v) for v in sv['upperRight'])}</upper_right>")
        lines.append("  </stochastic_volume>")

    # ── Kinetics Parameters ──
    kin = settings.get("kinetics") or {}
    if kin.get("enabled"):
        lines.append("  <kinetics>")
        if kin.get("method"):
            lines.append(f"    <method>{kin['method']}</method>")
        if kin.get("batches"):
            lines.append(f"    <batches>{kin['batches']}</batches>")
        if kin.get("numGenerations"):
            lines.append(f"    <num_generations>{kin['numGenerations']}</num_generations>")
        if kin.get("timeAbsorption"):
            lines.append(f"    <time_absorption>{kin['timeAbsorption']}</time_absorption>")
        lines.append("  </kinetics>")

    # ── Decay Sources ──
    ds = settings.get("decaySource") or {}
    if ds.get("enabled"):
        lines.append("  <decay_source>")
        if ds.get("chains"):
            lines.append(f"    <chains>{' '.join(xml_escape(c) for c in ds['chains'])}</chains>")
        if ds.get("timesteps"):
            lines.append(f"    <timesteps>{' '.join(str(v) for v in ds['timesteps'])}</timesteps>")
        if ds.get("timestepUnits"):
            lines.append(f"    <timestep_units>{ds['timestepUnits']}</timestep_units>")
        if ds.get("particles"):
            lines.append(f"    <particles>{ds['particles']}</particles>")
        if ds.get("sourceRate"):
            lines.append(f"    <source_rate>{ds['sourceRate']}</source_rate>")
        lines.append("  </decay_source>")

    # ── Random Ray Solver ──
    rray = settings.get("randomRay") or {}
    if rray.get("enabled"):
        lines.append("  <random_ray>")
        if rray.get("rayLength"):
            lines.append(f"    <ray_length>{rray['rayLength']}</ray_length>")
        if rray.get("raysPerCell"):
            lines.append(f"    <rays_per_cell>{rray['raysPerCell']}</rays_per_cell>")
        if rray.get("sourceType"):
            lines.append(f"    <source_type>{rray['sourceType']}</source_type>")
        if rray.get("maxIterations"):
            lines.append(f"    <max_iterations>{rray['maxIterations']}</max_iterations>")
        if rray.get("convergenceTolerance"):
            lines.append(f"    <convergence_tolerance>{rray['convergenceTolerance']}</convergence_tolerance>")
        lines.append("  </random_ray>")

    # ── CMFD Acceleration ──
    cmfd = settings.get("cmfd") or {}
    if cmfd.get("enabled"):
        lines.append("  <cmfd>")
        if cmfd.get("meshDimension"):
            lines.append(f"    <mesh_dimension>{' '.join(str(v) for v in cmfd['meshDimension'])}</mesh_dimension>")
        if cmfd.get("lowerLeft"):
            lines.append(f"    <lower_left>{' '.join(str(v) for v in cmfd['lowerLeft'])}</lower_left>")
        if cmfd.get("upperRight"):
            lines.append(f"    <upper_right>{' '.join(str(v) for v in cmfd['upperRight'])}</upper_right>")
        if cmfd.get("albedo"):
            lines.append(f"    <albedo>{' '.join(str(v) for v in cmfd['albedo'])}</albedo>")
        if cmfd.get("coarseGroupStructure"):
            lines.append(f"    <coarse_groups>{' '.join(str(v) for v in cmfd['coarseGroupStructure'])}</coarse_groups>")
        pi = cmfd.get("powerIteration") or {}
        if pi:
            lines.append("    <power_iteration>")
            if pi.get("tolerance"):
                lines.append(f"      <tolerance>{pi['tolerance']}</tolerance>")
            if pi.get("maxIterations"):
                lines.append(f"      <max_iterations>{pi['maxIterations']}</max_iterations>")
            lines.append("    </power_iteration>")
        lines.append("  </cmfd>")

    # ── Photon Transport ──
    pt = settings.get("photonTransport") or {}
    if pt.get("enabled"):
        lines.append("  <photon_transport>")
        lines.append("    <enabled>true</enabled>")
        if pt.get("captureGamma") is not None:
            lines.append(f"    <capture_gamma>{str(pt['captureGamma']).lower()}</capture_gamma>")
        if pt.get("electronTransport") is not None:
            lines.append(f"    <electron_transport>{str(pt['electronTransport']).lower()}</electron_transport>")
        if pt.get("pairProduction") is not None:
            lines.append(f"    <pair_production>{str(pt['pairProduction']).lower()}</pair_production>")
        if pt.get("comptonScattering") is not None:
            lines.append(f"    <compton_scattering>{str(pt['comptonScattering']).lower()}</compton_scattering>")
        if pt.get("photoelectric") is not None:
            lines.append(f"    <photoelectric>{str(pt['photoelectric']).lower()}</photoelectric>")
        lines.append("  </photon_transport>")

    # ── CAD Import ──
    cad = settings.get("cadImport") or {}
    if cad.get("enabled"):
        lines.append("  <cad_import>")
        if cad.get("filePath"):
            lines.append(f"    <file_path>{xml_escape(cad['filePath'])}</file_path>")
        if cad.get("format"):
            lines.append(f"    <format>{cad['format']}</format>")
        if cad.get("tolerance"):
            lines.append(f"    <tolerance>{cad['tolerance']}</tolerance>")
        lines.append("  </cad_import>")

    # ── MPI Configuration ──
    mpi = settings.get("mpi") or {}
    if mpi.get("enabled"):
        lines.append("  <mpi>")
        if mpi.get("processes"):
            lines.append(f"    <processes>{mpi['processes']}</processes>")
        if mpi.get("threads"):
            lines.append(f"    <threads>{mpi['threads']}</threads>")
        if mpi.get("domainDecomposition"):
            lines.append("    <domain_decomposition>")
            if mpi.get("domains"):
                lines.append(f"      <domains>{' '.join(str(v) for v in mpi['domains'])}</domains>")
            lines.append("    </domain_decomposition>")
        lines.append("  </mpi>")

    # ── Perturbation/Sensitivity ──
    pert = settings.get("perturbation") or {}
    if pert.get("enabled"):
        lines.append("  <perturbation>")
        if pert.get("method"):
            lines.append(f"    <method>{pert['method']}</method>")
        if pert.get("nuclides"):
            lines.append(f"    <nuclides>{' '.join(xml_escape(n) for n in pert['nuclides'])}</nuclides>")
        if pert.get("reactions"):
            lines.append(f"    <reactions>{' '.join(pert['reactions'])}</reactions>")
        if pert.get("deltaK"):
            lines.append("    <delta_k>true</delta_k>")
        if pert.get("coefficients"):
            lines.append("    <coefficients>true</coefficients>")
        lines.append("  </perturbation>")

    return xml_doc("settings", "\n".join(lines))


def energy_in_ev(energy: dict[str, Any]) -> float:
    value = float(energy.get("value", 0))
    unit = energy.get("unit", "eV")
    if unit == "MeV":
        return value * 1e6
    if unit == "keV":
        return value * 1e3
    return value


def generate_tallies_xml(model: dict[str, Any]) -> str:
    chunks = []
    for index, tally in enumerate(model.get("tallies", []), start=1):
        chunks.append(f'  <tally id="{index}" name="{xml_escape(tally.get("name", "Tally"))}">')

        filters = tally.get("filters") or []
        for filt in filters:
            ftype = filt.get("type", "")
            if ftype == "energy" and filt.get("bins"):
                chunks.append("    <filter type=\"energy\">")
                chunks.append(f"      <bins>{' '.join(str(v) for v in filt['bins'])}</bins>")
                chunks.append("    </filter>")
            elif ftype in ("cell", "material", "surface") and filt.get("ids"):
                chunks.append(f"    <filter type=\"{ftype}\">")
                chunks.append(f"      <bins>{' '.join(str(v) for v in filt['ids'])}</bins>")
                chunks.append("    </filter>")

        energy_bins = tally.get("energyBins") or []
        has_energy_filter = any(f.get("type") == "energy" for f in filters)
        if energy_bins and not has_energy_filter:
            bins_in_ev = [energy_in_ev(b) for b in energy_bins]
            chunks.append("    <filter type=\"energy\">")
            chunks.append(f"      <bins>{' '.join(str(v) for v in bins_in_ev)}</bins>")
            chunks.append("    </filter>")

        chunks.append(f'    <scores>{" ".join(xml_escape(score) for score in tally.get("scores", []))}</scores>')

        nuclides = tally.get("nuclides") or []
        if nuclides:
            chunks.append(f'    <nuclides>{" ".join(xml_escape(n) for n in nuclides)}</nuclides>')

        chunks.append("  </tally>")
    return xml_doc("tallies", "\n".join(chunks))


def generate_plots_xml(model: dict[str, Any]) -> str:
    components = model.get("components") or {}
    core_layout = components.get("coreLayout")
    assembly_types = components.get("assemblyTypes") or []

    if core_layout:
        pitch_cm = float(core_layout.get("assemblyPitch", 21.5))
        row_count = int(core_layout.get("rows", 5))
    elif assembly_types:
        pitch_cm = float(assembly_types[0].get("pitch", 1.26))
        row_count = int(assembly_types[0].get("rows", 3))
    else:
        lattices = model.get("lattices", [])
        lattice = lattices[0] if lattices else {}
        pitch = lattice.get("pitch", {}) if isinstance(lattice, dict) else {}
        pitch_value = float(pitch.get("value", 20) or 20)
        pitch_unit = pitch.get("unit", "cm")
        pitch_cm = pitch_value * 100 if pitch_unit == "m" else pitch_value
        row_count = len(lattice.get("map", [])) if isinstance(lattice, dict) else 5

    width = max(100, round(row_count * pitch_cm * 1.5))
    basis = model.get("settings", {}).get("plotBasis") or ("xz" if model.get("family") == "shielding-fixed-source" else "xy")

    body = "\n".join(
        [
            '  <plot id="1">',
            f"    <filename>openmc-studio-{basis}-preview</filename>",
            "    <origin>0 0 0</origin>",
            f"    <width>{width} {width}</width>",
            "    <pixels>900 900</pixels>",
            f"    <basis>{basis}</basis>",
            "    <color_by>material</color_by>",
            "  </plot>",
        ]
    )
    return xml_doc("plots", body)


def xml_doc(root: str, body: str) -> str:
    return f'<?xml version="1.0" encoding="UTF-8"?>\n<{root}>\n{body}\n</{root}>\n'


def xml_escape(value: Any) -> str:
    return str(value).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;").replace("'", "&apos;")


def tail(value: str, limit: int = 4000) -> str:
    return value[-limit:]


def summarize_results(project_dir: Path) -> dict[str, Any]:
    runs_dir = project_dir / "runs"
    if not runs_dir.is_dir():
        return {"ok": True, "summary": {"totalRuns": 0, "successfulRuns": 0, "failedRuns": 0, "latestRunId": None}}

    manifests: list[dict[str, Any]] = []
    for child in runs_dir.iterdir():
        manifest_path = child / "manifest.json"
        if child.is_dir() and manifest_path.is_file():
            try:
                manifests.append(json.loads(manifest_path.read_text(encoding="utf-8")))
            except json.JSONDecodeError:
                continue

    manifests.sort(key=lambda item: str(item.get("runId", "")), reverse=True)
    total = len(manifests)
    successful = sum(1 for item in manifests if item.get("ok"))
    failed = total - successful
    latest = manifests[0] if manifests else None

    return {
        "ok": True,
        "summary": {
            "totalRuns": total,
            "successfulRuns": successful,
            "failedRuns": failed,
            "latestRunId": latest.get("runId") if latest else None,
            "latestReturnCode": latest.get("returnCode") if latest else None,
            "latestStartedAt": latest.get("startedAt") if latest else None,
        },
    }


def export_proof_pack(project_dir: Path, repo_url: str) -> dict[str, Any]:
    summary = summarize_results(project_dir).get("summary", {})
    proof_dir = project_dir / "reports" / f"proof-pack-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"
    proof_dir.mkdir(parents=True, exist_ok=True)

    checklist = {
        "title": "OpenMC Studio Proof of Use Pack",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "projectDir": str(project_dir),
        "repoUrl": repo_url,
        "runSummary": summary,
        "artifacts": [
            "project.json",
            "model/model.json",
            "generated/*.xml",
            "runs/*/manifest.json",
            "runs/*/stdout.log",
            "runs/*/stderr.log",
        ],
        "recommendedUploads": [
            "Terminal screenshot showing npm test and build passing",
            "UI screenshot: Environment, Model, Validation, Run, Results tabs",
            "Run history screenshot with at least one completed run",
            "GitHub repo URL and recent commits",
        ],
    }

    (proof_dir / "proof-checklist.json").write_text(json.dumps(checklist, indent=2), encoding="utf-8")
    (proof_dir / "mimo-answer-template.txt").write_text(
        """04. Specific results:\n"
"I built OpenMC Studio, a lightweight AI-assisted desktop GUI that removes OpenMC's coding barrier by enabling visual model setup, validation, run orchestration, and reproducible artifacts."
"\n\n05. Proof of use:\n"
"Attach proof-checklist.json outputs, terminal logs, run manifests, and repository URL.\n""",
        encoding="utf-8",
    )

    return {"ok": True, "proofPackDir": str(proof_dir), "summary": summary}


def list_proof_packs(project_dir: Path) -> dict[str, Any]:
    reports_dir = project_dir / "reports"
    if not reports_dir.is_dir():
        return {"ok": True, "proofPacks": []}

    packs: list[dict[str, Any]] = []
    for child in reports_dir.iterdir():
        if not child.is_dir() or not child.name.startswith("proof-pack-"):
            continue
        checklist = child / "proof-checklist.json"
        packs.append(
            {
                "name": child.name,
                "path": str(child),
                "hasChecklist": checklist.is_file(),
                "modifiedAt": datetime.fromtimestamp(child.stat().st_mtime, tz=timezone.utc).isoformat(),
            }
        )

    packs.sort(key=lambda item: item["name"], reverse=True)
    return {"ok": True, "proofPacks": packs}


def export_submission_bundle(project_dir: Path, repo_url: str) -> dict[str, Any]:
    reports_dir = project_dir / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    bundle_name = f"mimo-submission-{timestamp}.zip"
    bundle_path = reports_dir / bundle_name

    summary = summarize_results(project_dir).get("summary", {})
    statepoint = summarize_statepoint(project_dir)
    proof_packs = list_proof_packs(project_dir).get("proofPacks", [])

    with zipfile.ZipFile(bundle_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        # Core project files
        _add_if_exists(archive, project_dir / "project.json", "project.json")
        _add_if_exists(archive, project_dir / "model" / "model.json", "model/model.json")

        # Generated inputs
        generated_dir = project_dir / "generated"
        if generated_dir.is_dir():
            for filename in ["materials.xml", "geometry.xml", "settings.xml", "tallies.xml"]:
                _add_if_exists(archive, generated_dir / filename, f"generated/{filename}")

        # Latest run artifacts
        runs_dir = project_dir / "runs"
        latest_runs: list[Path] = []
        if runs_dir.is_dir():
            latest_runs = sorted([item for item in runs_dir.iterdir() if item.is_dir()], key=lambda path: path.name, reverse=True)[:3]
            for run in latest_runs:
                _add_if_exists(archive, run / "manifest.json", f"runs/{run.name}/manifest.json")
                _add_if_exists(archive, run / "stdout.log", f"runs/{run.name}/stdout.log")
                _add_if_exists(archive, run / "stderr.log", f"runs/{run.name}/stderr.log")

        # Latest proof pack checklist files
        for pack in proof_packs[:3]:
            pack_dir = Path(pack["path"])
            _add_if_exists(archive, pack_dir / "proof-checklist.json", f"proof/{pack_dir.name}/proof-checklist.json")
            _add_if_exists(archive, pack_dir / "mimo-answer-template.txt", f"proof/{pack_dir.name}/mimo-answer-template.txt")

        submission_meta = {
            "createdAt": datetime.now(timezone.utc).isoformat(),
            "repoUrl": repo_url,
            "projectDir": str(project_dir),
            "summary": summary,
            "statepoint": statepoint.get("summary"),
            "includedRuns": [run.name for run in latest_runs],
        }
        archive.writestr("submission/metadata.json", json.dumps(submission_meta, indent=2))

        checklist = (
            "Mimo Submission Quick Checklist\n"
            "1. Attach this ZIP bundle.\n"
            "2. Attach terminal screenshots for typecheck/test/build.\n"
            "3. Attach UI screenshots (Environment/Model/Validation/Run/Results).\n"
            "4. Include GitHub URL and latest commit hashes.\n"
            f"GitHub: {repo_url}\n"
        )
        archive.writestr("submission/checklist.txt", checklist)

    return {
        "ok": True,
        "bundlePath": str(bundle_path),
        "includedProofPacks": len(proof_packs[:3]),
        "includedRuns": len(latest_runs),
    }


def generate_mimo_draft(project_dir: Path, repo_url: str) -> dict[str, Any]:
    reports_dir = project_dir / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out_path = reports_dir / f"mimo-draft-{timestamp}.txt"

    run_summary = summarize_results(project_dir).get("summary", {})
    statepoint = summarize_statepoint(project_dir).get("summary")
    proof_packs = list_proof_packs(project_dir).get("proofPacks", [])

    q4 = (
        "04. Please describe the specific results of your Agent- or AI-driven project\n\n"
        "I built OpenMC Studio, a lightweight AI-assisted desktop GUI that lowers the barrier to OpenMC neutron transport simulation. "
        "The core pain point is that OpenMC typically requires coding and domain-heavy manual setup, making it hard for non-coders "
        "to model, validate, run, and analyze simulations.\n\n"
        "The core logic flow combines long-chain reasoning and modular agent-style orchestration: environment detection, project modeling, "
        "geometry/physics sanity validation, deterministic OpenMC XML generation, run orchestration, and evidence export. "
        "Current implemented workflow includes: visual model presets for multiple reactor families, irregular custom topology support, "
        "save/load portable project bundles, generated inputs tracking, run logs/manifests, statepoint summary extraction, and proof-pack export.\n\n"
        f"Current evidence summary: total runs={run_summary.get('totalRuns', 0)}, successful runs={run_summary.get('successfulRuns', 0)}, "
        f"failed runs={run_summary.get('failedRuns', 0)}, latest run={run_summary.get('latestRunId')}. "
        f"Latest statepoint k-eff={statepoint.get('kEffective') if isinstance(statepoint, dict) else 'n/a'} "
        f"(+/- {statepoint.get('kStdDev') if isinstance(statepoint, dict) else 'n/a'}).\n"
    )

    q5 = (
        "\n05. Proof of Use and Influence\n\n"
        f"GitHub (public): {repo_url}\n"
        f"Project path: {project_dir}\n"
        f"Proof packs generated: {len(proof_packs)}\n"
        "Available evidence includes:\n"
        "- Terminal logs showing typecheck/test/build verification\n"
        "- Run manifests and stdout/stderr logs under runs/*\n"
        "- Generated OpenMC XML artifacts under generated/*\n"
        "- Submission ZIP and proof-checklist files under reports/*\n"
    )

    out_path.write_text(q4 + q5, encoding="utf-8")
    return {"ok": True, "draftPath": str(out_path)}


def _add_if_exists(archive: zipfile.ZipFile, source: Path, destination: str) -> None:
    if source.is_file():
        archive.write(source, arcname=destination)


def summarize_statepoint(project_dir: Path) -> dict[str, Any]:
    generated_dir = project_dir / "generated"
    if not generated_dir.is_dir():
        return {
            "ok": False,
            "message": "Generated directory not found. Run input generation and OpenMC first.",
            "summary": None,
        }

    statepoints = sorted(generated_dir.glob("statepoint.*.h5"), key=lambda path: path.stat().st_mtime, reverse=True)
    if not statepoints:
        return {
            "ok": False,
            "message": "No statepoint.*.h5 files found in generated directory.",
            "summary": None,
        }

    latest = statepoints[0]
    summary: dict[str, Any] = {
        "statepointPath": str(latest),
        "sizeBytes": latest.stat().st_size,
        "modifiedAt": datetime.fromtimestamp(latest.stat().st_mtime, tz=timezone.utc).isoformat(),
        "kEffective": None,
        "kStdDev": None,
        "tallies": None,
    }

    # Best effort parse with openmc Python module if available.
    try:
        import openmc  # type: ignore

        statepoint = openmc.StatePoint(str(latest))
        k_combined = getattr(statepoint, "k_combined", None)
        if k_combined is not None:
            if hasattr(k_combined, "nominal_value") and hasattr(k_combined, "std_dev"):
                summary["kEffective"] = float(k_combined.nominal_value)
                summary["kStdDev"] = float(k_combined.std_dev)
            elif isinstance(k_combined, (list, tuple)) and len(k_combined) >= 2:
                summary["kEffective"] = float(k_combined[0])
                summary["kStdDev"] = float(k_combined[1])

        k_generation = getattr(statepoint, "k_generation", None)
        if k_generation is not None:
            k_mean_series: list[float] = []
            k_std_series: list[float] = []
            for item in k_generation:
                try:
                    if isinstance(item, (list, tuple)) and len(item) >= 2:
                        k_mean_series.append(float(item[0]))
                        k_std_series.append(float(item[1]))
                    else:
                        k_mean_series.append(float(item))
                except Exception:
                    continue
            if k_mean_series:
                summary["kGenerationMean"] = k_mean_series
            if k_std_series:
                summary["kGenerationStd"] = k_std_series

        # Full tally data extraction
        tally_results = []
        for tally in statepoint.tallies.values():
            tally_data = {
                "id": tally.id,
                "name": tally.name or f"tally-{tally.id}",
                "scores": list(tally.scores),
                "mean": [],
                "stdDev": [],
                "filters": [],
            }

            # Extract filter information
            for f in tally.filters:
                filter_info = {
                    "type": getattr(f, "type", f.__class__.__name__.replace("Filter", "").lower()),
                    "bins": None,
                }
                if hasattr(f, "bins"):
                    raw_bins = list(f.bins) if hasattr(f.bins, "__iter__") else [f.bins]
                    filter_info["bins"] = _json_safe(raw_bins)
                elif hasattr(f, "values"):
                    raw_bins = list(f.values) if hasattr(f.values, "__iter__") else [f.values]
                    filter_info["bins"] = _json_safe(raw_bins)
                elif hasattr(f, "energy"):
                    raw_bins = list(f.energy) if hasattr(f.energy, "__iter__") else [f.energy]
                    filter_info["bins"] = _json_safe(raw_bins)
                elif hasattr(f, "groups"):
                    filter_info["bins"] = [str(g) for g in f.groups]
                tally_data["filters"].append(filter_info)

            # Get mean and std dev for all bins
            data = tally.get_slice(scores=tally.scores)
            mean_vals = data.mean.flatten().tolist()
            std_vals = data.std_dev.flatten().tolist()
            tally_data["mean"] = mean_vals
            tally_data["stdDev"] = std_vals
            tally_results.append(tally_data)

        summary["tallies"] = tally_results
        summary["nTallies"] = len(tally_results)
    except Exception as exc:  # noqa: BLE001 - tolerate missing optional deps
        summary["parseWarning"] = f"Statepoint parsed in metadata-only mode: {exc}"

    return {"ok": True, "summary": _json_safe(summary)}


def summarize_tally_spectrum(project_dir: Path, tally_id: int | None = None) -> dict[str, Any]:
    generated_dir = project_dir / "generated"
    if not generated_dir.is_dir():
        return {"ok": False, "message": "Generated directory not found. Run input generation and OpenMC first.", "summary": None}

    statepoints = sorted(generated_dir.glob("statepoint.*.h5"), key=lambda path: path.stat().st_mtime, reverse=True)
    if not statepoints:
        return {"ok": False, "message": "No statepoint.*.h5 files found in generated directory.", "summary": None}

    latest = statepoints[0]
    result: dict[str, Any] = {
        "statepointPath": str(latest),
        "tallies": [],
    }

    try:
        import openmc  # type: ignore

        statepoint = openmc.StatePoint(str(latest))

        for tally in statepoint.tallies.values():
            if tally_id is not None and tally.id != tally_id:
                continue

            has_energy = False
            energy_bins: list[float] | list = []
            for f in tally.filters:
                if isinstance(f, openmc.EnergyFilter):  # type: ignore
                    has_energy = True
                    energy_bins = list(f.energy)
                    break

            if not has_energy:
                continue

            data = tally.get_slice(scores=tally.scores)
            mean_vals = data.mean.flatten().tolist()
            std_vals = data.std_dev.flatten().tolist()

            tally_entry: dict[str, Any] = {
                "tallyId": tally.id,
                "tallyName": tally.name or f"tally-{tally.id}",
                "scores": list(tally.scores),
                "energyBins": energy_bins,
                "mean": mean_vals,
                "stdDev": std_vals,
            }
            result["tallies"].append(tally_entry)
            if tally_id is not None:
                break

        if not result["tallies"] and tally_id is not None:
            return {"ok": False, "message": f"No energy spectrum data found for tally {tally_id}.", "summary": None}

    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "message": f"Spectrum summary parsed in metadata-only mode: {exc}", "summary": None}

    return {"ok": True, "summary": result}


def summarize_depletion(project_dir: Path) -> dict[str, Any]:
    generated_dir = project_dir / "generated"
    if not generated_dir.is_dir():
        return {"ok": False, "message": "Generated directory not found.", "summary": None}

    depletion_files = sorted(generated_dir.glob("depletion_results*.h5"), key=lambda path: path.stat().st_mtime, reverse=True)
    if not depletion_files:
        return {"ok": False, "message": "No depletion_results*.h5 files found in generated directory.", "summary": None}

    latest = depletion_files[0]
    summary: dict[str, Any] = {
        "resultsPath": str(latest),
        "sizeBytes": latest.stat().st_size,
        "modifiedAt": datetime.fromtimestamp(latest.stat().st_mtime, tz=timezone.utc).isoformat(),
        "time": [],
        "kEffective": [],
        "kStdDev": [],
    }

    try:
        import openmc.deplete  # type: ignore

        results = openmc.deplete.Results(str(latest))
        times = [float(value) for value in results.get_times()]
        k_values = results.get_keff()

        summary["time"] = times
        summary["kEffective"] = [float(value[0]) for value in k_values]
        summary["kStdDev"] = [float(value[1]) for value in k_values]
    except Exception as exc:  # noqa: BLE001
        summary["parseWarning"] = f"Depletion parsed in metadata-only mode: {exc}"

    return {"ok": True, "summary": summary}


def run_stochastic_volume(project_dir: Path, cell_ids: list[int], samples: int = 1_000_000) -> dict[str, Any]:
    generated_dir = project_dir / "generated"
    if not generated_dir.is_dir():
        return {"ok": False, "message": "Generated directory not found. Run OpenMC first.", "results": []}

    if not cell_ids:
        return {"ok": False, "message": "At least one cell ID is required.", "results": []}

    statepoints = sorted(generated_dir.glob("statepoint.*.h5"), key=lambda path: path.stat().st_mtime, reverse=True)
    if not statepoints:
        return {"ok": False, "message": "No statepoint.*.h5 files found in generated directory.", "results": []}

    try:
        import openmc  # type: ignore

        geometry_path = generated_dir / "geometry.xml"
        if not geometry_path.is_file():
            return {"ok": False, "message": "geometry.xml not found in generated directory.", "results": []}

        geometry = openmc.Geometry.from_xml(path=str(geometry_path))
        selected_cells = []
        all_cells = geometry.get_all_cells()
        missing: list[int] = []
        for cell_id in cell_ids:
            cell = all_cells.get(int(cell_id))
            if cell is None:
                missing.append(int(cell_id))
                continue
            selected_cells.append(cell)

        if missing:
            return {"ok": False, "message": f"Cells not found in geometry: {missing}", "results": []}

        # OpenMC API changed naming across versions (VolumeCalculation vs VolumeCalculator).
        calculator_cls = getattr(openmc, "VolumeCalculator", None) or getattr(openmc, "VolumeCalculation", None)
        if calculator_cls is None:
            return {"ok": False, "message": "OpenMC stochastic volume API is unavailable in this Python environment.", "results": []}

        calculator = calculator_cls(domains=selected_cells, samples=int(samples))
        calculator.load_statepoint(str(statepoints[0]))
        calculator.calculate_volumes()

        results: list[dict[str, Any]] = []
        for cell in selected_cells:
            value = calculator.volumes.get(cell.id)
            if value is None:
                continue
            volume = float(value.n) if hasattr(value, "n") else float(value[0])
            std_dev = float(value.s) if hasattr(value, "s") else float(value[1])
            results.append({"cellId": int(cell.id), "volume": volume, "stdDev": std_dev})

        return {"ok": True, "results": results}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "message": f"Stochastic volume calculation failed: {exc}", "results": []}


def generate_notebook(project_dir: Path) -> dict[str, Any]:
    """Generate a Jupyter notebook (.ipynb) from the project's OpenMC input files."""
    generated_dir = project_dir / "generated"
    if not generated_dir.is_dir():
        return {"ok": False, "message": "Generated directory not found. Generate inputs first."}

    # Read existing XML files
    xml_files: dict[str, str] = {}
    for name in ["materials.xml", "geometry.xml", "settings.xml", "tallies.xml", "plots.xml"]:
        path = generated_dir / name
        if path.is_file():
            xml_files[name] = path.read_text(encoding="utf-8")

    if not xml_files:
        return {"ok": False, "message": "No XML files found in generated directory."}

    # Build notebook cells
    cells: list[dict[str, Any]] = []

    def md_cell(source: str) -> dict[str, Any]:
        return {
            "cell_type": "markdown",
            "metadata": {},
            "source": source.split("\n") if "\n" not in source else [line + "\n" for line in source.split("\n")[:-1]] + [source.split("\n")[-1]],
        }

    def code_cell(source: str) -> dict[str, Any]:
        return {
            "cell_type": "code",
            "execution_count": None,
            "metadata": {},
            "outputs": [],
            "source": source.split("\n") if "\n" not in source else [line + "\n" for line in source.split("\n")[:-1]] + [source.split("\n")[-1]],
        }

    # Title
    cells.append(md_cell("# OpenMC Simulation Notebook\n\nGenerated by OpenMC Studio.\nThis notebook reproduces the simulation defined in the GUI project."))

    # Setup
    cells.append(md_cell("## 1. Setup"))
    cells.append(code_cell(
        "import openmc\nimport numpy as np\nimport matplotlib.pyplot as plt\n\n"
        "# Verify OpenMC version\nprint(f'OpenMC version: {openmc.__version__}')"
    ))

    # Materials
    if "materials.xml" in xml_files:
        cells.append(md_cell("## 2. Materials"))
        cells.append(code_cell(
            "# Load materials from XML\nmaterials = openmc.Materials.from_xml()\nprint(f'Loaded {len(materials)} materials')\n\n"
            "# Display material details\nfor mat in materials:\n    print(f'  {mat.name}: {mat.density}')"
        ))

    # Geometry
    if "geometry.xml" in xml_files:
        cells.append(md_cell("## 3. Geometry"))
        cells.append(code_cell(
            "# Load geometry from XML\ngeometry = openmc.Geometry.from_xml()\ncells = geometry.get_all_cells()\nprint(f'Loaded {len(cells)} cells')"
        ))

    # Settings
    if "settings.xml" in xml_files:
        cells.append(md_cell("## 4. Settings"))
        cells.append(code_cell(
            "# Load settings from XML\nsettings = openmc.Settings.from_xml()\n"
            "print(f'Batches: {settings.batches}')\nprint(f'Inactive: {settings.inactive}')\nprint(f'Particles: {settings.particles}')"
        ))

    # Tallies
    if "tallies.xml" in xml_files:
        cells.append(md_cell("## 5. Tallies"))
        cells.append(code_cell(
            "# Load tallies from XML\ntallies = openmc.Tallies.from_xml()\nprint(f'Loaded {len(tallies)} tallies')\n\n"
            "# Display tally details\nfor tally in tallies:\n    print(f'  Tally {tally.id}: scores={tally.scores}')"
        ))

    # Run
    cells.append(md_cell("## 6. Run Simulation"))
    cells.append(code_cell(
        "# Run OpenMC simulation\nopenmc.run()\nprint('Simulation complete!')"
    ))

    # Results
    cells.append(md_cell("## 7. Results"))
    cells.append(code_cell(
        "# Load results from statepoint\nsp = openmc.StatePoint('statepoint.100.h5')\n\n"
        "# k-effective\nk_combined = sp.keff\nprint(f'k-effective: {k_combined.nominal_value:.5f} ± {k_combined.std_dev:.5f}')\n\n"
        "# Tally results\nfor tally in sp.tallies.values():\n    print(f'\\nTally {tally.id}:')\n    print(tally.get_pandas_dataframe())"
    ))

    # Plots
    cells.append(md_cell("## 8. Visualization"))
    cells.append(code_cell(
        "# Plot geometry\nfig, ax = plt.subplots(figsize=(8, 8))\ngeometry.plot(origin=(0, 0, 0), width=(20, 20), pixels=(400, 400), axis=ax)\nax.set_title('Geometry XY Plot')\nplt.tight_layout()\nplt.show()"
    ))
    cells.append(code_cell(
        "# Plot flux distribution (if mesh tally exists)\nfor tally in sp.tallies.values():\n    if 'flux' in tally.scores:\n        df = tally.get_pandas_dataframe()\n        print(f'Flux tally {tally.id}:')\n        print(df.describe())\n        break"
    ))

    # Build notebook
    notebook = {
        "cells": cells,
        "metadata": {
            "kernelspec": {
                "display_name": "Python 3",
                "language": "python",
                "name": "python3",
            },
            "language_info": {
                "name": "python",
                "version": "3.10.0",
            },
        },
        "nbformat": 4,
        "nbformat_minor": 5,
    }

    # Save notebook
    notebook_path = project_dir / "openmc_simulation.ipynb"
    notebook_path.write_text(json.dumps(notebook, indent=2, ensure_ascii=False), encoding="utf-8")

    return {"ok": True, "notebookPath": str(notebook_path), "cells": len(cells)}


def emit(payload: dict[str, Any]) -> int:
    print(json.dumps(payload, indent=2, sort_keys=True))
    return 0 if payload.get("ok", False) else 1
