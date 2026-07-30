import type { ChannelPlugin } from "../integration/channel-plugin.ts";
import {
  getChannelProviderBotRecords,
  listEnabledBotIds,
} from "../../config/channels/channel-bot-records.ts";
import type { WebBotConfig } from "./service.ts";
import { WebRuntimeService } from "./service.ts";

type LoadedConfigParam = Parameters<ChannelPlugin["isEnabled"]>[0];

type WebBotRecord = {
  enabled?: boolean;
  apiKey?: string;
  port?: number;
  agentId?: string;
  ownerId?: string;
  senderName?: string;
  mcpServers?: Record<string, { command: string; args: string[]; env?: Record<string, string> }>;
};

// A bot is only usable once it carries an apiKey — that key is the whole of the
// web channel's authentication, so a keyless record is inert rather than open.
function listWebBots(loadedConfig: LoadedConfigParam): Array<{ botId: string; config: WebBotConfig }> {
  const provider = loadedConfig.raw.bots.web;
  if (!provider?.defaults?.enabled) {
    return [];
  }
  const records = getChannelProviderBotRecords(provider) as Record<string, WebBotRecord | undefined>;
  const providerDefaults = provider.defaults as { port?: number; agentId?: string };
  const defaultPort = providerDefaults.port ?? 3099;
  return listEnabledBotIds(records)
    .map((botId) => ({ botId, record: records[botId] }))
    .filter((entry): entry is { botId: string; record: WebBotRecord } =>
      Boolean(entry.record?.apiKey?.trim()))
    .map(({ botId, record }) => ({
      botId,
      config: {
        port: record.port ?? defaultPort,
        apiKey: record.apiKey as string,
        agentId: record.agentId
          ?? providerDefaults.agentId
          ?? loadedConfig.raw.agents.defaults.defaultAgentId
          ?? "default",
        ownerId: record.ownerId,
        senderName: record.senderName,
        mcpServers: record.mcpServers,
      },
    }));
}

export const webChannelPlugin: ChannelPlugin = {
  id: "web",
  displayName: "Web",
  // The web channel is an owner-only WebSocket surface. It has no CLI message
  // actions and no addressable targets, so it exposes the DM surface kind only.
  capabilities: {
    surfaceKinds: ["dm"],
    messageActions: [],
  },
  isEnabled: (loadedConfig) => listWebBots(loadedConfig).length > 0,
  listBots: (loadedConfig) => listWebBots(loadedConfig),
  createRuntimeService: (context, bot) =>
    new WebRuntimeService(
      context.loadedConfig,
      context.agentService,
      bot.config as WebBotConfig,
      context.reportLifecycle,
    ),
  renderHealthSummary: (state) => {
    switch (state) {
      case "starting": return "Web channel is starting.";
      case "disabled": return "Web channel is disabled (no apiKey configured).";
      case "stopped": return "Web channel is stopped.";
    }
  },
  renderActiveHealthSummary: () => "Web channel WebSocket server active.",
  describeStartupFailure: (error) => ({
    summary: "Web channel failed to start.",
    detail: error instanceof Error ? error.message : String(error),
    actions: [
      "Check that bots.web.port is free (default 3099).",
      "Confirm bots.web.apiKey is set.",
    ],
  }),
  runMessageCommand: async (_loadedConfig, _command, _surface) => {
    return { botId: "default", result: { ok: false, error: "Web channel does not support CLI message commands." } };
  },
  // No addressable targets: the web channel only ever talks back over the socket
  // that opened the conversation.
  resolveMessageSurface: () => null,
  resolveMessageReplyTarget: () => null,
};

export default webChannelPlugin;
