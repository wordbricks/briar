#!/bin/bash
set -euo pipefail

workspace_root="$(cd "$(dirname "$0")/.." && pwd -P)"
worker_port="8788"
worker_url="http://127.0.0.1:$worker_port"
worker_pid=""
app_pid=""

terminate_tree() {
  local parent_pid="$1"
  local child_pid

  for child_pid in $(pgrep -P "$parent_pid" 2>/dev/null || true); do
    terminate_tree "$child_pid"
  done
  kill "$parent_pid" 2>/dev/null || true
}

cleanup() {
  trap - EXIT INT TERM
  if [[ -n "$app_pid" ]] && kill -0 "$app_pid" 2>/dev/null; then
    terminate_tree "$app_pid"
  fi
  if [[ -n "$worker_pid" ]] && kill -0 "$worker_pid" 2>/dev/null; then
    terminate_tree "$worker_pid"
  fi
  [[ -z "$app_pid" ]] || wait "$app_pid" 2>/dev/null || true
  [[ -z "$worker_pid" ]] || wait "$worker_pid" 2>/dev/null || true
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

cd "$workspace_root"

echo "[briar] Worker secrets and local D1 migrations"
bun run secrets:check
bun run d1:migrate:local

if lsof -nP -iTCP:"$worker_port" -sTCP:LISTEN >/dev/null; then
  echo "[briar] Port $worker_port is already in use." >&2
  exit 1
fi

echo "[briar] Starting local Worker at $worker_url"
BRIAR_WORKER_DEV_PORT="$worker_port" bun run worker:dev &
worker_pid=$!

worker_ready=false
for _ in $(seq 1 80); do
  if curl --silent --fail --max-time 1 "$worker_url/health" >/dev/null; then
    worker_ready=true
    break
  fi
  if ! kill -0 "$worker_pid" 2>/dev/null; then
    wait "$worker_pid"
    exit $?
  fi
  sleep 0.25
done

if [[ "$worker_ready" != "true" ]]; then
  echo "[briar] Local Worker did not become ready within 20 seconds." >&2
  exit 1
fi

echo "[briar] Starting Tauri app. Press Ctrl+C to stop both processes."
VITE_BRIAR_API_URL="$worker_url" \
VITE_BRIAR_DEMO=false \
bun tauri dev &
app_pid=$!

while kill -0 "$worker_pid" 2>/dev/null && kill -0 "$app_pid" 2>/dev/null; do
  sleep 1
done

if ! kill -0 "$worker_pid" 2>/dev/null; then
  echo "[briar] Local Worker stopped. Shutting down the app." >&2
  if wait "$worker_pid"; then
    exit 0
  else
    exit $?
  fi
fi

if wait "$app_pid"; then
  exit 0
else
  exit $?
fi
