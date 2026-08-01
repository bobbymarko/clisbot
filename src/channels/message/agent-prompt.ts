import type { ChannelIdentity } from "../surface/channel-identity.ts";
import { resolveChannelIdentityBotId } from "../surface/channel-identity.ts";
import {
  renderAgentReplyCommandBase,
  renderScopedQueueHelpCommand,
} from "./agent-reply.ts";
import { getChannelPlugin } from "../catalog/registry.ts";
import {
  buildSurfacePromptContext,
  renderPermissionGuidance,
  renderSurfacePromptContext,
  resolveSurfacePromptTime,
  type SurfacePromptContext,
} from "../surface/surface-prompt-context.ts";
import { getClisbotPromptCommand } from "../../control/commands/clisbot-wrapper.ts";
import { getRenderedCliName, renderCliCommand } from "../../control/commands/cli-name.ts";

export type ChannelAgentPromptConfig = {
  enabled: boolean;
  maxProgressMessages: number;
  requireFinalResponse: boolean;
};

export const BASE_TEMPLATE = `<system>
{{message_context}}

You are operating inside clisbot.
{{delivery_intro}}
{{reply_command}}
{{reply_rules}}
{{reply_style_hint}}
{{configuration_guidance}}{{permission_guidance}}{{protected_control_suffix}}
</system>

<user>
{{message_body}}
</user>`;

export const STEERING_TEMPLATE = `<system>
A new user message arrived while you were still working.
Adjust your current work if needed and continue.

{{message_context}}{{permission_guidance}}{{protected_control_suffix}}
</system>

<user>
{{message_body}}
</user>`;

/**
 * Signatures that identify a `<system>` block as OUR injected prompt rather than
 * anything the agent legitimately wrote. Keep these in sync with the templates above.
 */
const ECHOED_PROMPT_MARKERS = [
  "You are operating inside clisbot.",
  "A new user message arrived while you were still working.",
];

/**
 * Remove an echoed clisbot prompt from text that came off a tmux pane.
 *
 * The pane still shows the prompt we just typed into it. When a run settles from
 * the pane snapshot instead of from a message-tool reply, that snapshot is
 * delivered to the user verbatim -- which is how the raw `<system>` block ends up
 * posted into a chat without the agent ever sending it.
 *
 * Only strips blocks carrying one of the markers above, so an agent that happens
 * to write `<system>` in a real reply keeps it.
 */
export function stripEchoedAgentPrompt(text: string): string {
  if (!text || !ECHOED_PROMPT_MARKERS.some((marker) => text.includes(marker))) {
    return text;
  }

  let out = "";
  let rest = text;

  while (true) {
    const open = rest.indexOf("<system>");
    if (open === -1) {
      out += rest;
      break;
    }

    const close = rest.indexOf("</system>", open);
    // A truncated capture can hold the opening tag with no closing one. Treat the
    // remainder as prompt: leaking half the block is no better than leaking all of it.
    const blockEnd = close === -1 ? rest.length : close + "</system>".length;
    const block = rest.slice(open, blockEnd);

    if (!ECHOED_PROMPT_MARKERS.some((marker) => block.includes(marker))) {
      out += rest.slice(0, blockEnd);
      rest = rest.slice(blockEnd);
      continue;
    }

    out += rest.slice(0, open);
    rest = rest.slice(blockEnd);
  }

  // The prompt wraps the user's own message in <user></user>. Drop the bare tag
  // lines so the echo doesn't read as markup, but keep the text between them.
  return out
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return t !== "<user>" && t !== "</user>";
    })
    .join("\n")
    .trim();
}

export const DELIVERY_INTRO =
  "To send a user-visible {{progress_phrase}}final reply, use the following CLI command:";

export const REPLY_COMMAND = `{{reply_command_base}}
  --final{{progress_flag_suffix}} \\
  --message "$(cat <<\\__CLISBOT_MESSAGE__
<user-facing reply>
__CLISBOT_MESSAGE__
)" \\
  [--file /absolute/path/to/file]`;

export const REPLY_RULES = `When replying to the user:
- put the user-facing message inside the --message body of that command
{{progress_rules_block}}- {{final_rule_line}}`;

export const PROGRESS_PHRASE = "progress update or ";
export const EMPTY_PROGRESS_PHRASE = "";

export const PROGRESS_FLAG_SUFFIX = "|progress";
export const EMPTY_PROGRESS_FLAG_SUFFIX = "";

export const PROGRESS_RULES_BLOCK = `- use that command to send progress updates and the final reply back to the conversation
- send at most {{max_progress_messages}} short, meaningful progress updates; skip trivial internal steps
`;

