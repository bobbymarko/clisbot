import { dirname, join } from "node:path";
import { ensureDir, readTextFile, writeTextFile } from "../../infra/fs.ts";
import { getDefaultTelegramLocationPath } from "../../infra/paths.ts";

export type TelegramReactionRecord = {
  messageId: number;
  userName: string;
  emojis: string[];
  updatedAt: string;
};

type StoreDocument = {
  // keyed "<botId>:<chatId>" — a person's DM has the same chat id with every bot, so
  // the bot id is what keeps Nova's reactions from being read (and consumed) by Burro.
  chats: Record<string, TelegramReactionRecord[]>;
};

const MAX_PER_CHAT = 30;
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Reactions people leave on the bot's messages, recorded instead of prompted.
 *
 * Added 2026-09-27 (Bob: "build it that way"). A reaction is feedback, not a request, so
 * it must never start an agent turn — every tapped 👍 would cost a run and invite a reply
 * to a thumbs-up. Each reaction is stored here; the next real message in that chat carries
 * a one-line summary in its context block and the pending entries are consumed.
 *
 * One entry per (message, user), overwritten on change, so an add-then-remove nets out
 * and the summary reflects where the reactions ended up rather than every tap.
 */
export class TelegramReactionStore {
  private loaded = false;
  private document: StoreDocument = { chats: {} };

  constructor(
    private readonly filePath = join(dirname(getDefaultTelegramLocationPath()), "telegram-reactions.json"),
    private readonly ttlMs = DEFAULT_TTL_MS,
  ) {}

  private async load() {
    if (this.loaded) {
      return;
    }
    try {
      const parsed = JSON.parse(await readTextFile(this.filePath)) as StoreDocument;
      this.document = parsed?.chats ? parsed : { chats: {} };
    } catch {
      this.document = { chats: {} };
    }
    this.loaded = true;
  }

  private async persist() {
    await ensureDir(dirname(this.filePath));
    await writeTextFile(this.filePath, `${JSON.stringify(this.document, null, 2)}\n`);
  }

  async record(key: string, record: TelegramReactionRecord) {
    await this.load();
    const cutoff = Date.now() - this.ttlMs;
    const kept = (this.document.chats[key] ?? []).filter(
      (entry) =>
        Date.parse(entry.updatedAt) >= cutoff &&
        !(entry.messageId === record.messageId && entry.userName === record.userName),
    );
    kept.push(record);
    this.document.chats[key] = kept.slice(-MAX_PER_CHAT);
    await this.persist();
  }

  /** Pending reactions for a chat, removed from the store as they are returned. */
  async take(key: string) {
    await this.load();
    const pending = this.document.chats[key] ?? [];
    if (pending.length === 0) {
      return [];
    }
    delete this.document.chats[key];
    await this.persist();
    return pending;
  }
}

export function summarizeTelegramReactions(records: TelegramReactionRecord[]) {
  return records.map((record) =>
    record.emojis.length > 0
      ? `${record.userName} ${record.emojis.join("")} on #${record.messageId}`
      : `${record.userName} removed their reaction on #${record.messageId}`,
  );
}
