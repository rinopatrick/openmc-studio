from __future__ import annotations

import argparse
import json
from urllib.parse import parse_qs, urlparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable

from .cli import (
    detect_environment,
    export_proof_pack,
    export_submission_bundle,
    generate_inputs,
    generate_mimo_draft,
    health_check,
    live_run_status,
    render_openmc_plot,
    run_openmc,
    summarize_results,
    summarize_statepoint,
    summarize_depletion,
    summarize_tally_spectrum,
    run_stochastic_volume,
    parse_openmc_errors,
)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="openmc-worker-bridge")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args(argv)

    server = ThreadingHTTPServer((args.host, args.port), BridgeHandler)
    print(f"openmc-worker bridge listening on http://{args.host}:{args.port}", flush=True)
    server.serve_forever()
    return 0


class BridgeHandler(BaseHTTPRequestHandler):
    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_cors_headers()
        self.end_headers()

    def do_POST(self) -> None:
        try:
            payload = self.read_json_body()
            result = dispatch(self.path, payload)
            self.write_json(200, {"ok": True, "stdout": json.dumps(result), "stderr": ""})
        except Exception as exc:  # noqa: BLE001 - development bridge reports worker failures as JSON
            self.write_json(500, {"ok": False, "stdout": "", "stderr": str(exc)})

    def do_GET(self) -> None:
        if self.path == "/health":
            self.write_json(200, {"ok": True})
            return
        parsed = urlparse(self.path)
        if parsed.path == "/image":
            self.write_image(parse_qs(parsed.query).get("path", [""])[0])
            return
        self.write_json(404, {"ok": False, "message": "Not found"})

    def read_json_body(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length == 0:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def write_json(self, status: int, payload: dict[str, Any]) -> None:
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_cors_headers()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def write_image(self, raw_path: str) -> None:
        path = Path(raw_path)
        if not path.is_file() or path.suffix.lower() != ".png":
            self.write_json(404, {"ok": False, "message": "PNG image not found"})
            return

        data = path.read_bytes()
        self.send_response(200)
        self.send_cors_headers()
        self.send_header("Content-Type", "image/png")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def send_cors_headers(self) -> None:
        origin = self.headers.get("Origin") or "http://127.0.0.1:1420"
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Headers", "content-type")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")

    def log_message(self, format: str, *args: Any) -> None:
        return


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


def dispatch(path: str, payload: dict[str, Any]) -> dict[str, Any]:
    routes: dict[str, Callable[[dict[str, Any]], dict[str, Any]]] = {
        "/worker_handshake": lambda _payload: {"ok": True, "workerVersion": "0.1.0", "python": "bridge"},
        "/detect_openmc_environment": lambda _payload: detect_environment(),
        "/health_check_openmc": lambda value: health_check(value.get("request", {})),
        "/generate_openmc_inputs": lambda value: generate_inputs(project_dir(value)),
        "/run_openmc": lambda value: run_openmc(project_dir(value), value.get("request", {})),
        "/render_openmc_plot": lambda value: render_openmc_plot(project_dir(value), value.get("request", {})),
        "/live_run_status": lambda value: live_run_status(project_dir(value), str(value.get("request", {}).get("runId") or ""), int(value.get("request", {}).get("tail") or 3000)),
        "/summarize_results": lambda value: summarize_results(project_dir(value)),
        "/summarize_statepoint": lambda value: summarize_statepoint(project_dir(value)),
        "/summarize_depletion": lambda value: summarize_depletion(project_dir(value)),
        "/summarize_tally_spectrum": lambda value: summarize_tally_spectrum(
            project_dir(value),
            value.get("request", {}).get("tallyId"),
        ),
        "/run_stochastic_volume": lambda value: run_stochastic_volume(
            project_dir(value),
            value.get("request", {}).get("cellIds") or [],
            int(value.get("request", {}).get("samples") or 1_000_000),
        ),
        "/export_proof_pack": lambda value: export_proof_pack(project_dir(value), str(value.get("request", {}).get("repoUrl") or "")),
        "/list_proof_packs": lambda value: __import__("openmc_worker.cli", fromlist=["list_proof_packs"]).list_proof_packs(project_dir(value)),
        "/export_submission_bundle": lambda value: export_submission_bundle(project_dir(value), str(value.get("request", {}).get("repoUrl") or "")),
        "/generate_mimo_draft": lambda value: generate_mimo_draft(project_dir(value), str(value.get("request", {}).get("repoUrl") or "")),
        "/parse_openmc_errors": lambda value: _parse_errors_from_run(project_dir(value), value.get("request", {})),
        "/statepoint_from_file": lambda value: _summarize_statepoint_file(
            str(value.get("request", {}).get("statepointPath")),
        ),
    }
    if path not in routes:
        return {"ok": False, "message": f"Unknown bridge route: {path}"}
    return routes[path](payload)


