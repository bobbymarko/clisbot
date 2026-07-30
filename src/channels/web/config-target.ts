import type { ClisbotConfig } from "../../config/core/schema.ts";
import type { ChannelSurfaceConfigTargetContract } from "../config/surface-config-target-contract.ts";
import { resolveSurfaceTargetBot } from "../config/surface-config-target-contract.ts";
import { resolveChannelIdentityBotId } from "../surface/channel-identity.ts";

// The web channel has exactly one conversation per bot — the owner's socket — so
// every target resolves to the bot record itself rather than to a nested route.
function resolveWebTargetBinding(config: ClisbotConfig, botId: string | undefined) {
  const resolved = resolveSurfaceTargetBot({
    config,
    configBotKey: "web",
    channel: "web",
    botId,
  });
  const bot = resolved.bot as Record<string, unknown>;
  return {
    label: `web bot ${resolved.botId}`,
    getExactSource: () => bot,
    getFallbackSources: () => [],
    ensureWritableSource: () => bot,
  };
}

export const webSurfaceConfigTargetContract = {
  channel: "web",
  resolveConfiguredSurfaceTargetBinding: (config, params) =>
    resolveWebTargetBinding(config, params.botId),
  buildConfiguredTargetFromIdentity: (identity) => ({
    channel: "web",
    botId: resolveChannelIdentityBotId(identity),
    target: "dm:owner",
  }),
} satisfies ChannelSurfaceConfigTargetContract;

export default webSurfaceConfigTargetContract;
