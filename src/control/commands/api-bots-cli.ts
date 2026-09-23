import { readFileSync } from "node:fs";
import { readEditableConfig, writeEditableConfig } from "../../config/core/config-file.ts";
import { clisbotConfigSchema } from "../../config/core/schema.ts";
import { getChannelBotRecord, reconcileChannelProviderDefaults } from "../../config/channels/channel-bots.ts";
import { ensureAgentExists, getBotId, parseOptionValue } from "./bots-cli-shared.ts";

/** API bots have an ingress contract, rather than provider token credentials. */
export async function tryAddApiBot(args: string[]): Promise<boolean> {
  if (parseOptionValue(args, "--channel") !== "api") return false;
  const file = parseOptionValue(args, "--config-file");
  if (!file) throw new Error("API bots require --config-file <bot-contract.json>");
  const botId = getBotId(args);
  if (botId === "defaults") throw new Error("defaults is reserved for provider settings");
  const { config, configPath } = await readEditableConfig(process.env.CLISBOT_CONFIG_PATH);
  if (getChannelBotRecord(config, "api", botId)) throw new Error(`Bot already exists: api/${botId}`);
  const contract = JSON.parse(readFileSync(file, "utf8"));
  const agentId = parseOptionValue(args, "--agent") ?? contract.agentId;
  if (!agentId) throw new Error("API bots require an agent");
  ensureAgentExists(config, agentId);
  config.bots.api[botId] = { ...contract, agentId };
  // Validate before persistence; a malformed contract must never corrupt live config.
  const validated = clisbotConfigSchema.parse(config);
  reconcileChannelProviderDefaults(validated, "api");
  await writeEditableConfig(configPath, validated);
  console.log(`Added api/${botId}; config: ${configPath}`);
  return true;
}
