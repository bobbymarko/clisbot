export default {
  channel: "web",
  interactionRenderer: "markdown",
  routeIdSyntax: "dm:owner",
  supportsGroups: false,
  supportsTopics: false,
  legacyGroupAliases: [],
  normalizeUserId(providerUserId: string) {
    return providerUserId.trim();
  },
} as const;
