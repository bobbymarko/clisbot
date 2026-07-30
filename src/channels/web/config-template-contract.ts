import {
  createChannelDefaultBotTemplate,
  createStandardChannelProviderDefaultsTemplate,
  defineChannelTemplateContract,
} from "../../config/channels/channel-template-defaults.ts";

const webChannelTemplateContract = defineChannelTemplateContract({
  channel: "web",
  configBotKey: "web",
  buildTemplate: ({ options }) => {
    const enabled = options.enabled === true;
    return {
      defaults: createStandardChannelProviderDefaultsTemplate({
        enabled,
        mode: "socket",
        extra: {
          dmPolicy: "allowlist",
          groupPolicy: "disabled",
          directMessages: {},
          port: 3099,
        },
      }),
      default: createChannelDefaultBotTemplate({
        enabled: false,
        extra: {
          directMessages: {},
        },
      }),
    };
  },
});

export default webChannelTemplateContract;
