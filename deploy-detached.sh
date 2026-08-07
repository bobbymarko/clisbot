#!/usr/bin/env bash
# deploy-detached.sh — run deploy.sh from a transient systemd unit, not from an agent shell.
#
# Why this exists: ./deploy.sh restarts clisbot.service, which SIGKILLs the shell of whatever
# agent invoked it (exit 137, dead tool call, and the deploy looks like it failed when it
# didn't). Launching it via `systemd-run --user` puts it in its OWN cgroup, so the restart
# takes down clisbot without touching the process performing the restart.
#
# PATH is set explicitly: systemd-run --user runs under the user MANAGER's environment, not
# the caller's, so ~/.clisbot/bin and the bun/npm-global dirs are absent and both `bun run`
# and the closing `clisbot status` would fail. Same class of trap as cron -- see
# [[feedback_cron_path]]. Unlike cron, the user bus IS present here (systemd-run needs it to
# start the unit at all), so `systemctl --user restart` inside deploy.sh works.
#
# Usage: ./deploy-detached.sh [delay-seconds]   (default 120)
set -euo pipefail

DELAY="${1:-120}"
LOG=/home/bobbymarko/clisbot-src/deploy-detached.log

# Stamp the SCHEDULING too, not just the outcome. A log that only gets written on completion
# is indistinguishable from a job that never started -- exactly the failure that made two
# automations read "stale" for three days. See [[feedback_silent_success_reads_as_stale]].
echo "=== $(date -Is) scheduling deploy in ${DELAY}s (HEAD $(git -C /home/bobbymarko/clisbot-src rev-parse --short HEAD)) ===" >> "$LOG"

systemd-run --user \
  --unit="clisbot-deploy-$(date +%s)" \
  --description="Detached clisbot deploy (agent-scheduled)" \
  --on-active="${DELAY}" \
  --timer-property=AccuracySec=1s \
  --setenv=PATH="/home/bobbymarko/.clisbot/bin:/home/bobbymarko/.npm-global/bin:/home/bobbymarko/.local/bin:/home/bobbymarko/.bun/bin:/usr/local/bin:/usr/bin:/bin" \
  --setenv=HOME=/home/bobbymarko \
  /bin/bash -c "/home/bobbymarko/clisbot-src/deploy.sh >> '$LOG' 2>&1; echo \"=== \$(date -Is) deploy exited rc=\$? ===\" >> '$LOG'"

echo "scheduled; watch: tail -f $LOG"
