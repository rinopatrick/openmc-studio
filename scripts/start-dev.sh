#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_FILE="/tmp/openmc-dev.log"
PID_FILE="/tmp/openmc-dev.pid"
BRIDGE_LOG_FILE="/tmp/openmc-worker-bridge.log"
BRIDGE_PID_FILE="/tmp/openmc-worker-bridge.pid"

if [[ -f "$PID_FILE" ]]; then
  OLD_PID="$(cat "$PID_FILE" || true)"
  if [[ -n "$OLD_PID" ]] && kill -0 "$OLD_PID" 2>/dev/null; then
    kill "$OLD_PID" || true
    sleep 1
  fi
fi

if [[ -f "$BRIDGE_PID_FILE" ]]; then
  OLD_BRIDGE_PID="$(cat "$BRIDGE_PID_FILE" || true)"
  if [[ -n "$OLD_BRIDGE_PID" ]] && kill -0 "$OLD_BRIDGE_PID" 2>/dev/null; then
    kill "$OLD_BRIDGE_PID" || true
    sleep 1
  fi
fi

cd "$ROOT_DIR"

cd "$ROOT_DIR/services/openmc-worker"
nohup python3 -m openmc_worker.bridge --host 127.0.0.1 --port 8765 >"$BRIDGE_LOG_FILE" 2>&1 &
BRIDGE_PID=$!
echo "$BRIDGE_PID" >"$BRIDGE_PID_FILE"
cd "$ROOT_DIR"

nohup npm --workspace apps/desktop run dev -- --host 0.0.0.0 --port 1420 --strictPort >"$LOG_FILE" 2>&1 &
NEW_PID=$!
echo "$NEW_PID" >"$PID_FILE"

sleep 2
if ! kill -0 "$NEW_PID" 2>/dev/null; then
  echo "FAILED"
  tail -n 100 "$LOG_FILE" || true
  exit 1
fi

echo "OK:$NEW_PID"
tail -n 20 "$LOG_FILE" || true
tail -n 20 "$BRIDGE_LOG_FILE" || true
