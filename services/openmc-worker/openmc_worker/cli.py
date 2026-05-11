from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
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

    summarize = subparsers.add_parser("summarize-results")
    summarize.add_argument("--project-dir", required=True)

    statepoint = subparsers.add_parser("summarize-statepoint")
    statepoint.add_argument("--project-dir", required=True)

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

    if args.command == "summarize-results":
        return emit(summarize_results(Path(args.project_dir)))

    if args.command == "summarize-statepoint":
        return emit(summarize_statepoint(Path(args.project_dir)))

    if args.command == "export-proof-pack":
        return emit(export_proof_pack(Path(args.project_dir), args.repo_url))

    if args.command == "list-proof-packs":
        return emit(list_proof_packs(Path(args.project_dir)))

    if args.command == "export-submission-bundle":
        return emit(export_submission_bundle(Path(args.project_dir), args.repo_url))

    if args.command == "generate-mimo-draft":
        return emit(generate_mimo_draft(Path(args.project_dir), args.repo_url))

    return 2


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

    return candidates


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

    try:
        result = subprocess.run(
            base_command,
            cwd=generated_dir,
            check=False,
            capture_output=True,
            text=True,
            timeout=int(payload.get("timeoutSeconds", 3600)),
        )
        stdout = result.stdout
        stderr = result.stderr
        return_code = result.returncode
        ok = return_code == 0
    except (OSError, subprocess.TimeoutExpired) as exc:
        stdout = ""
        stderr = str(exc)
        return_code = -1
        ok = False

    ended_at = datetime.now(timezone.utc).isoformat()
    (run_dir / "stdout.log").write_text(stdout, encoding="utf-8")
    (run_dir / "stderr.log").write_text(stderr, encoding="utf-8")

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
        "stdoutLog": str(run_dir / "stdout.log"),
        "stderrLog": str(run_dir / "stderr.log"),
    }
    (run_dir / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8")

    return {
        "ok": ok,
        "runId": run_id,
        "runDir": str(run_dir),
        "returnCode": return_code,
        "stdoutTail": tail(stdout),
        "stderrTail": tail(stderr),
        "manifest": manifest,
    }


def live_run_status(project_dir: Path, run_id: str, tail_size: int) -> dict[str, Any]:
    runs_dir = project_dir / "runs"
    if not runs_dir.is_dir():
        return {"ok": False, "message": "No runs directory found."}

    run_dir = resolve_run_dir(runs_dir, run_id)
    if run_dir is None:
        return {"ok": False, "message": "No run found."}

    manifest_path = run_dir / "manifest.json"
    stdout_path = run_dir / "stdout.log"
    stderr_path = run_dir / "stderr.log"

    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.is_file() else {}
    stdout = stdout_path.read_text(encoding="utf-8", errors="replace") if stdout_path.is_file() else ""
    stderr = stderr_path.read_text(encoding="utf-8", errors="replace") if stderr_path.is_file() else ""

    status = "completed" if manifest else "running"
    if manifest and not manifest.get("ok", False):
        status = "failed"

    return {
        "ok": True,
        "runId": manifest.get("runId", run_dir.name),
        "status": status,
        "returnCode": manifest.get("returnCode"),
        "startedAt": manifest.get("startedAt"),
        "endedAt": manifest.get("endedAt"),
        "stdoutTail": tail(stdout, max(500, tail_size)),
        "stderrTail": tail(stderr, max(500, tail_size)),
        "runDir": str(run_dir),
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
    names: list[str] = []

    def visit(node: dict[str, Any]) -> None:
        names.append(str(node.get("name", "Node")))
        for child in node.get("children", []):
            visit(child)

    visit(model.get("root", {"name": "Root", "children": []}))
    cells = "\n".join(f'  <cell id="{index}" name="{xml_escape(name)}" />' for index, name in enumerate(names, start=1))
    return xml_doc("geometry", "  <!-- Preview geometry generated from OpenMC Studio hierarchy. -->\n" + cells)


def generate_settings_xml(model: dict[str, Any]) -> str:
    settings = model.get("settings", {})
    mode = "fixed source" if settings.get("mode") == "fixed-source" else "eigenvalue"
    lines = [f"  <run_mode>{mode}</run_mode>", f"  <particles>{settings.get('particles', 1000)}</particles>"]
    if settings.get("batches"):
        lines.append(f"  <batches>{settings['batches']}</batches>")
    if settings.get("inactive"):
        lines.append(f"  <inactive>{settings['inactive']}</inactive>")
    return xml_doc("settings", "\n".join(lines))


def generate_tallies_xml(model: dict[str, Any]) -> str:
    chunks = []
    for index, tally in enumerate(model.get("tallies", []), start=1):
        chunks.append(f'  <tally id="{index}" name="{xml_escape(tally.get("name", "Tally"))}">')
        chunks.append(f'    <scores>{" ".join(xml_escape(score) for score in tally.get("scores", []))}</scores>')
        chunks.append("  </tally>")
    return xml_doc("tallies", "\n".join(chunks))


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
        if getattr(statepoint, "k_combined", None) is not None:
            k_mean, k_std = statepoint.k_combined
            summary["kEffective"] = float(k_mean)
            summary["kStdDev"] = float(k_std)

        tally_names = []
        for tally in statepoint.tallies.values():
            if tally.name:
                tally_names.append(tally.name)
            else:
                tally_names.append(f"tally-{tally.id}")
        summary["tallies"] = tally_names
    except Exception as exc:  # noqa: BLE001 - tolerate missing optional deps
        summary["parseWarning"] = f"Statepoint parsed in metadata-only mode: {exc}"

    return {"ok": True, "summary": summary}


def emit(payload: dict[str, Any]) -> int:
    print(json.dumps(payload, indent=2, sort_keys=True))
    return 0 if payload.get("ok", False) else 1
