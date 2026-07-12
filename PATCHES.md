# Local patches (bobbymarko fork)

Tracks what this fork carries on top of upstream `longbkit/clisbot`, so a rebase
onto a new upstream release does not silently drop a fix.

- `origin` → https://github.com/longbkit/clisbot (upstream)
- `fork` → git@github.com:bobbymarko/clisbot.git (ours)
- `nova-main` → the integration branch that is actually **built and deployed**.
  It is `feat/web-channel` plus every topic branch below.

Deploy: `./deploy.sh` (builds `dist/main.js`, restarts clisbot).
`~/.npm-global/lib/node_modules/clisbot/dist/main.js` is a **symlink** to
`clisbot-src/dist/main.js`, so a build alone is enough to arm the next restart —
there is no copy step, and a crash-restart will pick up whatever was last built.

---

## `fix/tmux-submit-false-negative` — duplicate runs of a prompt sent once

**Symptom.** Scheduled loops posted their output twice (the Gmail digest most
visibly), and replies appeared that nobody had asked for. `~/.clisbot/state/clisbot.log`
carried 157 × `loop execution failed TmuxSubmitUnconfirmedError`.

**Cause.** `submitTmuxSessionInput` gave the pane **160 ms** to repaint after Enter
before declaring the submit unconfirmed. On a loaded host the runner routinely
takes longer, so a prompt that *was* delivered got reported as undelivered — and
`recoverPromptDeliveryFailure` reacts to `TmuxSubmitUnconfirmedError` by killing
the tmux session and re-running the prompt in a fresh one. One prompt, two runs.

The same 160 ms deadline also strangled the snapshot check: its 320 ms budget was
clamped by `Math.min(320, deadline - now)`, so it never got the window it was
written for.

**Fix.** `SUBMIT_CONFIRM_MAX_WAIT_MS` 160 ms → 3 s, in
`src/runners/tmux/session-handshake.ts`. The wait returns as soon as the pane
moves, so a healthy submit is no slower. A genuinely dead pane now raises after
~6 s instead of ~320 ms — failing slow is far cheaper than failing wrong here.

**Keep the Gmail digest idempotency lock** (STEP 0 in `~/code/CLAUDE.md`) as a
belt-and-braces guard until a few weeks of clean digests confirm this.

**Upstream-worthy:** yes — nothing here is specific to this deployment.

---

## `fix/telegram-location` — location pins were discarded

**Symptom.** Sharing a location with the bot did nothing: no coordinates ever
reached the agent, and a moving live pin was invisible.

**Cause.** Three gaps, all in the Telegram channel:
1. Nothing read `message.location`. A pin arrived with empty text and was
   correctly dropped by the existing empty-message guard (`service.ts`), so the
   coordinates went nowhere.
2. Polling requested `allowed_updates: ["message"]`. Live-location *movement* is
   delivered as `edited_message`, so it was filtered out at the API call.
3. There was no place to keep a last-known position.

**Fix.**
- Parse `location` / `venue` and fold the coordinates into the prompt text, so a
  dropped pin reaches the agent as `[location] <lat>, <lon>`.
- Request `edited_message`, but **act on it only when it carries a location**.
  Editing a text message must not re-run the agent on a prompt already sent.
- Persist last-known position per chat to `~/.clisbot/state/telegram-locations.json`
  (`TelegramLocationStore`, 24 h retention). Live pins report every few seconds;
  routing each one to the agent as a prompt would flood it, so **movement refreshes
  the store rather than prompting**. Agent tooling reads the file directly.

**Upstream-worthy:** yes.

---

## Carried from before

- `feat/telegram-voice-audio-attachments` — voice/audio downloads (merged upstream? verify on rebase).
- `feat/web-channel` — WebSocket channel for the A2UI/kanban webapp. Carries 9
  pre-existing `tsc` errors (`"web"` not in the `"slack" | "telegram"` platform
  union). They predate these patches; `bun build` does not typecheck, so it ships.
  Worth fixing before any upstream PR of the web channel.
