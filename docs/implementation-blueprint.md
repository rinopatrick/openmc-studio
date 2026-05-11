# OpenMC Studio Implementation Blueprint

## v1 Scope

- Windows and Linux desktop app.
- Generic reactor topology builder with presets for common reactor families and shielding/fixed-source cases.
- Custom irregular reactor shapes as first-class models.
- Top-view and sectional-view 2D editing.
- Geometry and physics sanity validation from the early product phase.
- OpenMC auto-detection, manual environment profiles, run orchestration, results, and advanced derived metrics.

## Core Workflows

1. Detect or configure OpenMC.
2. Create a preset or custom project.
3. Define materials, hierarchy, lattices, geometry primitives, and physics bindings.
4. Validate geometry and physics inputs.
5. Generate OpenMC artifacts.
6. Run locally and monitor logs/progress.
7. Analyze base results and advanced derived metrics.
8. Export reproducible project bundles and reports.

## Performance Targets

- Cold start target: under 2.5 seconds.
- Idle memory target: under 220 MB.
- Typical editor action target: under 200 ms.
- No persistent heavy backend process while idle.
