import { describe, expect, test } from "bun:test";
import { submitTmuxSessionInput } from "../src/runners/tmux/session-handshake.ts";
import type { TmuxClient, TmuxPaneState } from "../src/runners/tmux/client.ts";

/**
 * A pane that accepts the paste immediately but only repaints after the prompt is
 * submitted — and does so `repaintDelayMs` after Enter, the way a loaded host behaves.
 */
function createFakePane(options: { repaintDelayMs: number; acceptEnter?: boolean }) {
  const enterTimes: number[] = [];
  let pasted = false;
  let submittedAt: number | undefined;
  let historySize = 0;

  const currentSnapshot = () => {
    if (submittedAt !== undefined && Date.now() - submittedAt >= options.repaintDelayMs) {
      return "> \nrunning…";
    }
    return pasted ? "> hello prompt" : "> ";
  };

  const tmux = {
    async sendLiteral(_session: string, _text: string) {
      pasted = true;
      historySize += 1;
    },
    async sendKey(_session: string, key: string) {
      if (key !== "Enter") {
        return;
      }
      enterTimes.push(Date.now());
      if (options.acceptEnter === false) {
        return;
      }
      if (submittedAt === undefined) {
        submittedAt = Date.now();
      }
    },
    async capturePane(_session: string, _lines: number) {
      return currentSnapshot();
    },
    async getPaneState(_session: string): Promise<TmuxPaneState> {
      const repainted =
        submittedAt !== undefined && Date.now() - submittedAt >= options.repaintDelayMs;
      return {
        cursorX: 0,
        cursorY: 0,
        historySize: historySize + (repainted ? 1 : 0),
      };
    },
  } as unknown as TmuxClient;

  return { tmux, enterTimes };
}

describe("tmux submit confirmation", () => {
  test("waits out a slow repaint instead of re-sending Enter", async () => {
    // 600ms is far past the old 160ms budget but well within a realistic repaint.
    const { tmux, enterTimes } = createFakePane({ repaintDelayMs: 600 });

    await submitTmuxSessionInput({
      tmux,
      sessionName: "agent",
      text: "hello prompt",
      promptSubmitDelayMs: 0,
    });

    // Exactly one Enter: a second one would submit an empty prompt into a box the
    // runner already cleared, waking the agent with no user input.
    expect(enterTimes.length).toBe(1);
  });

  test("confirms immediately when the pane repaints fast", async () => {
    const { tmux, enterTimes } = createFakePane({ repaintDelayMs: 0 });

    await submitTmuxSessionInput({
      tmux,
      sessionName: "agent",
      text: "hello prompt",
      promptSubmitDelayMs: 0,
    });

    expect(enterTimes.length).toBe(1);
  });

  // A dead pane is only declared dead after both confirmation windows elapse, so this
  // takes ~6s by design. Failing slow beats failing wrong: the caller's reaction to this
  // error is to kill the session and re-run the prompt.
  test(
    "still reports an unconfirmed submit when Enter genuinely never lands",
    async () => {
      const { tmux, enterTimes } = createFakePane({
        repaintDelayMs: 0,
        acceptEnter: false,
      });

      await expect(
        submitTmuxSessionInput({
          tmux,
          sessionName: "agent",
          text: "hello prompt",
          promptSubmitDelayMs: 0,
        }),
      ).rejects.toThrow(/not confirmed/i);

      // One retry before giving up.
      expect(enterTimes.length).toBe(2);
    },
    15_000,
  );
});
