import { z } from "zod";
import { defineChannelSchemaContract } from "../../config/channels/channel-schema-contract.ts";
import {
  asChannelProviderConfigSchema,
  createBaseBotSchema,
  createBaseDefaults,
  createBaseDefaultsSchema,
} from "../config/config-schema-base.ts";

const mcpServerSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).optional(),
});

const webChannelSchemaContract = defineChannelSchemaContract({
  channel: "web",
  configBotKey: "web",
  createSchema: (params) => {
    const botSchema = z.object({
      ...createBaseBotSchema(params),
      // Shared secret presented by the browser client on connect. The web channel
      // authenticates on this rather than on the pairing flow, so a bot without an
      // apiKey is inert.
      apiKey: z.string().min(1).optional(),
      port: z.number().int().positive().optional(),
      ownerId: z.string().optional(),
      senderName: z.string().optional(),
      mcpServers: z.record(z.string(), mcpServerSchema).optional(),
    });
    const defaults = createBaseDefaults("socket", {
      port: 3099,
    });
    const defaultsSchema = z.object({
      ...createBaseDefaultsSchema(params, z.literal("socket").default("socket")),
      port: z.number().int().positive().default(3099),
    });
    return asChannelProviderConfigSchema(
      z.object({
        defaults: defaultsSchema.default(defaults as any),
      }).catchall(botSchema).default({ defaults } as any),
    );
  },
});

export default webChannelSchemaContract;
