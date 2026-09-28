# Upstream integration candidate — September 28

This candidate is prepared in `/home/bobbymarko/clisbot-integration-20260928`.
It is not the running installation. Do not restart the service from this checkout
until the operator authorizes the switch.

## Sources preserved

- Live base: `3f0a8ce61`, with 21 fork commits after `9d4207d4a`.
- All 15 modified/untracked source and test files from the live tree were copied
  and checkpointed at `c1674fb98` before merging. The original files were not staged,
  reset, stashed, or changed.
- Upstream `origin/main`: `21baca297` (21 upstream commits after the common base).
- Upstream's ACP adapters, provider catalog, steering fallback, and web event feed
  are included. Existing tmux remains available; no bot backend is migrated here.

## Conflict decisions

Both prompt echo protection and upstream steer-redirect templates are retained.
The deleted session-handshake module follows upstream's split: the configurable
submit-confirm wait and typed intent were ported to `tmux/submit-input.ts`.
Typed intent is limited to panes identified as Claude, with a Codex/Claude regression.
Telegram locations, API/Web integrations, preview controls, video attachment support,
reaction context, and bot-addressing guidance remain in the candidate.

## Codex footer regression

The dated `Worked for ... · Sep 26 at 2:33 PM` terminal footer is removed before
rendering, even when its prompt has scrolled away. Real answer text and usage-reset
guidance remain visible. This fixes footer leakage; it does not prove that a
quota-blocked turn is classified correctly or that pending prompts survive quota
recovery. Those behaviors require a controlled runner validation before cutover.

## Cutover boundary

The first full check had 1,066 passing tests and one failure in interrupted-run
recovery. That test passed on two isolated reruns, but investigation found a
reproducible lifecycle race: completion awaiting session identity capture could
resume after interruption and delete the replacement run. A deterministic
regression failed before the fix; completion now rechecks run identity after
capture and before removal. The second full check passed both recovery tests,
with 1,067 passes and one different failure: persisted queue ordering. The queue
test originally passed alone. Freezing only the incoming admission timestamp to
the saved item's timestamp reproduced the failure deterministically. The queue
now gives restored entries precedence on timestamp ties while preserving
chronological order and enqueue order within each group. The 19 focused queue
tests pass. The full gate now passes: 1,069 tests, zero failures, plus typecheck.
The package build also passes.

Naming review: `restored` describes in-memory queue-entry provenance owned by
`AgentJobQueue`, supplied only by persisted-item reconciliation. The focused
inventory found no conflicting use in `src/agents/queue`; no public or persisted
field changes or migrations are required. The runtime architecture records the
ordering contract. This is not a general priority mechanism.

Typecheck, package build, 56 focused message/transcript tests and eight submit
tests passed. No configured test-surface variables were found in the live repo's
`.env`, so authenticated Claude/Codex delivery and quota recovery remain untested.

Offline tests/build use this worktree and a separate CLISBOT_HOME. No production
config, session store, bot route, package symlink, or running process is changed.
Before switching: compare the live tree to the saved snapshot again, carry any new
changes forward, run controlled Claude and Codex conversations on configured test
surfaces, and validate quota-blocked handling. Review state/config compatibility
and retain the current executable as rollback. ACP requires its own authenticated
smoke test before selecting it for a bot.
