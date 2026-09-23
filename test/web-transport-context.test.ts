import { expect, test } from "bun:test";
import type { WebSocket } from "ws";
import { postWebText, reconcileWebText, sendWebDone, sendWebError } from "../src/channels/web/transport.ts";

test("interleaved web responses retain their originating task", async () => {
  const sent: Array<Record<string, unknown>> = [];
  const ws = { send: (raw: string) => sent.push(JSON.parse(raw)) } as unknown as WebSocket;
  const first = await postWebText(ws, "First", "one");
  await postWebText(ws, "Second", "two");
  await reconcileWebText(ws, first, "First finished", "one");
  sendWebError(ws, "Failed", "two");
  sendWebDone(ws, "one");
  expect(sent.map(m => m.contextId)).toEqual(["one", "two", "one", "two", "one"]);
  expect(sent[2].id).toBe(sent[0].id);
});
