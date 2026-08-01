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

## ⛔ Never restart clisbot with `clisbot stop` / `clisbot start`

clisbot runs under a **systemd user unit** with `Restart=always`, `RestartSec=15`,
`Type=forking`. Stopping it with the CLI kills the process systemd is supervising,
so systemd schedules **its own restart 15s later** — which collides with the
instance you started by hand. The loser cannot bind the web-channel port:

```
error listen EADDRINUSE: address already in use 0.0.0.0:3099
```

Repeated collisions burn `StartLimitBurst` (5 in 120s) and can leave the service
**dead altogether**. This broke the bot on 2026-07-12 (log ~04:42) and had to be
debugged out of band.

**Always let systemd own the lifecycle:** `systemctl --user restart clisbot.service`.
`deploy.sh` does this now — don't "simplify" it back.

---

## ⚠️ `fix/tmux-submit-false-negative` — INTERIM. Upstream already fixed this, better.

**Upstream `afbd173` (in 0.1.54-beta.3) fixes the same bug, and its fix is
strictly better than ours. Drop this patch on upgrade — do not port it forward.**

Upstream reached the identical diagnosis, in almost the same words:

> *"The previous 160ms/320ms windows produced false TmuxSubmitUnconfirmedError
> under host load or slow CLI redraws even though Enter had truthfully submitted."*

They widened the window to **600ms** — but they also fixed the half we did not.
Our patch treats *any* pane change as proof of submission. Upstream points out
that this is **not submission truth**: Enter can land as a *newline inside the
composer*, which changes the pane while the prompt stays unsent. So they added
`waitForSubmitSettled`, which reports `"submitted"` only when the pane changed
**and** the prompt text is no longer sitting in the composer, and classifies the
other outcomes as `"pending-input"` vs `"unchanged"` — retrying Enter up to 3
times, the way a manual `/nudge` would heal it.

That composer-drain check is the part our patch lacks. It is a heuristic tuned
against real CLI redraws (`paneShowsPendingComposerText`), and hand-porting it
blind was judged not worth the risk of *losing* prompts. We keep only the window
widening, which is a strict improvement over 160ms and adds no new logic.

**We use 3s where upstream uses 600ms** — a deliberate divergence: this host runs
Claude Code, Playwright and several MCP servers, so redraws are slower here than
upstream's baseline. Revisit on upgrade.

**Real fix = upgrade the fork to 0.1.54-beta.3.** That also lands voice/audio
upstream (so `feat/telegram-voice-audio-attachments` can be dropped too). Upstream
has since restructured `src/channels/` heavily (api, catalog, integration,
results, zalo…), so the **web channel needs porting** — that upgrade is a real
piece of work, not a drive-by.

### Original write-up (still accurate on cause)

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

**Upstream-worthy:** no longer — upstream fixed it independently and better (see above).

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

## `fix/pane-settlement-prompt-leak` — the injected `<system>` block posted into chats

**Symptom.** Bots periodically post their own system prompt into the conversation
— the whole `<system>` envelope, reply-command instructions and all — as if the
agent had sent it. The agent never called `message send`. Became frequent right
after the 0.1.43 → 0.1.54-beta.3 upgrade (Bob, 2026-08-01).

**Cause.** Upstream, not ours — `1620e79` ("harden queued message delivery",
Long Luong), present verbatim in `v0.1.54-beta.3`. When a run finishes without a
recorded message-tool final reply, `interaction-processing.ts` settles from the
**tmux pane snapshot**, and the pane still shows the prompt clisbot just typed
into it. Two 0.1.54 changes push far more runs down that path:
1. `shouldSkipEmptyCompletionSettlement` requires `nextState.body.trim() === ""`.
   0.1.43 bailed unconditionally on `!paneManagedDelivery && messageToolPreviewHandedOff`,
   so a **non-empty** pane is now delivered where it used to be dropped.
2. `waitForMessageToolFinalReply` gained a freshness requirement on
   `messageToolFinalReplyAt` bounded by a 3 s `MESSAGE_TOOL_FINAL_GRACE_WINDOW_MS`.
   0.1.43 raced it against the run result with no deadline.

