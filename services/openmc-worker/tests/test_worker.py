from __future__ import annotations

import unittest

from openmc_worker.cli import detect_candidates, health_check


class WorkerTests(unittest.TestCase):
    def test_detect_candidates_returns_python_module_candidate(self) -> None:
        candidates = detect_candidates()
        self.assertTrue(any(candidate.kind == "python-module" for candidate in candidates))

    def test_health_check_handles_missing_command(self) -> None:
        result = health_check({"command": ["definitely-missing-openmc-command"]})
        self.assertFalse(result["ok"])
        self.assertTrue(any(check["id"] == "openmc-version" for check in result["checks"]))


if __name__ == "__main__":
    unittest.main()
