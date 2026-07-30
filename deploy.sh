#!/usr/bin/env bash
# deploy.sh — rebuild and restart clisbot backend
# Usage: ./deploy.sh
set -e

cd "$(dirname "$0")"

# Typecheck IS a usable gate now. The 9 errors the old web-channel branch carried
# came from ChannelId being a closed "slack" | "telegram" union; upstream widened
# it to string, so the tree is clean and a regression here should stop the deploy.
echo "[deploy] Typechecking..."
bun run typecheck

echo "[deploy] Building backend..."
# bun is this repo's package manager (CLAUDE.md / AGENTS.md: `bun run build`).
bun run build
# dist/main.js is symlinked from ~/.npm-global/.../clisbot/dist/main.js — no copy needed

# clisbot runs under the systemd user unit (Restart=always). Restart through
# systemd — a bare `clisbot stop`/`clisbot start` here races the unit's own
# restart and leaves two monitors sharing one pid file, socket, port 3099, and
# the same Telegram tokens.
echo "[deploy] Restarting clisbot via systemd..."
systemctl --user restart clisbot.service

echo "[deploy] Done."
systemctl --user is-active clisbot.service
clisbot status | grep -E "running:|state:"
