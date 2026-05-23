# OpenMC Studio

OpenMC Studio is a lightweight Windows and Linux desktop GUI for building, validating, running, and analyzing OpenMC models.

The product is designed around a generic reactor modeling engine, so presets such as PWR, BWR, CANDU, HTGR, fast reactors, MSR, SMR, research reactors, irregular custom cores, and shielding/fixed-source cases all map to the same canonical project format.

## Architecture

- `apps/desktop`: Tauri + React desktop shell.
- `packages/schema`: shared TypeScript model and unit-conversion foundation.
- `services/openmc-worker`: Python 3.10+ worker for environment detection and OpenMC execution.

## Lightweight Strategy

- Tauri instead of Electron.
- Python worker is started on demand and can shut down when idle.
- Model data is hierarchical and instance-based to avoid duplicating large core geometry.
- Large views will use level-of-detail rendering and virtualized tables.

## Development

```bash
npm install
npm run typecheck
npm test
npm run dev
```

The Python worker currently uses only the standard library.

---

## Sponsor

If this project helps you, you can support ongoing development:

[![Saweria](https://img.shields.io/badge/Support-Saweria-FF5722?style=flat-square&logo=wallet)](https://saweria.co/rinopatrick)
[![Ko-fi](https://img.shields.io/badge/Support-Ko--fi-FF5E5B?style=flat-square&logo=kofi)](https://ko-fi.com/rinopatrick)
