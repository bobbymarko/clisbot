import { dirname } from "node:path";
import { ensureDir, readTextFile, writeTextFile } from "../../infra/fs.ts";
import { getDefaultTelegramLocationPath } from "../../infra/paths.ts";

export type TelegramLocationRecord = {
  chatId: string;
  senderId?: string;
  senderName?: string;
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
  headingDegrees?: number;
  live: boolean;
  updatedAt: string;
};

type StoreDocument = {
  locations: Record<string, TelegramLocationRecord>;
};

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Last-known position per chat, written on every location update and readable by
 * agent tooling. Live-location movement lands here instead of being pushed at the
 * agent as a prompt — a pin that moves every few seconds would otherwise flood it.
 */
export class TelegramLocationStore {
  private loaded = false;
  private document: StoreDocument = { locations: {} };

  constructor(
    private readonly filePath = getDefaultTelegramLocationPath(),
    private readonly ttlMs = DEFAULT_TTL_MS,
  ) {}

  private async load() {
    if (this.loaded) {
      return;
    }

    try {
      const parsed = JSON.parse(await readTextFile(this.filePath)) as StoreDocument;
      this.document = parsed?.locations ? parsed : { locations: {} };
    } catch {
      this.document = { locations: {} };
    }

    this.loaded = true;
  }

  private prune() {
    const cutoff = Date.now() - this.ttlMs;
    for (const [chatId, record] of Object.entries(this.document.locations)) {
      const updatedAt = Date.parse(record.updatedAt);
      if (!Number.isFinite(updatedAt) || updatedAt < cutoff) {
        delete this.document.locations[chatId];
      }
    }
  }

  private async persist() {
    await ensureDir(dirname(this.filePath));
    await writeTextFile(this.filePath, `${JSON.stringify(this.document, null, 2)}\n`);
  }

  async record(record: TelegramLocationRecord) {
    await this.load();
    this.prune();
    this.document.locations[record.chatId] = record;
    await this.persist();
  }

  async get(chatId: string) {
    await this.load();
    return this.document.locations[chatId];
  }

  async all() {
    await this.load();
    return { ...this.document.locations };
  }
}
