import { describe, expect, test } from "bun:test";
import {
  buildRenderedMessageState,
  renderPlatformInteraction,
  renderPlatformTranscriptCommand,
} from "../src/channels/message/rendering.ts";

// A tmux pane mid-run: the prompt clisbot typed in, then the agent's real answer.
const PANE_WITH_ECHOED_PROMPT = [
  "  ❯ <system>",
  "    Message context:",
  "    - sender: Someone [telegram:1, @someone]",
  "",
  "    You are operating inside clisbot.",
  "    To send a user-visible final reply, use the following CLI command:",
  "    clisbot message send \\",
  "      --channel telegram \\",
  "      --target 1",
  "    </system>",
  "",
  "    <user>",
  "    what is the deposit?",
  "    </user>",
  "",
  "  The deposit is $500.",
].join("\n");

describe("channel rendering", () => {
  // Regression, 2026-08-01: the echoed prompt was stripped AFTER rendering, but
  // the completed-status renderer deletes `<system>` while keeping its body -- so
  // the stripper matched nothing and posted the whole prompt into the chat.
  for (const status of ["running", "completed", "timeout", "detached"] as const) {
    test(`strips the echoed clisbot prompt from a ${status} pane snapshot`, () => {
      const state = buildRenderedMessageState({
        platform: "telegram",
        status,
        snapshot: PANE_WITH_ECHOED_PROMPT,
        maxChars: Number.POSITIVE_INFINITY,
      });

      expect(state.body).not.toContain("You are operating inside clisbot.");
      expect(state.text).not.toContain("You are operating inside clisbot.");
      expect(state.text).not.toContain("clisbot message send");
      // The agent's actual answer must survive -- this path exists to rescue it.
      expect(state.text).toContain("The deposit is $500.");
      // The user's own words are kept in the body; only the tags around them go.
      expect(state.body).toContain("what is the deposit?");
      expect(state.body).not.toContain("<user>");
    });
  }

  test("leaves a genuine reply that mentions system tags alone", () => {
    const state = buildRenderedMessageState({
      platform: "telegram",
      status: "completed",
      snapshot: "Here is the config:\n<system>\nlog_level: debug\n</system>",
      maxChars: Number.POSITIVE_INFINITY,
    });

    expect(state.body).toContain("log_level: debug");
  });

  test("formats transcript command hints using the channel renderer family", () => {
    expect(renderPlatformTranscriptCommand("slack")).toBe("`/transcript`");
    expect(renderPlatformTranscriptCommand("telegram")).toBe("/transcript");
    expect(renderPlatformTranscriptCommand("zalo-bot")).toBe("/transcript");
  });

  test("reuses telegram-family detached rendering for zalo-bot", () => {
    const rendered = renderPlatformInteraction({
      platform: "zalo-bot",
      status: "detached",
      content: "Still working through the repository.",
      maxChars: 200,
      note:
        "This session has been running for over 15 minutes. clisbot left it running and will post the final result here when it completes. Use `/attach` for live updates, `/watch every <duration>` for periodic updates, or `/stop` to interrupt it.",
      allowTranscriptInspection: true,
    });

    expect(rendered).toContain("You can also use /transcript to inspect the current session snapshot.");
    expect(rendered).not.toContain("`/transcript`");
  });
});
