#!/usr/bin/env bash
# Run the FastAPI service and the Next.js dev server side by side.
# Both servers log to the same terminal; Ctrl-C stops both.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

# Cleanly kill children when the script exits (Ctrl-C, error, normal end).
trap 'kill 0' EXIT INT TERM

echo "→ starting FastAPI on http://127.0.0.1:8000"
uv run firefly api --port 8000 &

echo "→ starting Next.js on http://127.0.0.1:3000"
(cd web && npm run dev) &

wait
