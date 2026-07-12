---
date: 2026-05-29
title: Session-key migrations orphan persisted loops
area: persistence
summary: Managed loops are persisted and re-armed on boot, but they are matched by session key. A migration that changes session-key or agent shape silently orphans existing loops, so any such migration must carry a loop key-rewrite step.
related:
  - src/agents/agent-service.ts
  - src/agents/session-key.ts
  - src/agents/session-store.ts
  - src/agents/loop-state.ts
---

## Context

Managed interval/calendar loops persist as `intervalLoops` on each session
entry in `~/.clisbot/state/sessions.json`. On startup,
`reconcilePersistedIntervalLoops` (`src/agents/agent-service.ts`) reloads them
and re-arms timers, so an ordinary daemon restart or version bump keeps loops
running.

## What Went Wrong Or What Was Learned

After an update, all of an operator's scheduled loops disappeared and had to be
recreated with new IDs.

Loops are keyed and re-attached by **session key** (e.g.
`agent:<id>:telegram:dm:<chat>`). When a migration changes how the session key
or agent shape is derived (as `Migrate bot-oriented config internals` reshaped
`session-key.ts` and `loop-state.ts`), the persisted loop entries still exist
but no longer match any current session key. `reconcilePersistedIntervalLoops`
finds no match, the loops are never re-armed, and they are effectively dropped —
silently, with no error and no operator notice.

This is not "loops don't survive restarts." It is specifically migrations that
alter session-key or agent identity.

## Rule Going Forward

When a change alters session-key derivation, agent IDs, or loop state shape:

- include an explicit migration step that rewrites persisted `intervalLoops`
  (and their session entries) from the old key form to the new one
- never assume `reconcilePersistedIntervalLoops` will recover loops across a
  key-format change — by definition it cannot match them
- surface a startup warning when persisted loops fail to match any live session
  key, instead of dropping them silently
- treat loop loss as operator-visible: prefer an alert over silent reconciliation
