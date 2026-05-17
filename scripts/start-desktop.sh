#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_FILE="/tmp/openmc-tauri.log"
PID_FILE="/tmp/openmc-tauri.pid"

if [[ -f "$PID_FILE" ]]; then
  OLD_PID="$(cat "$PID_FILE" || true)"
  if [[ -n "$OLD_PID" ]] && kill -0 "$OLD_PID" 2>/dev/null; then
    kill "$OLD_PID" || true
    sleep 1
  fi
fi

cd "$ROOT_DIR/apps/desktop"
nohup npm run tauri -- dev >"$LOG_FILE" 2>&1 &
NEW_PID=$!
echo "$NEW_PID" >"$PID_FILE"

sleep 3
if ! kill -0 "$NEW_PID" 2>/dev/null; then
  echo "FAILED"
  tail -n 100 "$LOG_FILE" || true
  exit 1
fi

echo "OK:$NEW_PID"
tail -n 40 "$LOG_FILE" || true
