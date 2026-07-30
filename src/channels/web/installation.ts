import webBotContract from "./config-bot-contract.ts";
import webRouteContract from "./config-route-contract.ts";
import webChannelSchemaContract from "./config-schema.ts";
import webSurfaceConfigTargetContract from "./config-target.ts";
import webChannelTemplateContract from "./config-template-contract.ts";
import webSurfaceContract from "./contract.ts";
import webPairingAccessContract from "./pairing-access.ts";

export const webChannelInstallation = {
  surfaceContract: webSurfaceContract,
  configTarget: webSurfaceConfigTargetContract,
  pairingAccess: webPairingAccessContract,
  botContract: webBotContract,
  routeContract: webRouteContract,
  schemaContract: webChannelSchemaContract,
  templateContract: webChannelTemplateContract,
} as const;

export default webChannelInstallation;
