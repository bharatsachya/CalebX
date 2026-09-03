/// <reference types="bun" />
import { describe, expect, it } from "bun:test";
import { SendPacer } from "./limiter.ts";
import {
  TYPING_CHANNEL,
  TypingLoop,
  decodeTypingEvent,
  encodeTypingEvent,
  publishTyping,
  type PubSub,
} from "./typing.ts";

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("event encoding", () => {
  it("round-trips an event", () => {
    const event = { chatId: "chat-1", action: "start" as const, isGroup: true };
    expect(decodeTypingEvent(encodeTypingEvent(event))).toEqual(event);
  });

  it("defaults isGroup to false", () => {
    expect(decodeTypingEvent('{"chatId":"c","action":"stop"}')).toEqual({
      chatId: "c",
      action: "stop",
      isGroup: false,
    });
  });

  it("rejects malformed messages rather than throwing", () => {
    // Anything can be published to a Redis channel.
    for (const message of [
      "",
      "not json",
      "{}",
      '{"chatId":"c"}',
      '{"action":"start"}',
      '{"chatId":"","action":"start"}',
      '{"chatId":"c","action":"dance"}',
    ]) {
      expect(decodeTypingEvent(message)).toBeNull();
    }
  });
});

describe("publishTyping", () => {
  it("publishes to the shared channel", async () => {
    const published: { channel: string; message: string }[] = [];
    const bus: PubSub = {
      async publish(channel, message) {
        published.push({ channel, message });
      },
    };
    await publishTyping(bus, { chatId: "chat-1", action: "start" });
    expect(published[0].channel).toBe(TYPING_CHANNEL);
    expect(decodeTypingEvent(published[0].message)?.chatId).toBe("chat-1");
  });
});

describe("TypingLoop", () => {
  it("marks a chat active on start and inactive on stop", () => {
    const loop = new TypingLoop({ now: () => 0 });
    loop.apply({ chatId: "chat-1", action: "start" });
    expect(loop.isActive("chat-1")).toBe(true);
    loop.apply({ chatId: "chat-1", action: "stop" });
    expect(loop.isActive("chat-1")).toBe(false);
  });

  it("is due immediately on the first start", () => {
    const loop = new TypingLoop({ now: () => 0 });
    loop.apply({ chatId: "chat-1", action: "start" });
    expect(loop.due().map((d) => d.chatId)).toEqual(["chat-1"]);
  });

  it("re-sends before Telegram's ~5s expiry", () => {
    const time = clock();
    const loop = new TypingLoop({ now: time.now });
    loop.apply({ chatId: "chat-1", action: "start" });
    loop.due();

    time.advance(3_000);
    expect(loop.due()).toEqual([]);

    time.advance(1_500); // 4.5s total, still inside the 5s expiry
    expect(loop.due().map((d) => d.chatId)).toEqual(["chat-1"]);
  });

  it("stops re-sending once the chat stops", () => {
    const time = clock();
    const loop = new TypingLoop({ now: time.now });
    loop.apply({ chatId: "chat-1", action: "start" });
    loop.due();
    loop.apply({ chatId: "chat-1", action: "stop" });
    time.advance(10_000);
    expect(loop.due()).toEqual([]);
  });

  it("gives up after the hard deadline even with no stop event", () => {
    // A lost stop must not leave a chat typing forever.
    const time = clock();
    const loop = new TypingLoop({ now: time.now, maxDurationMs: 10_000 });
    loop.apply({ chatId: "chat-1", action: "start" });
    loop.due();
    time.advance(11_000);
    expect(loop.due()).toEqual([]);
    expect(loop.isActive("chat-1")).toBe(false);
  });

  it("does not let a repeated start extend the deadline", () => {
    // Otherwise a chatty user keeps the indicator alive indefinitely.
    const time = clock();
    const loop = new TypingLoop({ now: time.now, maxDurationMs: 10_000 });
    loop.apply({ chatId: "chat-1", action: "start" });
    loop.due();
    time.advance(9_000);
    loop.apply({ chatId: "chat-1", action: "start" });
    time.advance(2_000);
    expect(loop.due()).toEqual([]);
  });

  it("draws from the shared send budget, because chat actions count", () => {
    const pacer = new SendPacer({ now: () => 0, random: () => 0.5 });
    const loop = new TypingLoop({ now: () => 0, pacer });
    loop.apply({ chatId: "chat-1", action: "start" });
    const [due] = loop.due();
    expect(due.delayMs).toBeGreaterThanOrEqual(35);
  });

  it("reports no delay when no pacer is wired", () => {
    const loop = new TypingLoop({ now: () => 0 });
    loop.apply({ chatId: "chat-1", action: "start" });
    expect(loop.due()[0].delayMs).toBe(0);
  });

  it("tracks several chats independently", () => {
    const time = clock();
    const loop = new TypingLoop({ now: time.now });
    loop.apply({ chatId: "a", action: "start" });
    loop.due();
    time.advance(1_000);
    loop.apply({ chatId: "b", action: "start" });
    expect(loop.due().map((d) => d.chatId)).toEqual(["b"]);
    expect(loop.activeChats().sort()).toEqual(["a", "b"]);
  });

  it("ignores a stop for a chat that was never started", () => {
    const loop = new TypingLoop({ now: () => 0 });
    expect(() => loop.apply({ chatId: "ghost", action: "stop" })).not.toThrow();
    expect(loop.activeChats()).toEqual([]);
  });
});
