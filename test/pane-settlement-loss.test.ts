import { describe, expect, test } from "bun:test";
import {
  containsEchoedAgentPrompt,
  stripEchoedAgentPrompt,
} from "../src/channels/message/agent-prompt.ts";

/**
 * Reproduction for the 2026-08-07 finding: when the pane snapshot reaches
 * settleFromPaneResult with its angle-bracket tags already removed, the stripper is a
 * no-op (it is purely tag-based) and the marker backstop then suppresses the ENTIRE
 * body -- discarding any genuine reply the agent wrote alongside the echoed prompt.
 *
 * `~/.clisbot/state/clisbot.log` shows 32 suppressions (default 21, nova 9, cadence 1,
 * four-threads 1) with `chars` from 1937 to 2810. The injected prompt alone is ~1900
 * chars, so the larger ones were carrying several hundred characters of something else
 * to the floor with it.
 */

// A realistic echoed prompt, minus the <system> wrapper -- which is exactly what the
// interaction renderer hands to settleFromPaneResult for a completed run.
const ECHOED_NO_TAGS = `Message context:
- time: 2026-08-03T00:15:00.000Z
- sender: Bob Bertoni [telegram:8387881738, @bobertoni]

You are operating inside clisbot.
To send a user-visible progress update or final reply, use the following CLI command:
clisbot message send \\
  --channel telegram \\
  --bot nova \\
  --target 8387881738 \\
  --input md \\
  --render native \\
  --final|progress \\
  --message "..."
When replying to the user:
- put the user-facing message inside the --message body of that command
- send at most 3 short, meaningful progress updates; skip trivial internal steps`;

const REAL_REPLY =
  "Recategorised the $500 Venmo as a transfer, not income. Budget totals updated.";

describe("pane settlement: tag-stripped prompt", () => {
  test("with tags intact, the stripper removes the prompt and keeps the reply", () => {
    const withTags = `<system>\n${ECHOED_NO_TAGS}\n</system>\n\n${REAL_REPLY}`;
    const stripped = stripEchoedAgentPrompt(withTags);
    expect(stripped).toBe(REAL_REPLY);
    expect(containsEchoedAgentPrompt(stripped)).toBe(false);
  });

  test("REGRESSION: with tags removed, the stripper is a no-op", () => {
    const rendered = `${ECHOED_NO_TAGS}\n\n${REAL_REPLY}`;
    const stripped = stripEchoedAgentPrompt(rendered);
    // Nothing was removed -- there was no <system> tag to key on.
    expect(stripped).toBe(rendered.trim());
    // ...so the backstop correctly fires, and settleFromPaneResult drops EVERYTHING.
    expect(containsEchoedAgentPrompt(stripped)).toBe(true);
  });

  test("REGRESSION: the agent's genuine reply is what gets thrown away", () => {
    const rendered = `${ECHOED_NO_TAGS}\n\n${REAL_REPLY}`;
    const stripped = stripEchoedAgentPrompt(rendered);
    const suppressed = containsEchoedAgentPrompt(stripped);
    // This is the user-visible harm: a real answer existed and was discarded.
    expect(suppressed).toBe(true);
    expect(stripped).toContain(REAL_REPLY);
  });
});

// ---------------------------------------------------------------- the fix

import { stripInjectedPromptText } from "../src/channels/message/agent-prompt.ts";

// What clisbot actually injects: the same text, still wearing its tags.
const INJECTED = `<system>\n${ECHOED_NO_TAGS}\n</system>\n\n<user>\nNo it's fine I trust you\n</user>`;

describe("stripInjectedPromptText", () => {
  test("recovers the reply when the renderer has eaten the tags", () => {
    const rendered = `${ECHOED_NO_TAGS}\n\n${REAL_REPLY}`;
    const out = stripInjectedPromptText(rendered, INJECTED);
    expect(out).toContain(REAL_REPLY);
    expect(containsEchoedAgentPrompt(out)).toBe(false);
  });

  test("survives pane re-wrapping (different line breaks than we sent)", () => {
    // A tmux pane wraps to terminal width; the echo is never byte-identical.
    const rewrapped = ECHOED_NO_TAGS.replace(/\n/g, "\n   ").replace(/ /g, "\n");
    const out = stripInjectedPromptText(`${rewrapped}\n\n${REAL_REPLY}`, INJECTED);
    expect(out).toContain(REAL_REPLY);
    expect(containsEchoedAgentPrompt(out)).toBe(false);
  });

  test("NO-OP when the text has no echo — a normal reply is untouched", () => {
    const clean = "Here's the thing you asked for. Done.";
    expect(stripInjectedPromptText(clean, INJECTED)).toBe(clean);
  });

  test("NO-OP with an empty or tiny prompt (cannot match safely)", () => {
    expect(stripInjectedPromptText(REAL_REPLY, "")).toBe(REAL_REPLY);
    expect(stripInjectedPromptText(REAL_REPLY, "hi")).toBe(REAL_REPLY);
  });

  test("does NOT eat a genuine reply that merely QUOTES the prompt wording", () => {
    // The backstop fires on this wording; the stripper must not delete the user's answer.
    const quoting = `You asked why it failed. The log said "You are operating inside clisbot." which is our own prompt echoing back.`;
    expect(stripInjectedPromptText(quoting, INJECTED)).toBe(quoting);
  });

  test("leaves text alone when the echo is only PARTIAL (truncated capture)", () => {
    const half = ECHOED_NO_TAGS.slice(0, 300);
    const out = stripInjectedPromptText(`${half}\n\n${REAL_REPLY}`, INJECTED);
    // No full match -> no removal. The existing backstop still suppresses; we have not
    // made anything worse, and we have not guessed.
    expect(out).toContain(REAL_REPLY);
  });
});
