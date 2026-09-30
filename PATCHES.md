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

**Symptom.** Bots periodically post their own system prompt into the conversation —
the whole `<system>` envelope, reply-command instructions and all — as if the agent
had sent it. The agent never called `message send`. Became frequent right after the
0.1.43 → 0.1.54-beta.3 upgrade (Bob, 2026-08-01).

**Trigger, confirmed from the transcript — not inferred.** The 2026-08-01 12:53 UTC
Nova run (`99b7d88f…`, lines 31832-31852) did its work and then answered in **plain
text**; the only occurrence of "message send" in the whole run is inside the injected
prompt itself. So the agent **never called the message tool at all**. This is *not*
the 3 s detection race — detection cannot miss a reply that never happened.

**Why the pane fallback is right and must stay.** Nova's plain-text answer was a good
one the user needed (a $500 transaction correctly recategorised). With no fallback he
would have received **silence**. `settleFromPaneResult` exists to rescue an agent that
forgets the tool, and it is load-bearing. Reverting to 0.1.43's unconditional bail
would trade a leak for lost replies — a worse deal for the user.

**Root cause.** clisbot **writes a prompt into the pane, then reads that same pane back
as output without discounting its own injection.** The snapshot is 160 lines of
scrollback (`captureLines: 160`), so the echoed prompt is squarely inside it as
content. Everything else is a contributing factor, not the cause:
- `shouldSkipEmptyCompletionSettlement` requires `nextState.body.trim() === ""`, and
  `body` is `snapshot.trim()` — the whole pane. Measured on a live idle Claude Code
  session: **1274 non-whitespace characters**. The guard can never fire under a CLI
  with a persistent TUI, so it does no work here. (0.1.43 bailed unconditionally.)
- `waitForMessageToolFinalReply` caps detection at 3 s
  (`MESSAGE_TOOL_FINAL_GRACE_WINDOW_MS`) where 0.1.43 raced the run with no deadline.
  A real contributor to *other* instances; not this one.

**Fix.** `stripEchoedAgentPrompt()` in `agent-prompt.ts` removes any `<system>` block
carrying one of our own prompt markers, tolerates a truncated block with no closing
tag, and drops bare `<user>` tag lines. Blocks **without** a marker are left alone so a
genuine reply mentioning `<system>` still delivers. 6 tests in
`test/agent-prompt.test.ts`. Stripping text you injected yourself before reading it back
is correctness, not a band-aid — this is the principled fix, not containment.

### 2026-08-01, second leak: **the ordering was wrong** (`82a6c19`)

The above shipped, and the prompt leaked again the same evening. The stripper was
correct; **where it ran was not.**

`settleFromPaneResult` called it on *rendered* text. The interaction renderer, for a
`completed`-status body, **deletes angle-bracket tags while keeping the text inside
them.** So by the time the stripper saw the text, `<system>` was already gone — it
keyed on a tag that no longer existed, matched nothing, and passed the entire prompt
through. Reproduced deterministically: `status=running` → tag present → stripped clean;
`status=completed` → tag gone → **leaks**. That is exactly why Bob's screenshot began
mid-prompt at "You are operating inside clisbot." with no tag and no "Message context:"
header above it.

**Corrected fix, three parts:**
1. **Strip before rendering.** The call moved into `buildRenderedMessageState`
   (`rendering.ts`) — the one choke point every pane-derived body passes through, and
   the last point at which the tags still exist. All 3 call sites in
   `interaction-processing.ts` inherit it.
2. **Tag-independent backstop.** `containsEchoedAgentPrompt()` asserts on the prompt's
   *wording* (`ECHOED_PROMPT_MARKERS`), never its tags, so it still fires on
   renderer-mangled text. Use it as the assertion after stripping — **never** as the
   stripper itself.
3. **Two more delivery paths, previously unguarded.** The streaming `onUpdate` preview
   had no sanitization at all, and `SurfaceRuntime.notifyManagedQueueSettlement` posted
   `update.snapshot` raw. Both now covered.

**Also added: logging.** clisbot records **no outbound message bodies** —
`~/.clisbot/state/` has no message store and `clisbot.log` carries only errors and
lifecycle. All three leaks were discovered solely because the human saw them. Any
suppressed leak now `console.error`s with `sessionKey`, `agentId`, `chars`, and a
200-char head.

**Lesson, generally:** sanitize at the boundary where you *inject*, not where you
*deliver*. Anything between the two is free to reshape the text out from under your
matcher.

Regression coverage: `test/channel-rendering.test.ts` drives `buildRenderedMessageState`
across all four render statuses (`running`/`completed`/`timeout`/`detached`) — a
single-status test would have passed against the broken build.

