from __future__ import annotations

import unittest
import json
import sys
import tempfile
from pathlib import Path
import zipfile

from openmc_worker.cli import (
    detect_candidates,
    export_proof_pack,
    export_submission_bundle,
    generate_inputs,
    live_run_status,
    health_check,
    list_proof_packs,
    run_openmc,
    summarize_results,
    summarize_statepoint,
)


class WorkerTests(unittest.TestCase):
    def test_detect_candidates_returns_python_module_candidate(self) -> None:
        candidates = detect_candidates()
        self.assertTrue(any(candidate.kind == "python-module" for candidate in candidates))

    def test_health_check_handles_missing_command(self) -> None:
        result = health_check({"command": ["definitely-missing-openmc-command"]})
        self.assertFalse(result["ok"])
        self.assertTrue(any(check["id"] == "openmc-version" for check in result["checks"]))

    def test_generate_inputs_writes_openmc_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            model_dir = root / "model"
            model_dir.mkdir()
            (model_dir / "model.json").write_text(
                json.dumps(
                    {
                        "materials": {"materials": []},
                        "root": {"name": "Root", "children": []},
                        "settings": {"mode": "eigenvalue", "particles": 1000},
                        "tallies": [],
                    }
                ),
                encoding="utf-8",
            )

            result = generate_inputs(root)
            self.assertTrue(result["ok"])
            self.assertTrue((root / "generated" / "settings.xml").is_file())

    def test_run_openmc_captures_manifest_for_supplied_command(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            model_dir = root / "model"
            model_dir.mkdir()
            (model_dir / "model.json").write_text(
                json.dumps(
                    {
                        "materials": {"materials": []},
                        "root": {"name": "Root", "children": []},
                        "settings": {"mode": "eigenvalue", "particles": 1000},
                        "tallies": [],
                    }
                ),
                encoding="utf-8",
            )

            result = run_openmc(root, {"command": [sys.executable, "-c", "print('openmc stub')"]})
            self.assertTrue(result["ok"])
            self.assertTrue((Path(result["runDir"]) / "manifest.json").is_file())

    def test_result_summary_and_proof_pack(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            model_dir = root / "model"
            model_dir.mkdir(parents=True)
            (model_dir / "model.json").write_text(
                json.dumps(
                    {
                        "materials": {"materials": []},
                        "root": {"name": "Root", "children": []},
                        "settings": {"mode": "eigenvalue", "particles": 1000},
                        "tallies": [],
                    }
                ),
                encoding="utf-8",
            )

            run_openmc(root, {"command": [sys.executable, "-c", "print('openmc stub')"]})
            summary = summarize_results(root)
            self.assertTrue(summary["ok"])
            self.assertGreaterEqual(summary["summary"]["totalRuns"], 1)

            proof = export_proof_pack(root, "https://github.com/rinopatrick/openmc-studio")
            self.assertTrue(proof["ok"])
            self.assertTrue((Path(proof["proofPackDir"]) / "proof-checklist.json").is_file())
            packs = list_proof_packs(root)
            self.assertTrue(packs["ok"])
            self.assertGreaterEqual(len(packs["proofPacks"]), 1)

    def test_export_submission_bundle_creates_zip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            model_dir = root / "model"
            model_dir.mkdir(parents=True)
            (root / "project.json").write_text(json.dumps({"schemaVersion": 1}), encoding="utf-8")
            (model_dir / "model.json").write_text(
                json.dumps(
                    {
                        "materials": {"materials": []},
                        "root": {"name": "Root", "children": []},
                        "settings": {"mode": "eigenvalue", "particles": 1000},
                        "tallies": [],
                    }
                ),
                encoding="utf-8",
            )

            generate_inputs(root)
            run_openmc(root, {"command": [sys.executable, "-c", "print('openmc stub')"]})
            export_proof_pack(root, "https://github.com/rinopatrick/openmc-studio")

            result = export_submission_bundle(root, "https://github.com/rinopatrick/openmc-studio")
            self.assertTrue(result["ok"])
            bundle_path = Path(result["bundlePath"])
            self.assertTrue(bundle_path.is_file())

            with zipfile.ZipFile(bundle_path, "r") as archive:
                names = archive.namelist()
                self.assertIn("submission/metadata.json", names)
                self.assertIn("submission/checklist.txt", names)

    def test_summarize_statepoint_graceful_fallback(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            generated = root / "generated"
            generated.mkdir(parents=True)
            (generated / "statepoint.001.h5").write_bytes(b"mock-hdf5-placeholder")

            result = summarize_statepoint(root)
            self.assertTrue(result["ok"])
            self.assertIsNotNone(result["summary"])
            self.assertTrue(str(result["summary"]["statepointPath"]).endswith("statepoint.001.h5"))

    def test_live_run_status_no_runs(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            result = live_run_status(Path(tmp), "", 1000)
            self.assertFalse(result["ok"])

    def test_live_run_status_reads_latest_run(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            model_dir = root / "model"
            model_dir.mkdir(parents=True)
            (model_dir / "model.json").write_text(
                json.dumps(
                    {
                        "materials": {"materials": []},
                        "root": {"name": "Root", "children": []},
                        "settings": {"mode": "eigenvalue", "particles": 1000},
                        "tallies": [],
                    }
                ),
                encoding="utf-8",
            )
            run_openmc(root, {"command": [sys.executable, "-c", "print('openmc stub')"]})
            status = live_run_status(root, "", 1200)
            self.assertTrue(status["ok"])
            self.assertIn(status["status"], ["completed", "failed"])


if __name__ == "__main__":
    unittest.main()
