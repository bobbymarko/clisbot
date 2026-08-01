import {
  formatFollowUpTtlMinutes,
  resolveFollowUpMode,
} from "../../agents/commands/follow-up-policy.ts";
import type { ChannelId } from "../integration/channel-surface-contract.ts";
import {
  renderInteractionForRenderer,
  renderTranscriptCommandForRenderer,
} from "../../runners/transcript/index.ts";
import { resolveChannelInteractionRenderer } from "../catalog/registry.ts";
import { stripEchoedAgentPrompt } from "./agent-prompt.ts";

export type ChannelRenderedMessageState = {
  text: string;
  body: string;
};

export function buildRenderedMessageState(params: {
  platform: ChannelId;
  status: "queued" | "running" | "completed" | "timeout" | "detached" | "error";
  snapshot: string;
  queuePosition?: number;
  maxChars: number;
  note?: string;
  allowTranscriptInspection?: boolean;
  previousState?: ChannelRenderedMessageState;
  responsePolicy?: "all" | "final";
}): ChannelRenderedMessageState {
  // The snapshot is the tmux pane, and the pane still shows the prompt clisbot
  // typed into it. Strip that here -- this is the one place every pane-derived
  // body passes through, and it is the last point at which the `<system>` tags
  // the stripper keys on still exist. The renderer below deletes them.
  const body =
    stripEchoedAgentPrompt(params.snapshot).trim() ||
    (params.status === "completed" || params.status === "timeout" || params.status === "detached"
      ? (params.previousState?.body ?? "")
      : "");

  return {
    text: renderPlatformInteraction({
      platform: params.platform,
      status: params.status,
      content: body,
      queuePosition: params.queuePosition,
      maxChars: params.maxChars,
      note: params.note,
      allowTranscriptInspection: params.allowTranscriptInspection,
      responsePolicy: params.responsePolicy,
    }),
    body,
  };
}

export function renderPlatformInteraction(params: {
  platform: ChannelId;
  status: "queued" | "running" | "completed" | "timeout" | "detached" | "error";
  content: string;
  maxChars: number;
  queuePosition?: number;
  note?: string;
  allowTranscriptInspection?: boolean;
  responsePolicy?: "all" | "final";
}) {
  return renderInteractionForRenderer(resolveChannelInteractionRenderer(params.platform), params);
}

export function renderPlatformTranscriptCommand(platform: ChannelId) {
  return renderTranscriptCommandForRenderer(resolveChannelInteractionRenderer(platform));
}

export function formatChannelFollowUpStatus(params: {
  defaultMode: "auto" | "mention-only" | "paused";
  participationTtlMs: number;
  overrideMode?: "auto" | "mention-only" | "paused";
  lastBotReplyAt?: number;
}) {
  const effectiveMode = resolveFollowUpMode({
    defaultMode: params.defaultMode,
    overrideMode: params.overrideMode,
  });
  const lastReply =
    typeof params.lastBotReplyAt === "number" &&
    Number.isFinite(params.lastBotReplyAt)
      ? new Date(params.lastBotReplyAt).toISOString()
      : "never";
  const lines = [
    "Follow-up policy",
    "",
    `- mode: \`${effectiveMode}\``,
    `- follow-up window: \`${formatFollowUpTtlMinutes(params.participationTtlMs)} minutes\``,
    `- last bot reply: \`${lastReply}\``,
  ];

  if (params.overrideMode) {
    lines.splice(3, 0, `- runtime override: \`${params.overrideMode}\``);
    lines.splice(4, 0, `- default mode: \`${params.defaultMode}\``);
  }

  return lines.join("\n");
}
