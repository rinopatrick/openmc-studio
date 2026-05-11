from __future__ import annotations

import argparse
import json
import os
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

    args = parser.parse_args(argv)

    if args.command == "handshake":
        return emit({"ok": True, "workerVersion": __version__, "python": sys.version.split()[0]})

    if args.command == "detect-env":
        return emit(detect_environment())

    if args.command == "health-check":
        payload = json.loads(args.json)
        return emit(health_check(payload))

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


def emit(payload: dict[str, Any]) -> int:
    print(json.dumps(payload, indent=2, sort_keys=True))
    return 0 if payload.get("ok", False) else 1
