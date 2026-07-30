import { createStandardChannelGroupRouteShell } from "../../config/channels/channel-route-shells.ts";

export default {
  channel: "web",
  configBotKey: "web",
  providerLabel: "Web",
  // The web channel is a single owner-only socket: no groups, no topics.
  supportsGroups: false,
  supportsTopics: false,
  createGroupRouteShell: createStandardChannelGroupRouteShell,
} as const;
