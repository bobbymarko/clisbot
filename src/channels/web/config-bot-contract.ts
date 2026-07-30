import { countStandardChannelBotRoutes } from "../../config/channels/channel-bot-records.ts";

export default {
  channel: "web",
  configBotKey: "web",
  countManagedBotRoutes: countStandardChannelBotRoutes,
} as const;
