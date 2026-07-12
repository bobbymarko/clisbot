export type TelegramUser = {
  id?: number;
  is_bot?: boolean;
  username?: string;
  first_name?: string;
  last_name?: string;
};

export type TelegramChat = {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  is_forum?: boolean;
};

export type TelegramFileDocument = {
  file_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
};

export type TelegramPhotoSize = {
  file_id: string;
  file_size?: number;
};

export type TelegramVoice = {
  file_id: string;
  mime_type?: string;
  file_size?: number;
  duration?: number;
};

export type TelegramAudio = {
  file_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
  duration?: number;
  title?: string;
};

export type TelegramLocation = {
  latitude: number;
  longitude: number;
  horizontal_accuracy?: number;
  live_period?: number;
  heading?: number;
};

export type TelegramVenue = {
  location?: TelegramLocation;
  title?: string;
  address?: string;
};

export type TelegramMessage = {
  message_id: number;
  date?: number;
  message_thread_id?: number;
  media_group_id?: string;
  text?: string;
  caption?: string;
  from?: TelegramUser;
  chat: TelegramChat;
  document?: TelegramFileDocument;
  photo?: TelegramPhotoSize[];
  voice?: TelegramVoice;
  audio?: TelegramAudio;
  location?: TelegramLocation;
  venue?: TelegramVenue;
  forum_topic_created?: {
    name?: string;
  };
  reply_to_message?: {
    from?: TelegramUser;
    forum_topic_created?: {
      name?: string;
    };
  };
  media_group_messages?: TelegramMessage[];
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
};

export function getTelegramUpdateMessage(update: TelegramUpdate) {
  return update.message ?? update.edited_message;
}

export function getTelegramMessageLocation(message: TelegramMessage) {
  const location = message.location ?? message.venue?.location;
  if (
    !location ||
    !Number.isFinite(location.latitude) ||
    !Number.isFinite(location.longitude)
  ) {
    return undefined;
  }

  return location;
}

/**
 * A live-location pin reports movement as `edited_message` updates rather than new
 * messages. Those carry a new position only — they are not something the user said again.
 */
export function isTelegramLiveLocationMove(update: TelegramUpdate) {
  return Boolean(
    !update.message &&
      update.edited_message &&
      getTelegramMessageLocation(update.edited_message),
  );
}

export function getTelegramUpdateSkipReason(update: TelegramUpdate) {
  const message = getTelegramUpdateMessage(update);
  if (!message) {
    return "no-message";
  }

  // Editing a text message must not re-run the agent on a prompt the user already sent.
  // Location is the one edit worth acting on (live-location movement).
  if (!update.message && !getTelegramMessageLocation(message)) {
    return "edited-without-location";
  }

  if (!message.from?.id && !message.from?.is_bot) {
    return "missing-user";
  }

  return null;
}

export function formatTelegramLocationText(message: TelegramMessage) {
  const location = getTelegramMessageLocation(message);
  if (!location) {
    return "";
  }

  const details: string[] = [];
  if (message.venue?.title) {
    details.push(message.venue.title);
  }
  if (message.venue?.address) {
    details.push(message.venue.address);
  }
  if (Number.isFinite(location.horizontal_accuracy)) {
    details.push(`±${Math.round(location.horizontal_accuracy as number)}m`);
  }
  if (Number.isFinite(location.heading)) {
    details.push(`heading ${Math.round(location.heading as number)}°`);
  }
  if (location.live_period) {
    details.push("live location");
  }

  const suffix = details.length > 0 ? ` (${details.join(", ")})` : "";
  return `[location] ${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}${suffix}`;
}

export function hasTelegramBotMention(text: string, botUsername?: string) {
  const normalizedBotUsername = (botUsername ?? "").trim().replace(/^@/, "");
  if (!text || !normalizedBotUsername) {
    return false;
  }

  return extractTelegramMentionTargets(text).includes(normalizedBotUsername.toLowerCase());
}

export function hasForeignTelegramMention(text: string, botUsername?: string) {
  const mentions = extractTelegramMentionTargets(text);
  if (mentions.length === 0) {
    return false;
  }

  const normalizedBotUsername = (botUsername ?? "").trim().replace(/^@/, "").toLowerCase();
  if (!normalizedBotUsername) {
    return true;
  }

  return !mentions.includes(normalizedBotUsername);
}

export function stripTelegramBotMention(text: string, botUsername?: string) {
  const normalizedBotUsername = (botUsername ?? "").trim().replace(/^@/, "");
  if (!normalizedBotUsername) {
    return text.trim();
  }

  const pattern = new RegExp(`(^|\\s)@${escapeRegExp(normalizedBotUsername)}\\b`, "ig");
  return text.replace(pattern, " ").replace(/\s+/g, " ").trim();
}

export function isTelegramBotOriginatedMessage(message: TelegramMessage) {
  return Boolean(message.from?.is_bot);
}

export function isReplyToTelegramBot(message: TelegramMessage, botUserId?: number) {
  return Boolean(botUserId && message.reply_to_message?.from?.id === botUserId);
}

export function resolveTelegramTopicName(message: TelegramMessage) {
  return (
    message.forum_topic_created?.name?.trim() ||
    message.reply_to_message?.forum_topic_created?.name?.trim() ||
    undefined
  );
}

function escapeRegExp(raw: string) {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractTelegramMentionTargets(text: string) {
  if (!text) {
    return [];
  }

  const matches = new Set<string>();
  const mentionPattern = /(^|\s)@([A-Za-z0-9_]{2,32})\b/g;
  const slashCommandTargetPattern = /(^|\s)\/[A-Za-z0-9_]+@([A-Za-z0-9_]{2,32})\b/g;

  for (const match of text.matchAll(mentionPattern)) {
    const username = match[2]?.trim().toLowerCase();
    if (username) {
      matches.add(username);
    }
  }

  for (const match of text.matchAll(slashCommandTargetPattern)) {
    const username = match[2]?.trim().toLowerCase();
    if (username) {
      matches.add(username);
    }
  }

  return [...matches];
}
