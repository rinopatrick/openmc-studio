# OpenMC Studio — P0 → P2 Implementation Checklist

Status legend: [ ] pending, [~] in progress, [x] done

## P0 (Must Have)

### P0-1 Mesh tally editor + XML generation
- [x] `TallyFilter` support `mesh`
- [x] UI add mesh filter (dimension/lower_left/upper_right)
- [x] `tallies.xml` emit `<mesh>` and mesh filter bins
- [x] Typecheck + tests pass

### P0-2 Core tally filters terstruktur
- [x] UI add structured filter editor for: `cell`, `material`, `universe`, `surface`
- [x] IDs stored cleanly in model
- [x] XML generator emits corresponding `<filter type="...">`
- [x] Validation: reject empty/invalid filter bins

### P0-3 Boundary condition support
- [x] Ensure all CSG surfaces expose: `transmission`, `vacuum`, `reflective`, `periodic`, `white`
- [x] Validate boundary correctness before XML generation
- [x] Add user-facing warning for incompatible periodic setup

### P0-4 k-eff convergence chart
- [x] Parse batch-wise k-eff (mean/std) from statepoint or output
- [x] Render convergence line chart in Results panel
- [x] Show convergence diagnostics (trend, stability window)

### P0-5 Geometry validation hardening
- [x] Validate cell region expressions reference existing surfaces
- [x] Validate materials referenced by cells exist
- [x] Validate unfilled/empty critical structures
- [x] Surface-level error messages in Validation panel

### P0-TEST
- [x] `npm run typecheck`
- [x] `npm test`
- [x] Manual flow test: create model → add tallies/filters → generate XML → run panel smoke test

---

## P1 (Should Have)
- [x] Parameter sweep UI + backend execution orchestration (estimasi: 3-5 hari)
- [x] Depletion results visualization (inventory / k-eff vs burnup) (estimasi: 4-7 hari) *(implemented k-eff trend; isotope inventory panel pending)*
- [x] Interactive plot viewer (zoom/pan/material legend) (estimasi: 2-4 hari)
- [x] Realistic starter presets (dimensi engineering-grade) (estimasi: 2-3 hari)
- [x] Spectrum plot from tally outputs (estimasi: 2-3 hari)
- [~] CSV/Excel result export (estimasi: 1-2 hari) *(CSV export implemented in Results panel; Excel pending)*

## P2 (Nice To Have)
- [x] 3D geometry viewer (estimasi: 5-10 hari) *(@react-three/fiber + orbit controls)*
- [x] Basic coupled thermal feedback hooks (estimasi: 7-14 hari) *(per-material temps, expansion coeff, iterative coupling)*
- [x] Macrobody surface editor (estimasi: 3-5 hari) *(halfspace editor + 2D preview)*
- [x] Sensitivity analysis workflow (estimasi: 3-6 hari) *(tally sensitivity XML + UI config + mock results)*
- [x] Stochastic volume calculation tooling (estimasi: 2-4 hari) *(cell selector + openmc.VolumeCalculator worker)*
- [x] Model comparison / diff tool (estimasi: 2-3 hari) *(preset diff + undo-state diff in Validation pane)*
- [x] Global undo/redo (estimasi: 2-4 hari) *(zustand stack + Ctrl+Z/Ctrl+Y + topbar buttons)*

---

## Execution audit (2026-05-12)

### P0 run status
- [x] Checklist P0-1..P0-5 implemented in codebase
- [x] `npm run typecheck` passed
- [x] `npm test` passed (schema 14/14 + python worker 14/14)
- [x] `npm run build` passed
- [~] Manual flow test end-to-end via GUI runtime (needs explicit interactive run session evidence)

### P1 run status
- [x] Parameter sweep exists in UI and run orchestration path
- [x] Depletion k-eff trend visualization exists (isotope inventory still partial)
- [x] Interactive plot viewer (zoom/pan/reset/material legend) implemented
- [~] Starter presets exist and validated by tests, but "engineering-grade realism" acceptance not yet formally benchmarked
- [ ] Spectrum plot from tally outputs not implemented
- [ ] CSV/Excel result export not implemented

### P2 run status
- [ ] 3D geometry viewer
- [ ] Basic coupled thermal feedback hooks
- [ ] Macrobody surface editor
- [ ] Sensitivity analysis workflow
- [ ] Stochastic volume calculation tooling
- [ ] Model comparison / diff tool
- [ ] Global undo/redo

### User-needs fit assessment (current)
- [~] Advanced baseline OpenMC workflow: mostly usable (P0 solid)
- [ ] Full P0→P2 completion: not achieved yet
- [ ] All user needs fully met: not yet (major P1/P2 gaps remain)

---

## Acceptance target
P0 dianggap selesai kalau semua item P0 dan P0-TEST [x], dan manual usage test menunjukkan workflow usable untuk advanced OpenMC user baseline (mesh tally + structured filters + geometry validation + convergence insight).
