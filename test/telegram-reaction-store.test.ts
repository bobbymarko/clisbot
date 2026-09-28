import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TelegramReactionStore,
  summarizeTelegramReactions,
} from "../src/channels/telegram/reaction-store.ts";

const at = (s: number) => new Date(Date.now() - s * 1000).toISOString();

describe("TelegramReactionStore", () => {
  test("take returns pending reactions once, then nothing", async () => {
    const store = new TelegramReactionStore(join(mkdtempSync(join(tmpdir(), "rx-")), "r.json"));
    await store.record("nova:1", { messageId: 10, userName: "Bob", emojis: ["👍"], updatedAt: at(5) });
    const first = await store.take("nova:1");
    expect(summarizeTelegramReactions(first)).toEqual(["Bob 👍 on #10"]);
    expect(await store.take("nova:1")).toEqual([]);
  });

  test("a changed reaction overwrites instead of stacking, and removal is reported", async () => {
    const store = new TelegramReactionStore(join(mkdtempSync(join(tmpdir(), "rx-")), "r.json"));
    await store.record("nova:1", { messageId: 10, userName: "Bob", emojis: ["👍"], updatedAt: at(9) });
    await store.record("nova:1", { messageId: 10, userName: "Bob", emojis: [], updatedAt: at(1) });
    expect(summarizeTelegramReactions(await store.take("nova:1"))).toEqual([
      "Bob removed their reaction on #10",
    ]);
  });

  test("bots sharing a DM chat id never see each other's reactions", async () => {
    const store = new TelegramReactionStore(join(mkdtempSync(join(tmpdir(), "rx-")), "r.json"));
    await store.record("nova:1", { messageId: 10, userName: "Bob", emojis: ["❤"], updatedAt: at(2) });
    expect(await store.take("burro:1")).toEqual([]);
    expect((await store.take("nova:1")).length).toBe(1);
  });
});