export const FINAL_RULE_REQUIRED =
  "send a single final user-facing message by default; split only when channel limits require it or clarity would otherwise suffer";
export const FINAL_RULE_OPTIONAL = "final response is optional";

export const EMPTY_REPLY_COMMAND = "";
export const EMPTY_REPLY_RULES = "";
export const EMPTY_REPLY_STYLE_HINT = "";

type ChannelPromptMode = "message" | "steer";

export function buildAgentPromptText(params: {
  text: string;
  identity: ChannelIdentity;
  config: ChannelAgentPromptConfig;
  cliTool?: "codex" | "claude" | "gemini";
  responseMode?: "capture-pane" | "message-tool";
  streaming?: "off" | "latest" | "all";
  protectedControlMutationRule?: string;
  timezone?: string;
  agentId?: string;
  time?: number | string | Date;
  promptContext?: SurfacePromptContext;
  scheduledLoopId?: string;
  maxProgressMessagesOverride?: number;
}) {
  return buildChannelPromptText({
    ...params,
    mode: "message",
  });
}

export function buildSteeringPromptText(params: {
  text: string;
  identity?: ChannelIdentity;
  agentId?: string;
  time?: number | string | Date;
  promptContext?: SurfacePromptContext;
  protectedControlMutationRule?: string;
}) {
  return buildChannelPromptText({
    text: params.text,
    identity: params.identity,
    agentId: params.agentId,
    time: params.time,
    promptContext: params.promptContext,
    mode: "steer",
    protectedControlMutationRule: params.protectedControlMutationRule,
  });
}

function buildChannelPromptText(params: {
  text: string;
  identity?: ChannelIdentity;
  config?: ChannelAgentPromptConfig;
  responseMode?: "capture-pane" | "message-tool";
  streaming?: "off" | "latest" | "all";
  protectedControlMutationRule?: string;
  timezone?: string;
  agentId?: string;
  time?: number | string | Date;
  promptContext?: SurfacePromptContext;
  scheduledLoopId?: string;
  maxProgressMessagesOverride?: number;
  mode: ChannelPromptMode;
}) {
  if (params.mode === "message" && !params.config?.enabled) {
    return params.text;
  }

  if (params.mode === "steer") {
    const context = resolvePromptContext(params);
    return renderTemplate(STEERING_TEMPLATE, {
      message_context: renderSurfacePromptContext(context),
      permission_guidance: renderPermissionGuidanceWithPrefix(context),
      message_body: params.text,
      protected_control_suffix: renderProtectedControlSuffix(
        params.protectedControlMutationRule,
      ),
    });
  }

  const promptParts = renderMessagePromptParts({
    identity: params.identity!,
    config: params.config!,
    responseMode: params.responseMode,
    streaming: params.streaming,
    maxProgressMessagesOverride: params.maxProgressMessagesOverride,
  });
  const context = resolvePromptContext(params);

  return renderTemplate(BASE_TEMPLATE, {
    message_context: renderSurfacePromptContext(context),
    delivery_intro: promptParts.deliveryIntro,
    reply_command: promptParts.replyCommand,
    reply_rules: promptParts.replyRules,
    reply_style_hint: promptParts.replyStyleHint,
    configuration_guidance: renderConfigurationGuidance(params.identity),
    permission_guidance: renderPermissionGuidanceWithPrefix(context),
    protected_control_suffix: renderProtectedControlSuffix(
      params.protectedControlMutationRule,
    ),
    message_body: params.text,
  });
}

function resolvePromptContext(params: {
  identity?: ChannelIdentity;
  agentId?: string;
  time?: number | string | Date;
  promptContext?: SurfacePromptContext;
  scheduledLoopId?: string;
}) {
  if (params.promptContext) {
    return params.promptContext;
  }
  if (!params.identity) {
    return {
      time: resolveSurfacePromptTime(params.time),
      surface: {
        surfaceId: "unknown",
        kind: "channel" as const,
      },
    };
  }
  return buildSurfacePromptContext({
    identity: params.identity,
    agentId: params.agentId,
    time: params.time,
    scheduledLoopId: params.scheduledLoopId,
  });
}