**Upstream-worthy:** yes. Nothing addresses it as of 2026-08-01 — 4 open PRs (none on
settlement), 2 issues total (#14 is Claude-adjacent but about permission prompts), no
commits on `origin/main` touching `interaction-processing.ts` or `rendering.ts`, and a
GitHub-wide code search for the guard returns exactly one hit: upstream's own file. We
would be first, so the PR must carry its own evidence. Frame it as **keep the fallback,
exclude the injected prompt from what it delivers** — that takes nothing away from
users who depend on the rescue path.

**Dead ends — do not re-derive these.**
- *"Add a per-CLI idle-pane predicate to `AgentToolTemplate`."* Tempting, because
  `DEFAULT_AGENT_TOOL_TEMPLATES` really is where upstream puts per-CLI pane knowledge
  (`startupReadyPattern`: codex `(?:^|\s)›\s`, gemini `Type your message or
  @path/to/file`, claude unset; plus gemini-only `startupBlockers`). But the capture is
  scrollback, so the echoed prompt is *content*, not chrome — an "is this pane empty"
  predicate still delivers it. Right idiom, wrong problem.
- *"Restore 0.1.43's unconditional bail."* Costs the user real replies. See above.

**Corroborating the Codex-first read** (structural, not inference from one bug): in
that same table `claude` is the thinnest of the three entries — no
`startupReadyPattern`, and `capture.mode: "off"` where codex and gemini both capture
session IDs. Recent upstream commits before the release are likewise codex-focused
("classify resume and codex state-db startup failures", "track codex runner stability
strategy").

**~~Open, and not a clisbot bug~~ — MEASURED 2026-08-07, and half of it *is* a clisbot bug.**
Nova ignored an explicit instruction to reply via the tool. Measured across all four agents'
transcripts since Jul 24: reply rates **nova 89% (86 msgs), default 93% (184), cadence 95%,
four-threads 100%** — so yes, the fallback carries real weight, and the agent with the biggest
CLAUDE.md (1050 lines, 2.8x the next) leans on it hardest.

But `clisbot.log` also holds **32 `suppressed echoed clisbot prompt in pane settlement`
events** (default 21, nova 9, cadence 1, four-threads 1) sized **1937–2810 chars against a
~1900-char prompt** — several hundred characters of *something else* went over the side with
each of the larger ones. One lands within 60 s of a reply Bob independently reported never
receiving (2026-08-03 00:15 → suppression 00:16).

---

## `fix/pane-settlement-discards-real-replies` — the backstop was throwing away the answer

**Symptom.** A turn ends, the user gets silence, and clisbot records a final reply anyway.

**Cause.** `settleFromPaneResult` sanitises in one pass with `stripEchoedAgentPrompt`, which
is **purely tag-based** — it scans for `<system>`…`</system>`. On the
`renderPlatformInteraction` branch the body has *already been rendered*, and renderers delete
angle-bracket tags. So the stripper matches nothing and returns the text unchanged; the
tag-independent backstop then correctly fires and the caller drops **the entire body** —
including any genuine reply the agent wrote after the echo. This is the 2026-08-01 ordering
bug surviving on a second path: fix `82a6c19` moved stripping before rendering inside
`buildRenderedMessageState`, but this call site renders *again* from `nextState.body` and
strips after.

**Fix.** `stripInjectedPromptText(text, promptText)` in `agent-prompt.ts`, run as a first pass
before the existing stripper. It removes the span matching **the literal `<system>` envelope we
actually injected**, whitespace-normalised on both sides so tmux re-wrapping cannot defeat it,
and is a **strict no-op** when there is no match — worst case, behaviour is exactly as before.
It matches the system block only, never the `<user>` half, which is the user's own words and
may be absent or separately rendered.

⚠️ **This is NOT the marker-based stripper the entry above forbids.** It does not guess at what
looks prompt-shaped; it removes text we can prove we sent. That distinction is the whole design.

**Two mistakes caught by tests before shipping — both would have been silent in production:**
1. First draft used the whole `promptText` as the needle. The `<user>` block is not in the pane
   echo, so the match failed outright and the fix did nothing. A positive test caught it.
2. Second draft *called* `params.promptText` during settlement. It is a `string | (() => string)`
   and the thunk is a **builder** — `expect(buildCount).toBe(1)` in
   `interaction-processing-message-tool-streaming.suite.ts` pins it to one invocation. Calling it
   again rebuilds the envelope with a fresh timestamp, so the stripper would have been matching
   against text that was never sent. Now the enqueue call passes a **wrapper** that records the
   built string, preserving the single invocation.

   **A stashed control run is what proved this was mine**: baseline 141 pass / 1 fail on
   `test/interaction-processing` + `test/tmux-runner-latency`, versus 140 / 2 with the change.
   Without the control I would have filed it under "the suite is flaky under load", which the
   four genuinely timing-sensitive failures make very easy to believe.

**Also: the silent branch now logs.** When settlement yields nothing deliverable, the empty case
was *completely* silent (only the leak case logged) and **both go on to call
`recordVisibleReply("final")`**. That stamp is what queue routing and the automations board's
`loop_delivered` check read, so a suppressed turn has been indistinguishable from an answered
one — which is exactly why 32 of them accumulated unnoticed. The stamp is kept (removing it
risks the run being treated as still-blocking; not verified, so not touched) but it is no longer
invisible.

**Tests:** `test/pane-settlement-loss.test.ts` — 9 cases. Three reproduce the loss; six pin the
fix, including the ones where it must NOT fire (no echo, empty/tiny prompt, a reply that merely
*quotes* the prompt wording, a truncated echo).

**Still open:** the stamp itself. A suppressed settlement is not a delivered reply, and until
that is separated, `loop_delivered` can report green on silence.

**Upstream-worthy:** yes — same framing as the entry above: keep the fallback, exclude the
injected prompt from what it delivers, and now *stop it taking the real reply with it*.

---

## Carried from before

- `feat/telegram-voice-audio-attachments` — voice/audio downloads. **Upstream now
  has this** (`TelegramVoice` is on `origin/main`), so drop this patch on upgrade.
- `feat/web-channel` — WebSocket channel for the A2UI/kanban webapp. Carries 9
  pre-existing `tsc` errors (`"web"` not in the `"slack" | "telegram"` platform
  union). They predate these patches; `bun build` does not typecheck, so it ships.
  Worth fixing before any upstream PR of the web channel.

---

## `feat/telegram-no-preview` — `--no-preview` for `message send` / `message edit`

Telegram auto-expands the first link in a message into a preview card. clisbot never
set the API's preview option either way, so **every** message carrying a link got one
and there was no way to turn it off.

That is not merely cosmetic for auto-posts. The HIDA BAND watcher
(`~/code/hida_band/band_watch.py`) posts a short summary plus an "Open in BAND" deep
link; band.us's preview card is taller than the summary, so the thing Bob actually
needs to read got pushed off-screen by boilerplate. He asked for the bare link on
2026-08-09.

**Shape** — mirrors the existing `--silent`/`disable_notification` pass-through exactly,
so there is no new plumbing to reason about:

| file | change |
|---|---|
| `src/control/commands/message-cli.ts` | `noPreview: hasFlag(rest, "--no-preview")` + usage line |
| `src/channels/message/message-command.ts` | `noPreview?: boolean` on `ParsedMessageCommand` |
| `src/channels/telegram/plugin.ts` | pass `command.noPreview` into the shared params |
| `src/channels/telegram/message-actions.ts` | `link_preview_options: { is_disabled: true }` on `sendMessage` + `editMessageText` |

**Optional, not required, on the command type.** `ParsedMessageCommand` is built in
three other places (`queues-cli.ts`, `owner-alerts.ts`, the message CLI itself); a
required field would have forced edits to all of them for no behavioural gain.

**Uses `link_preview_options`, not `disable_web_page_preview`.** The latter is
deprecated as of Bot API 7.0. Both still work; the modern one is a nested object,
which is safe here because `callTelegramApi` takes `Record<string, unknown>` and
JSON-encodes. Note it would **not** survive `callTelegramMultipartApi`, which
`String()`s every value — that path is media-with-caption, and captions never render
a preview anyway, so it is deliberately not wired there.

**Opt-in.** No existing caller changes behaviour; only `band_watch.py` passes it today.

**Upstream-worthy:** yes. Small, additive, matches an existing flag's shape.

## Automation-queued prompts don't post a pane fallback (2026-09-30)

`clisbot queues create` and count-loop items now carry `origin: "cli"` / `"loop"`, and chat `/queue` items carry
`origin: "chat"`. When a queued run ends without a message-tool reply, `ManagedQueueController` posts the pane
snapshot ("Prompt: …" + screen) only for chat or unset origins. Bobby was getting a pane dump for every quiet
background job (board triage, repo reviews, the midday check), each of them told to send nothing. Failure
notices still post for every origin. Items stored before this change have no origin and keep the old behaviour.
Tests: `test/managed-queue-controller.test.ts` ("pane fallback … origin=…"). Files: queue-state.ts,
managed-queue-controller.ts, queues-cli.ts, loops-cli.ts, interaction-processing.ts.
