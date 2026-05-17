from __future__ import annotations

import unittest
import json
import sys
import tempfile
from pathlib import Path
import zipfile
from unittest.mock import patch

from openmc_worker.cli import (
    detect_candidates,
    detect_wsl_candidates,
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

    def test_detect_wsl_candidates_returns_openmc_distros(self) -> None:
        def run_stub(command, **_kwargs):
            if command == ["wsl.exe", "-l", "-q"]:
                return subprocess_result(0, "Ubuntu\x00\nDebian\x00\n")
            if command[:3] == ["wsl.exe", "-d", "Ubuntu"]:
                return subprocess_result(0, "/usr/bin/openmc\n")
            return subprocess_result(1, "")

        with patch("openmc_worker.cli.is_running_inside_wsl", return_value=False), patch("openmc_worker.cli.shutil.which", return_value="wsl.exe"), patch("openmc_worker.cli.subprocess.run", side_effect=run_stub):
            candidates = detect_wsl_candidates()

        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0].kind, "wsl")
        self.assertIn("Ubuntu", candidates[0].label)
        self.assertEqual(candidates[0].command[-1], "openmc")

    def test_detect_wsl_candidates_handles_missing_wsl(self) -> None:
        with patch("openmc_worker.cli.shutil.which", return_value=None):
            self.assertEqual(detect_wsl_candidates(), [])

    def test_detect_wsl_candidates_skips_inside_wsl(self) -> None:
        with patch("openmc_worker.cli.is_running_inside_wsl", return_value=True), patch("openmc_worker.cli.shutil.which") as which:
            self.assertEqual(detect_wsl_candidates(), [])

        which.assert_not_called()

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
            self.assertTrue((root / "generated" / "plots.xml").is_file())

    def test_generate_inputs_writes_openmc_native_csg_geometry(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            model_dir = root / "model"
            model_dir.mkdir()
            (model_dir / "model.json").write_text(
                json.dumps(
                    {
                        "materials": {
                            "materials": [
                                {
                                    "id": "mat-water",
                                    "name": "Water",
                                    "density": {"value": 1, "unit": "g/cm3"},
                                    "nuclides": [{"name": "H1", "fraction": 2, "fractionType": "atom"}],
                                }
                            ]
                        },
                        "openmcGeometry": {
                            "surfaces": [{"id": "surf-sphere", "openmcId": 1, "name": "Vacuum sphere", "type": "sphere", "coeffs": [0, 0, 0, 10], "boundary": "vacuum"}],
                            "cells": [{"id": "cell-water", "openmcId": 1, "name": "Water sphere", "materialId": "mat-water", "region": "-1"}],
                        },
                        "root": {"name": "Root", "children": []},
                        "settings": {"mode": "fixed-source", "particles": 1000, "plotBasis": "yz"},
                        "tallies": [],
                    }
                ),
                encoding="utf-8",
            )

            result = generate_inputs(root)
            self.assertTrue(result["ok"])
            geometry = (root / "generated" / "geometry.xml").read_text(encoding="utf-8")
            self.assertIn('<surface id="1"', geometry)
            self.assertIn('type="sphere"', geometry)
            self.assertIn('boundary="vacuum"', geometry)
            self.assertIn('material="1"', geometry)
            plots = (root / "generated" / "plots.xml").read_text(encoding="utf-8")
            self.assertIn("<basis>yz</basis>", plots)

    def test_component_geometry_generates_valid_openmc_xml(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            model_dir = root / "model"
            model_dir.mkdir()
            (model_dir / "model.json").write_text(
                json.dumps(
                    {
                        "materials": {
                            "materials": [
                                {"id": "mat-uo2", "name": "UO2", "density": {"value": 10.4, "unit": "g/cm3"}, "nuclides": [{"name": "U235", "fraction": 0.04, "fractionType": "atom"}]},
                                {"id": "mat-water", "name": "Water", "density": {"value": 1.0, "unit": "g/cm3"}, "nuclides": [{"name": "H1", "fraction": 2, "fractionType": "atom"}]},
                                {"id": "mat-steel", "name": "Steel", "density": {"value": 7.9, "unit": "g/cm3"}, "nuclides": [{"name": "Fe56", "fraction": 1, "fractionType": "atom"}]},
                            ]
                        },
                        "components": {
                            "pinCellTypes": [
                                {
                                    "id": "pin-fuel",
                                    "name": "Fuel Pin",
                                    "rings": [
                                        {"id": "ring-fuel", "name": "fuel", "outerRadius": 0.41, "materialId": "mat-uo2"},
                                        {"id": "ring-clad", "name": "clad", "outerRadius": 0.475, "materialId": "mat-steel"},
                                    ],
                                    "pitch": 1.26,
                                    "moderatorMaterialId": "mat-water",
                                }
                            ],
                            "assemblyTypes": [
                                {
                                    "id": "asm-1",
                                    "name": "Assembly 1",
                                    "latticeKind": "rect",
                                    "rows": 2,
                                    "columns": 2,
                                    "pitch": 1.26,
                                    "pinMap": [["pin-fuel", "pin-fuel"], ["pin-fuel", "pin-fuel"]],
                                }
                            ],
                            "coreLayout": {
                                "latticeKind": "rect",
                                "rows": 2,
                                "columns": 2,
                                "assemblyPitch": 21.5,
                                "assemblyMap": [["asm-1", "asm-1"], ["asm-1", "asm-1"]],
                            },
                        },
                        "root": {"name": "Root", "children": []},
                        "settings": {"mode": "eigenvalue", "particles": 1000, "batches": 100, "inactive": 20},
                        "tallies": [],
                    }
                ),
                encoding="utf-8",
            )

            result = generate_inputs(root)
            self.assertTrue(result["ok"])
            geometry = (root / "generated" / "geometry.xml").read_text(encoding="utf-8")
            self.assertIn("z-cylinder", geometry)
            self.assertTrue("lattice" in geometry)
            self.assertIn("Fuel Pin", geometry)
            self.assertIn("Assembly 1", geometry)
            self.assertIn("core lattice", geometry)

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


def subprocess_result(returncode: int, stdout: str):
    return type("CompletedProcess", (), {"returncode": returncode, "stdout": stdout})()


if __name__ == "__main__":
    unittest.main()
