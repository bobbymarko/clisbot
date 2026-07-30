import type { ChannelPairingAccessContract } from "../pairing/access-contract.ts";
import { normalizePrefixedEntry } from "../pairing/access-contract.ts";

function normalizeWebAllowEntry(entry: string) {
  return normalizePrefixedEntry(entry.trim(), ["web:"]);
}

export const webPairingAccessContract = {
  channel: "web",
  normalizeAllowEntry: normalizeWebAllowEntry,
  normalizeApprovedPairingId: normalizeWebAllowEntry,
  // The web channel authenticates on the shared apiKey presented at connect time,
  // not on the pairing flow. Nothing reaches the agent without that key, so there
  // is no second sender identity for pairing to arbitrate.
  isSenderAllowed: ({ allowFrom, subject }) => {
    const userId = subject.userId?.trim() ?? "";
    if (!userId) {
      return false;
    }
    return allowFrom.map(normalizeWebAllowEntry).includes(userId);
  },
} satisfies ChannelPairingAccessContract;

export default webPairingAccessContract;