**The guard cannot fire under Claude Code — lead with this in the PR.** `body` is
`snapshot.trim()` (`rendering.ts:28`), i.e. the *entire tmux pane*, so
`nextState.body.trim() === ""` requires a **completely blank pane**. Measured on a
live idle Claude Code session: **1274 non-whitespace characters** — the TUI keeps an
input box, status line and permission-mode line on screen permanently. The condition
is written for a CLI that exits or clears the screen on completion; under Claude Code
it is never true, so the skip never runs and every message-tool run that misses the
3 s window dumps the pane. Consistent with upstream being developed Codex-first.

**Fix.** `stripEchoedAgentPrompt()` in `agent-prompt.ts` removes any `<system>`
block carrying one of our own prompt markers, tolerates a truncated block with no
closing tag, and drops bare `<user>` tag lines; `settleFromPaneResult` suppresses
the message entirely when nothing survives. Blocks **without** a marker are left
alone so a genuine reply that mentions `<system>` still delivers. 6 tests in
`test/agent-prompt.test.ts`.

**Upstream-worthy:** yes. Nothing addresses it as of 2026-08-01 — 4 open PRs (none
on settlement), 2 issues total (#14 is Claude-adjacent but is about permission
prompts), no commits on `origin/main` touching `interaction-processing.ts` or
`rendering.ts`, and a GitHub-wide code search for the guard returns exactly one
hit: upstream's own file. We would be first, so the PR has to carry its own
evidence — lead with the 1274-char pane measurement.

**⚠️ A per-CLI template field does NOT fix this leak — corrected 2026-08-01.**
`captureLines` defaults to **160**, so the snapshot is 160 lines of *scrollback*,
not the visible screen. A live pane captured that way holds 4 prompt-echo markers:
the echoed prompt is genuine scrollback **content**, not TUI chrome. Any
"is this pane effectively empty" predicate sees 160 lines of real content and
delivers it. The idiom note below is about how upstream expresses per-CLI pane
knowledge — useful, but aimed at a different problem than this bug.

**The root, and what the PR should argue.** On a `responseMode: "message-tool"`
route the contract is that the agent replies via the tool, so a scrollback dump is
never a correct user-facing reply — clean or not. With no recorded reply the right
behaviour is to send nothing, or a short "run finished without a reply" note.
0.1.43 did that in one line; 0.1.54 broke it twice over — narrowed the bail to
empty panes **and** capped reply detection at 3 s where 0.1.43 waited for the run.
Either alone would have been survivable.

**Before writing the PR**, determine which trigger produced the observed leak:
the agent never called the tool, or it called it and the record landed after the
3 s window. Different fixes; don't guess.

**Upstream's per-CLI idiom (for reference, not for this fix).**
`DEFAULT_AGENT_TOOL_TEMPLATES` (`config/runtime/agent-tool-presets.ts`) is where
per-CLI differences live, as *data* rather than scattered `if (tool === "claude")`.
It already carries the exact analogue: `startupReadyPattern`, a per-CLI regex
matched against the pane (codex `(?:^|\s)›\s`, gemini `Type your message or
@path/to/file`, **claude: unset**), plus gemini-only `startupBlockers`. So
"recognise this CLI's screen state" is established, declarative and per-tool —
sitting next to `paneShowsRunnerExitSentinel` / `paneShowsResumeRejected`.

A new `AgentToolTemplate` field — idle-chrome pattern, or a per-CLI
"is this pane effectively empty" predicate — is far likelier to land than a strip
function that hardcodes clisbot's own prompt text. Caveat: the table is dominant
but not absolute; `buildRunnerFromToolTemplate` still special-cases
`if (toolId === "codex")`.

Keep this sanitizer locally either way — it holds regardless of CLI or timing
path and costs nothing. Propose the template field; run the belt-and-braces.

**Corroborating the Codex-first read** (structural, not inference from one bug):
in that same table `claude` is the thinnest of the three entries — no
`startupReadyPattern`, and `capture.mode: "off"` where codex and gemini both
capture session IDs. Recent upstream commits before the release are likewise
codex-focused ("classify resume and codex state-db startup failures", "track
codex runner stability strategy").

---

## Carried from before

- `feat/telegram-voice-audio-attachments` — voice/audio downloads. **Upstream now
  has this** (`TelegramVoice` is on `origin/main`), so drop this patch on upgrade.
- `feat/web-channel` — WebSocket channel for the A2UI/kanban webapp. Carries 9
  pre-existing `tsc` errors (`"web"` not in the `"slack" | "telegram"` platform
  union). They predate these patches; `bun build` does not typecheck, so it ships.
  Worth fixing before any upstream PR of the web channel.
