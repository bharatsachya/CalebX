/// <reference types="bun" />
import { describe, expect, it, mock } from "bun:test";
import { withTyping } from "./typing.ts";

describe("withTyping", () => {
  it("sends typing chat action immediately when context supports it", async () => {
    let actionSent: string | null = null;
    const context = {
      async sendChatAction(action: string) {
        actionSent = action;
      },
    };

    const result = await withTyping(context, async () => {
      expect(actionSent).toBe("typing");
      return "done";
    });

    expect(result).toBe("done");
    expect(actionSent as string | null).toBe("typing");
  });

  it("handles context without sendChatAction gracefully", async () => {
    const context = { send() {} };
    const result = await withTyping(context, async () => "works");
    expect(result).toBe("works");
  });

  it("handles null or undefined context gracefully", async () => {
    const result1 = await withTyping(null, async () => 123);
    const result2 = await withTyping(undefined, async () => 456);
    expect(result1).toBe(123);
    expect(result2).toBe(456);
  });

  it("swallows errors from sendChatAction so task execution is unaffected", async () => {
    const context = {
      async sendChatAction() {
        throw new Error("Telegram rate limit 429");
      },
    };

    const result = await withTyping(context, async () => "unaffected");
    expect(result).toBe("unaffected");
  });

  it("cleans up timer when task throws", async () => {
    const context = {
      async sendChatAction() {},
    };

    await expect(
      withTyping(context, async () => {
        throw new Error("Task failed");
      }),
    ).rejects.toThrow("Task failed");
  });
});
