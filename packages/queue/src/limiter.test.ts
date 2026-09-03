/// <reference types="bun" />
import { describe, expect, it } from "bun:test";
import { SendPacer, isRateLimited, retryAfterMs } from "./limiter.ts";

/** A clock the test advances by hand. */
function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

/** Jitter fixed at its midpoint, so limit arithmetic is exact. */
const midJitter = () => 0.5;

describe("jitter", () => {
  it("is applied to every send", () => {
    const pacer = new SendPacer({ now: () => 0, random: midJitter });
    // 35 + 0.5 * (50 - 35) = 42.5
    expect(pacer.reserve("chat-1")).toBeCloseTo(42.5, 5);
  });

  it("always falls inside the configured band", () => {
    const values: number[] = [];
    const pacer = new SendPacer({
      now: () => 0,
      random: () => values.length / 20,
    });
    for (let i = 0; i < 20; i++) values.push(pacer.reserve(`chat-${i}`));
    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(35);
      expect(value).toBeLessThan(50);
    }
  });

  it("is not constant — uniform intervals are a machine signature", () => {
    const pacer = new SendPacer({ now: () => 0, random: Math.random });
    const delays = new Set(
      Array.from({ length: 25 }, (_, i) => pacer.reserve(`chat-${i}`)),
    );
    expect(delays.size).toBeGreaterThan(1);
  });

  it("honours a custom band", () => {
    const pacer = new SendPacer({
      now: () => 0,
      random: () => 0,
      jitterMinMs: 5,
      jitterMaxMs: 6,
    });
    expect(pacer.reserve("chat-1")).toBe(5);
  });
});

describe("per-chat limit", () => {
  it("spaces two messages to the same chat by at least a second", () => {
    const time = clock();
    const pacer = new SendPacer({ now: time.now, random: midJitter });
    const first = pacer.reserve("chat-1");
    const second = pacer.reserve("chat-1");
    expect(second - first).toBeGreaterThanOrEqual(1_000);
  });

  it("does not hold up a different chat", () => {
    const time = clock();
    const pacer = new SendPacer({ now: time.now, random: midJitter });
    pacer.reserve("chat-1");
    expect(pacer.reserve("chat-2")).toBeLessThan(100);
  });

  it("lets the same chat send again once the second has passed", () => {
    const time = clock();
    const pacer = new SendPacer({ now: time.now, random: midJitter });
    pacer.reserve("chat-1");
    time.advance(2_000);
    expect(pacer.reserve("chat-1")).toBeLessThan(100);
  });

  it("forgets a chat on request", () => {
    const time = clock();
    const pacer = new SendPacer({ now: time.now, random: midJitter });
    pacer.reserve("chat-1");
    pacer.forget("chat-1");
    expect(pacer.reserve("chat-1")).toBeLessThan(100);
  });
});

describe("global limit", () => {
  it("allows 30 sends inside one second", () => {
    const pacer = new SendPacer({ now: () => 0, random: midJitter });
    const delays = Array.from({ length: 30 }, (_, i) =>
      pacer.reserve(`chat-${i}`),
    );
    expect(Math.max(...delays)).toBeLessThan(1_000);
  });

  it("pushes the 31st send past the window", () => {
    const pacer = new SendPacer({ now: () => 0, random: midJitter });
    for (let i = 0; i < 30; i++) pacer.reserve(`chat-${i}`);
    expect(pacer.reserve("chat-31")).toBeGreaterThanOrEqual(1_000);
  });

  it("recovers once the window rolls forward", () => {
    const time = clock();
    const pacer = new SendPacer({ now: time.now, random: midJitter });
    for (let i = 0; i < 30; i++) pacer.reserve(`chat-${i}`);
    time.advance(2_000);
    expect(pacer.reserve("chat-new")).toBeLessThan(100);
  });

  it("honours a custom global rate", () => {
    const pacer = new SendPacer({
      now: () => 0,
      random: midJitter,
      globalPerSecond: 2,
    });
    pacer.reserve("a");
    pacer.reserve("b");
    expect(pacer.reserve("c")).toBeGreaterThanOrEqual(1_000);
  });
});

describe("group limit", () => {
  it("allows 20 messages a minute into a group", () => {
    const time = clock();
    const pacer = new SendPacer({ now: time.now, random: midJitter });
    let last = 0;
    for (let i = 0; i < 20; i++) {
      last = pacer.reserve("group-1", true);
      time.advance(1_100); // stay clear of the per-chat limit
    }
    expect(last).toBeLessThan(1_000);
  });

  it("delays the 21st message in the same minute", () => {
    const time = clock();
    const pacer = new SendPacer({ now: time.now, random: midJitter });
    for (let i = 0; i < 20; i++) {
      pacer.reserve("group-1", true);
      time.advance(1_100);
    }
    expect(pacer.reserve("group-1", true)).toBeGreaterThan(30_000);
  });

  it("does not apply the group limit to a direct chat", () => {
    const time = clock();
    const pacer = new SendPacer({ now: time.now, random: midJitter });
    for (let i = 0; i < 25; i++) {
      pacer.reserve("chat-1", false);
      time.advance(1_100);
    }
    expect(pacer.reserve("chat-1", false)).toBeLessThan(1_000);
  });

  it("keeps groups independent of each other", () => {
    const time = clock();
    const pacer = new SendPacer({ now: time.now, random: midJitter });
    for (let i = 0; i < 20; i++) {
      pacer.reserve("group-1", true);
      time.advance(1_100);
    }
    expect(pacer.reserve("group-2", true)).toBeLessThan(1_000);
  });
});

describe("retryAfterMs", () => {
  it("reads Telegram's retry_after in seconds", () => {
    expect(retryAfterMs({ status: 429, parameters: { retry_after: 12 } })).toBe(
      12_000,
    );
  });

  it("reads it from a nested response object", () => {
    expect(retryAfterMs({ response: { parameters: { retry_after: 3 } } })).toBe(
      3_000,
    );
  });

  it("falls back generously when the value is missing", () => {
    // Retrying immediately after a 429 is how a pause becomes a ban.
    expect(retryAfterMs({ status: 429 })).toBe(30_000);
    expect(retryAfterMs(new Error("boom"))).toBe(30_000);
    expect(retryAfterMs(null)).toBe(30_000);
  });

  it("ignores a nonsensical value", () => {
    expect(retryAfterMs({ parameters: { retry_after: -5 } })).toBe(30_000);
    expect(retryAfterMs({ parameters: { retry_after: Number.NaN } })).toBe(
      30_000,
    );
  });

  it("rounds a fractional value up", () => {
    expect(retryAfterMs({ parameters: { retry_after: 1.2 } })).toBe(1_200);
  });

  it("honours a custom fallback", () => {
    expect(retryAfterMs({}, 5)).toBe(5_000);
  });
});

describe("isRateLimited", () => {
  it("recognises a 429 on either field", () => {
    expect(isRateLimited({ status: 429 })).toBe(true);
    expect(isRateLimited({ statusCode: 429 })).toBe(true);
  });

  it("does not treat other failures as rate limiting", () => {
    expect(isRateLimited({ status: 500 })).toBe(false);
    expect(isRateLimited(new Error("network"))).toBe(false);
    expect(isRateLimited(undefined)).toBe(false);
  });
});
