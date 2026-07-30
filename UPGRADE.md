# Upgrade scope: fork → `origin/main`

Companion to `PATCHES.md`. Scoped 2026-07-30 against `origin/main` at fetch time.
Nothing here has been executed — this is the plan, not a changelog.

**Baseline:** we are v0.1.43, **144 commits behind `origin/main`, 15 commits of our
own**, diff `1741 insertions, 19 deletions`. We barely modify upstream code; almost
everything we carry is new files. That is what makes this tractable.

## Not a rebase

Upstream restructured `src/`. Of the 11 upstream files we edit, **6 no longer exist
at their old paths**: `channels/channel-identity.ts`, `channels/registry.ts`,
`channels/rendering.ts`, `config/schema.ts`, `control/runtime-health-store.ts`,
`shared/paths.ts`. A literal `git rebase` conflicts on nearly every hunk.

**Do this instead:** branch from `origin/main`, re-apply the two surviving features
by hand, delete the rest.

## What we carry forward — and what we drop

| Patch | Verdict |
|---|---|
| `fix/tmux-submit-false-negative` | **DROP.** Upstream `afbd173` fixes it better (adds the composer-drain check ours lacks). See `PATCHES.md`. |
| `feat/telegram-voice-audio-attachments` | **DROP.** Upstream ships `TelegramVoice`. |
| `fix/telegram-location` | **PORT.** Small, additive, upstream-worthy. |
| `feat/web-channel` | **PORT.** The real work — but smaller than feared, see below. |
| `deploy.sh`, `PATCHES.md`, `public/*`, docs | Carry as-is. No conflict surface. |

## Why the web channel got *easier*

1. **`export type ChannelId = string`.** The hardcoded `"slack" | "telegram"` union
   is gone. Our **9 pre-existing `tsc` errors disappear** — that was `PATCHES.md`'s
   flagged blocker.
2. **Real extension points.** `ChannelPlugin` interface + `CHANNEL_PLUGINS` registry
   in `src/channels/catalog/registry.ts`. Adding a channel is supported, not surgery.
3. **Three worked examples** added since we forked: `api`, `zalo-bot`,
   `zalo-personal`. `api` (HTTP, non-chat, ~2100 lines / 20 files) is the closest
   analogue to ours.
4. **We are already plugin-shaped.** `src/channels/web/plugin.ts` implements
   `ChannelPlugin`. Conformance work, not a rewrite.
5. **Four fork patches stop existing.** Our edits to `channel-identity.ts`,
   `registry.ts`, `config/schema.ts` and `runtime-health-store.ts` were all
   workarounds for missing extension points. Upstream now provides them.

## The integration surface is tiny

The entire web channel touches **3 functions and 4 types** of clisbot internals.
Everything else is `ws` plus node builtins.

| Symbol | Upstream status |
|---|---|
| `processChannelInteraction` | `channels/message/interaction-processing.ts` — **signature is backward compatible with our call site.** Every field we pass still exists; all additions are optional. This was the main unknown, and it is a non-issue. |
| `resolveChannelAuth` | `src/auth/resolve.ts` — **unmoved.** |
| `buildAgentMainSessionKey` / `buildAgentPeerSessionKey` | moved to `agents/session/session-key.ts` — import path only. |

`transport.ts`, `history-reader.ts`, `mcp-client.ts` and `session-routing.ts` are
effectively **path-rewrite-only**: they import node builtins, `ws`, and session-key.
`history-reader.ts` computes the Claude Code JSONL path itself, so it does not
depend on the moved `shared/paths.ts`.

## Work items

**1. Import path rewrites** (mechanical, 6 paths)
- `config/load-config.ts` → `config/core/load-config.ts`
- `agents/agent-service.ts` → `agents/runtime/agent-service.ts`
- `agents/session-key.ts` → `agents/session/session-key.ts`
- `channels/channel-plugin.ts` → `channels/integration/channel-plugin.ts`
- `channels/interaction-processing.ts` → `channels/message/interaction-processing.ts`
- `auth/resolve.ts` → unchanged