def project_dir(payload: dict[str, Any]) -> Path:
    value = payload.get("request", {}).get("projectDir")
    if not value:
        raise ValueError("projectDir is required")
    return Path(str(value))


def _parse_errors_from_run(project_dir: Path, request: dict[str, Any]) -> dict[str, Any]:
    """Parse OpenMC errors from the latest run logs."""
    runs_dir = project_dir / "runs"
    if not runs_dir.is_dir():
        return {"ok": False, "message": "No runs directory found."}
    from .cli import resolve_run_dir, tail, parse_openmc_errors as _parse_errors

    run_dir = resolve_run_dir(runs_dir, request.get("runId") or "")
    if run_dir is None:
        return {"ok": False, "message": "No run found."}

    stdout_path = run_dir / "stdout.log"
    stderr_path = run_dir / "stderr.log"
    stdout = stdout_path.read_text(encoding="utf-8", errors="replace") if stdout_path.is_file() else ""
    stderr = stderr_path.read_text(encoding="utf-8", errors="replace") if stderr_path.is_file() else ""

    return {"ok": True, **_parse_errors(stdout, stderr)}


def _summarize_statepoint_file(statepoint_path: str) -> dict[str, Any]:
    """Summarize an arbitrary statepoint file by absolute path."""
    from pathlib import Path
    from .cli import summarize_statepoint as _sp
    from datetime import datetime, timezone
    import json
    import os

    if not statepoint_path:
        return {"ok": False, "message": "statepointPath is required.", "summary": None}

    path = Path(statepoint_path)
    if not path.is_file():
        return {"ok": False, "message": f"File not found: {statepoint_path}", "summary": None}

    # Use summarize_statepoint but with the file directly
    generated_dir = path.parent
    project_dir = path.parent.parent  # assume project structure

    # Direct parse
    summary: dict[str, Any] = {
        "statepointPath": str(path),
        "sizeBytes": path.stat().st_size,
        "modifiedAt": datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat(),
        "kEffective": None,
        "kStdDev": None,
        "tallies": None,
    }

    try:
        import openmc  # type: ignore
        sp = openmc.StatePoint(str(path))
        k_combined = getattr(sp, "k_combined", None)
        if k_combined is not None:
            if hasattr(k_combined, "nominal_value") and hasattr(k_combined, "std_dev"):
                summary["kEffective"] = float(k_combined.nominal_value)
                summary["kStdDev"] = float(k_combined.std_dev)
            elif isinstance(k_combined, (list, tuple)) and len(k_combined) >= 2:
                summary["kEffective"] = float(k_combined[0])
                summary["kStdDev"] = float(k_combined[1])

        k_gen = getattr(sp, "k_generation", None)
        if k_gen is not None:
            km, ks = [], []
            for item in k_gen:
                try:
                    if isinstance(item, (list, tuple)) and len(item) >= 2:
                        km.append(float(item[0]))
                        ks.append(float(item[1]))
                    else:
                        km.append(float(item))
                except Exception:
                    continue
            if km:
                summary["kGenerationMean"] = km
            if ks:
                summary["kGenerationStd"] = ks

        tally_results = []
        for tally in sp.tallies.values():
            td = {
                "id": tally.id,
                "name": tally.name or f"tally-{tally.id}",
                "scores": list(tally.scores),
                "mean": [],
                "stdDev": [],
                "filters": [],
            }
            for f in tally.filters:
                fi = {"type": getattr(f, "type", f.__class__.__name__.replace("Filter", "").lower()), "bins": None}
                if hasattr(f, "bins"):
                    raw_bins = list(f.bins) if hasattr(f.bins, "__iter__") else [f.bins]
                    fi["bins"] = _json_safe(raw_bins)
                elif hasattr(f, "energy"):
                    raw_bins = list(f.energy) if hasattr(f.energy, "__iter__") else [f.energy]
                    fi["bins"] = _json_safe(raw_bins)
                elif hasattr(f, "groups"):
                    fi["bins"] = [str(g) for g in f.groups]
                td["filters"].append(fi)

            data = tally.get_slice(scores=tally.scores)
            td["mean"] = data.mean.flatten().tolist()
            td["stdDev"] = data.std_dev.flatten().tolist()
            tally_results.append(td)

        summary["tallies"] = tally_results
        summary["nTallies"] = len(tally_results)
    except Exception as exc:
        summary["parseWarning"] = f"Failed to parse: {exc}"

    return {"ok": True, "summary": _json_safe(summary)}


if __name__ == "__main__":
    raise SystemExit(main())
