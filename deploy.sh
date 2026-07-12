#!/usr/bin/env bash
# deploy.sh — rebuild and restart clisbot backend
# Usage: ./deploy.sh
set -e

cd "$(dirname "$0")"

echo "[deploy] Building backend..."
npm run build
# dist/main.js is symlinked from ~/.npm-global/.../clisbot/dist/main.js — no copy needed

echo "[deploy] Stopping clisbot..."
clisbot stop || true
sleep 2

echo "[deploy] Starting clisbot..."
clisbot start

echo "[deploy] Done."
clisbot status | grep -E "running:|state:"