**2. `ChannelPlugin` conformance** (`src/channels/web/plugin.ts`)
- ADD required `capabilities: { surfaceKinds: ["dm"], messageActions: [...] }`
- ADD required `resolveMessageSurface(command)`
- CHANGE `runMessageCommand(loadedConfig, command, surface)` — new 3rd param
- CHANGE `resolveMessageReplyTarget({..., surface})` — new field
- REMOVE `markStartupFailure` — replaced by optional `describeStartupFailure`.
  **This is what deletes our `runtime-health-store.ts` patch** (`markWebFailure`).
- Everything else on the interface is optional (`displayName`, `operatorInventory`,
  `agentReply`, `loopCli`, `bootstrapCli`, `controlHelp`, `operatorGuidance`…).
  Skip on first pass; revisit if we want the web channel in `/status` output.

**3. Route object** (`service.ts` ~line 233) — three small deltas:
- DROP `requireMention`, `allowBots` — not on `ChannelInteractionRoute` anymore
- `surfaceNotifications` is now `{ queueStart, loopStart }` — we pass
  `{ loopStart, loopEnd }`. `loopEnd` is gone, `queueStart` is new.
- `followUp` now requires `participationTtlMs` — we pass only `{ mode }`

**4. Config** — our `src/config/schema.ts` edit is gone. Upstream does per-channel
config schemas (`api/config-schema.ts`, `api/config-target.ts`). Move web config to
`src/channels/web/config-schema.ts` following that pattern. Cleaner, and drops a
shared-file patch.

**5. Register** — ~~one line in `src/channels/catalog/registry.ts`~~ **WRONG — corrected
2026-07-30 during the build.** Registering a channel now needs a full
`ChannelInstallation` (`src/channels/integration/channel-installation-inventory.ts`):
`surfaceContract`, `configTarget`, `pairingAccess`, `botContract`, `routeContract`,
`schemaContract`, `templateContract` — all required. Modelled on `api`/`zalo-bot`
that is ~250–300 lines of contract files.

Two hard constraints found by building it:
- `ChannelConfigBotKey` is still a **closed union** (`channel-config-key.ts`), so
  adding `web` is an unavoidable one-line shared-file edit.
- `getChannelSurfaceContract()` **throws** on an unregistered channel, and
  `resolveChannelAuth` reaches it. So plugin-only registration compiles but dies at
  runtime on the first web message. A surface contract is mandatory, not optional.
- `schemaContract.createSchema` must return `z.ZodType<ChannelProviderConfig>`, and
  that type **requires a `defaults` key plus per-bot records**. Our flat
  `bots.web = { apiKey, port, … }` does not fit. Conforming restructures the config.
  Upstream ships `ChannelLegacyConfigMigrationContract` (optional installation field)
  for exactly this — use it to auto-migrate rather than hand-editing config.json.

**6. `fix/telegram-location`** — all three edited files still exist upstream
(`telegram/attachments.ts`, `telegram/message.ts`, `telegram/service.ts`) and
`location-store.ts` is a new file. Re-applies close to directly. Worth PRing
upstream afterward; `PATCHES.md` already marks it upstream-worthy.

## Estimate

- telegram-location: ~1h
- web channel: **half a day**, dominated by items 2–4. Revised down from "a day-ish"
  — that estimate assumed `processChannelInteraction` had drifted. It has not.
- Verification: the web app (kanban/A2UI) is the only consumer. Smoke test =
  connect, send a prompt, confirm streaming text, `CHANNEL_EVENT` annotations, and
  markdown code fences survive.

## Risks

- **`responseMode: "capture-pane"`** — the web channel depends on it to emit
  `CHANNEL_EVENT` annotations reliably (`ab63694`). Upstream still has the mode;
  confirm the annotation path still works before declaring the port done.
- **Final-message-from-JSONL** (`3666c0c`, preserves markdown code fences) reads the
  transcript directly. Verify upstream has not changed transcript rendering in a way
  that makes this redundant — it may be droppable.
- **`bun build` does not typecheck.** Run `tsc` explicitly after the port; we should
  land at zero errors now that `ChannelId` is `string`, and that is worth confirming
  rather than assuming.
- **`deploy.sh` / systemd** — see the `⛔` section in `PATCHES.md`. Never restart via
  the clisbot CLI; `EADDRINUSE 0.0.0.0:3099` and a dead unit is the failure mode.
