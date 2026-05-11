from __future__ import annotations

import unittest
import json
import tempfile
from pathlib import Path

from openmc_worker.cli import detect_candidates, generate_inputs, health_check


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


if __name__ == "__main__":
    unittest.main()