function renderMessagePromptParts(params: {
  identity: ChannelIdentity;
  config: ChannelAgentPromptConfig;
  responseMode?: "capture-pane" | "message-tool";
  streaming?: "off" | "latest" | "all";
  maxProgressMessagesOverride?: number;
}) {
  const messageToolMode = (params.responseMode ?? "message-tool") === "message-tool";
  if (!messageToolMode) {
    return {
      deliveryIntro: renderCapturePaneDeliveryIntro(),
      replyCommand: EMPTY_REPLY_COMMAND,
      replyRules: EMPTY_REPLY_RULES,
      replyStyleHint: EMPTY_REPLY_STYLE_HINT,
    };
  }

  const maxProgressMessages = Math.max(
    0,
    params.maxProgressMessagesOverride ?? params.config.maxProgressMessages,
  );
  const progressEnabled = maxProgressMessages > 0;
  const progressPhrase = progressEnabled ? PROGRESS_PHRASE : EMPTY_PROGRESS_PHRASE;
  const progressFlagSuffix = progressEnabled ? PROGRESS_FLAG_SUFFIX : EMPTY_PROGRESS_FLAG_SUFFIX;
  const progressRulesBlock = progressEnabled ? PROGRESS_RULES_BLOCK : "";
  const finalRuleLine = params.config.requireFinalResponse
    ? FINAL_RULE_REQUIRED
    : FINAL_RULE_OPTIONAL;

  return {
    deliveryIntro: renderTemplate(DELIVERY_INTRO, {
      progress_phrase: progressPhrase,
    }),
    replyCommand: renderTemplate(REPLY_COMMAND, {
      reply_command_base: buildReplyCommandBase({
        command: getClisbotPromptCommand(),
        identity: params.identity,
      }).trimEnd(),
      progress_flag_suffix: progressFlagSuffix,
    }),
    replyRules: renderTemplate(REPLY_RULES, {
      progress_rules_block: renderTemplate(progressRulesBlock, {
        max_progress_messages: String(maxProgressMessages),
      }),
      final_rule_line: finalRuleLine,
    }),
    replyStyleHint: buildReplyStyleHint(params.identity),
  };
}

function buildReplyStyleHint(identity: ChannelIdentity) {
  return getChannelPlugin(identity.platform)?.agentReply?.styleHint ?? EMPTY_REPLY_STYLE_HINT;
}

function renderLoopHelpCommand(identity?: ChannelIdentity) {
  if (!identity) {
    return renderCliCommand("loops --help", { inline: true });
  }
  return renderCliCommand(`loops --help --channel ${identity.platform}`, { inline: true });
}

function renderQueueHelpCommand(identity?: ChannelIdentity) {
  if (!identity) {
    return renderCliCommand("queues --help", { inline: true });
  }
  return renderScopedQueueHelpCommand(identity.platform);
}

function renderConfigurationGuidance(identity?: ChannelIdentity) {
  const cliName = getRenderedCliName();
  return [
    `When the user asks to change ${cliName} configuration, use ${cliName} CLI commands; see ${renderCliCommand("--help", { inline: true })}, ${renderCliCommand("bots --help", { inline: true })}, ${renderCliCommand("routes --help", { inline: true })}, ${renderCliCommand("auth --help", { inline: true })}, or ${renderCliCommand("update --help", { inline: true })} for details.`,
    `For ${cliName} install or update requests, check ${renderCliCommand("update --help", { inline: true })} first and follow it.`,
    `For schedule/loop/reminder requests, inspect ${renderLoopHelpCommand(identity)} and use the loops CLI.`,
    `For durable queue requests, inspect ${renderQueueHelpCommand(identity)} and use the queues CLI.`,
  ].join("\n");
}

function renderPermissionGuidanceWithPrefix(context?: SurfacePromptContext) {
  const guidance = renderPermissionGuidance(context);
  return guidance ? `\n${guidance}` : "";
}

function renderCapturePaneDeliveryIntro() {
  return `channel auto-delivery remains enabled for this conversation; do not send user-facing progress updates or the final response with ${renderCliCommand("message send", { inline: true })}`;
}

function renderProtectedControlSuffix(rule?: string) {
  if (!rule) {
    return "";
  }

  return `\n\n${rule}`;
}

function renderTemplate(template: string, values: Record<string, string>) {
  return template.replaceAll(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key: string) => values[key] ?? "");
}

function buildReplyCommandBase(params: {
  command: string;
  identity: ChannelIdentity;
}) {
  const botId = resolveChannelIdentityBotId(params.identity);
  const agentReply = getChannelPlugin(params.identity.platform)?.agentReply;
  const target = agentReply?.resolveTarget(params.identity);
  if (!agentReply || !target) {
    return "";
  }

  return renderAgentReplyCommandBase({
    command: params.command,
    channel: params.identity.platform,
    botId,
    target,
    childSurface: agentReply.resolveChildSurface?.(params.identity) ?? null,
    inputFormat: agentReply.inputFormat,
    renderMode: agentReply.renderMode,
  });
}
