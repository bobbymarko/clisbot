import type { ChannelPlugin } from "../integration/channel-plugin.ts";
import type { WebBotConfig } from "./service.ts";
import { WebRuntimeService } from "./service.ts";

function getWebConfig(loadedConfig: Parameters<ChannelPlugin["isEnabled"]>[0]): WebBotConfig | null {
  const raw = loadedConfig.raw as {
    bots?: {
      web?: {
        apiKey?: string; port?: number; agentId?: string; ownerId?: string;
        senderName?: string;
        mcpServers?: Record<string, { command: string; args: string[]; env?: Record<string, string> }>;
      };
    };
  };
  const web = raw.bots?.web;
  if (!web?.apiKey) return null;
  return {
    port: web.port ?? 3099,
    apiKey: web.apiKey,
    agentId: web.agentId ?? loadedConfig.raw.agents.defaults.defaultAgentId ?? "default",
    ownerId: web.ownerId,
    senderName: web.senderName,
    mcpServers: web.mcpServers,
  };
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
  isEnabled: (loadedConfig) => !!getWebConfig(loadedConfig),
  listBots: (loadedConfig) => {
    const config = getWebConfig(loadedConfig);
    if (!config) return [];
    return [{ botId: "default", config }];
  },
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
