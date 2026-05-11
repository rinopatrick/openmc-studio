# OpenMC Worker

The worker is a lightweight Python 3.10+ command-line bridge used by OpenMC Studio.

It intentionally starts on demand so the desktop app does not carry a persistent backend memory cost while idle.

## Commands

```bash
python -m openmc_worker handshake
python -m openmc_worker detect-env
python -m openmc_worker health-check --json '{"openmcExecutable":"openmc"}'
```
