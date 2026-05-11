from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
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


def emit(payload: dict[str, Any]) -> int:
    print(json.dumps(payload, indent=2, sort_keys=True))
    return 0 if payload.get("ok", False) else 1
