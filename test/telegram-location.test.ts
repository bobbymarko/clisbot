import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  formatTelegramLocationText,
  getTelegramUpdateSkipReason,
  isTelegramLiveLocationMove,
  type TelegramMessage,
  type TelegramUpdate,
} from "../src/channels/telegram/message.ts";
import { TelegramLocationStore } from "../src/channels/telegram/location-store.ts";

function buildMessage(overrides: Partial<TelegramMessage> = {}): TelegramMessage {
  return {
    message_id: 1,
    from: { id: 8387881738, first_name: "Bob" },
    chat: { id: 8387881738, type: "private" },
    ...overrides,
  };
}

describe("telegram location parsing", () => {
  test("renders a dropped pin as coordinates the agent can read", () => {
    const text = formatTelegramLocationText(
      buildMessage({ location: { latitude: 48.998921, longitude: -110.203612 } }),
    );
    expect(text).toBe("[location] 48.998921, -110.203612");
  });

  test("annotates accuracy, heading and live pins", () => {
    const text = formatTelegramLocationText(
      buildMessage({
        location: {
          latitude: 48.36,
          longitude: -107.87,
          horizontal_accuracy: 14.6,
          heading: 92.4,
          live_period: 3600,
        },
      }),
    );
    expect(text).toBe("[location] 48.360000, -107.870000 (±15m, heading 92°, live location)");
  });

  test("reads a venue's coordinates and title", () => {
    const text = formatTelegramLocationText(
      buildMessage({
        venue: {
          title: "Edgewater Inn & RV Park",
          address: "47176 US-2, Malta MT",
          location: { latitude: 48.3597, longitude: -107.8729 },
        },
      }),
    );
    expect(text).toBe(
      "[location] 48.359700, -107.872900 (Edgewater Inn & RV Park, 47176 US-2, Malta MT)",
    );
  });

  test("ignores messages carrying no coordinates", () => {
    expect(formatTelegramLocationText(buildMessage({ text: "hello" }))).toBe("");
  });
});

describe("telegram update routing", () => {
  test("accepts a plain message", () => {
    const update: TelegramUpdate = {
      update_id: 1,
      message: buildMessage({ text: "hello" }),
    };
    expect(getTelegramUpdateSkipReason(update)).toBeNull();
    expect(isTelegramLiveLocationMove(update)).toBe(false);
  });

  test("treats an edited pin as live-location movement, not a new prompt", () => {
    const update: TelegramUpdate = {
      update_id: 2,
      edited_message: buildMessage({
        location: { latitude: 48.4, longitude: -107.9, live_period: 3600 },
      }),
    };
    expect(getTelegramUpdateSkipReason(update)).toBeNull();
    expect(isTelegramLiveLocationMove(update)).toBe(true);
  });

  test("skips an edited text message so the agent is not re-run on it", () => {
    const update: TelegramUpdate = {
      update_id: 3,
      edited_message: buildMessage({ text: "hello (fixed typo)" }),
    };
    expect(getTelegramUpdateSkipReason(update)).toBe("edited-without-location");
  });

  test("skips an update with no message at all", () => {
    expect(getTelegramUpdateSkipReason({ update_id: 4 })).toBe("no-message");
  });
});

describe("telegram location store", () => {
  test("keeps the latest position per chat", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clisbot-location-"));
    const filePath = join(dir, "telegram-locations.json");
    const store = new TelegramLocationStore(filePath);

    await store.record({
      chatId: "8387881738",
      senderName: "Bob",
      latitude: 48.99,
      longitude: -110.2,
      live: true,
      updatedAt: new Date().toISOString(),
    });
    await store.record({
      chatId: "8387881738",
      senderName: "Bob",
      latitude: 48.36,
      longitude: -107.87,
      live: true,
      updatedAt: new Date().toISOString(),
    });

    const current = await store.get("8387881738");
    expect(current?.latitude).toBe(48.36);
    expect(current?.longitude).toBe(-107.87);

    // Readable by agent tooling without going through clisbot.
    const onDisk = JSON.parse(await readFile(filePath, "utf8"));
    expect(onDisk.locations["8387881738"].latitude).toBe(48.36);
  });

  test("drops positions older than the retention window", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clisbot-location-"));
    const store = new TelegramLocationStore(join(dir, "telegram-locations.json"), 1000);

    await store.record({
      chatId: "stale",
      latitude: 1,
      longitude: 2,
      live: false,
      updatedAt: new Date(Date.now() - 60_000).toISOString(),
    });
    await store.record({
      chatId: "fresh",
      latitude: 3,
      longitude: 4,
      live: false,
      updatedAt: new Date().toISOString(),
    });

    const all = await store.all();
    expect(all.stale).toBeUndefined();
    expect(all.fresh?.latitude).toBe(3);
  });
});
