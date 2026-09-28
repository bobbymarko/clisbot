# Upstream integration — September 28

The running installation uses `/home/bobbymarko/clisbot-integration-20260928`,
branch `burro/upstream-integration-20260928`. Bobby authorized the cutover; the
latest deployed executable is built from `23ccbe5d8`. All bots still use tmux.
Bobby chose to retain tmux rather than migrate Burro to ACP.

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
rendering, even when its prompt has scrolled away. Real answer text, quota errors,
and standalone usage-reset recovery instructions remain visible; idle
reset-availability banners are filtered. This fixes footer leakage; it does not
prove that a quota-blocked turn is classified correctly or that pending prompts survive quota
recovery. Those behaviors still require controlled runner validation.

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
`.env`, so end-to-end chat delivery and quota recovery remain untested.
Authenticated runner-only checks are recorded below.

## Isolated live runner checks

Real Codex 0.157.1 (Astra) and Claude Code 2.1.283 (Opus 5.5) were launched on a
separate tmux socket and temporary test workspace. The candidate's actual submit
and monitor code sent tool-free prompts and captured both expected responses.
This exposed two additional completion formats: an indented bare clock before
the Codex composer, and Claude's variable-verb `... for 1s · done 10:30 PM` footer.
Both are now removed with contextual/structural matching; ordinary answer times
remain intact. Fresh live roundtrips returned the expected marker with no footer.
The 75 targeted transcript/settlement tests pass after these fixes. These checks
validate authenticated runner submission and capture, not end-to-end Telegram
delivery, quota exhaustion/recovery, or switching the running service.

Post-cutover reports also exposed the time-only `Worked for ... · 10:37 PM`
variant and the reset-availability banner. Both are now filtered, including
terminal-wrapped availability text. Actual quota-exhaustion errors and standalone
recovery instructions remain visible. No usage reset is consumed by these fixes.

## Deployment and remaining validation

The original 15 files were subsequently committed unchanged in the original
checkout as `8ca009b48`; that ancestry is merged into this branch. The original
checkout and executable are retained for rollback.

The authorized cutover switched the global package entry to this worktree and
restarted the service. Verification confirmed a new service PID, five Telegram
pollers, and the generated CLI wrapper pointing at this worktree. Subsequent
footer and banner fixes were deployed through the same detached restart flow.
No bot backend, route, or persisted session configuration was migrated.

Explicit Telegram sends have succeeded in the ongoing conversation. This does
not establish that automatic runner completion delivery or interrupted-turn
recovery is reliable. A reported interrupted turn had no substantive assistant
answer in the pane. A service restart overlapped the incident, but the exact
cause is unproven. Telegram reactions only record context for the next prompt;
the reaction handler does not interrupt the runner.

Remaining validation: reproduce missing completion delivery and restart recovery
in an isolated runtime, then verify quota-blocked prompt recovery. Filtering
terminal chrome is not a substitute for these checks. ACP migration is declined;
its authenticated adapter and saved-session resume checks are outside this work.

Runtime logs and test captures are retained in the Burro workspace under
`artifacts/clisbot-integration-20260928/`. The deployment receipt there records
the executable revision separately from subsequent documentation commits.

Final integration gate after all footer/banner fixes: `bun run check` passed
typecheck and 1,070 tests across 127 files, with zero failures. No executable
changes followed the previously verified build at `23ccbe5d8`.
