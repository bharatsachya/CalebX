/// <reference types="bun" />
import { beforeEach, describe, expect, it } from "bun:test";
import { SendPacer } from "./limiter.ts";
import {
  dispatchOnce,
  fallbackJob,
  type DispatchDeps,
  type Sender,
} from "./dispatch.ts";
import type { DispatchJob } from "./payloads.ts";

const job: DispatchJob = {
  chatId: "chat-1",
  text: "There's a place on 12th Main you'd like.",
  channel: "tg",
};

function makeDeps(sender: Sender, options: { pacer?: SendPacer } = {}) {
  const slept: number[] = [];
  const requeued: { job: DispatchJob; delayMs: number }[] = [];
  const deps: DispatchDeps = {
    senders: { tg: sender, wa: sender },
    pacer: options.pacer ?? new SendPacer({ now: () => 0, random: () => 0.5 }),
    sleep: async (ms) => {
      slept.push(ms);
    },
    requeue: async (requeuedJob, delayMs) => {
      requeued.push({ job: requeuedJob, delayMs });
    },
  };
  return { deps, slept, requeued };
}

function okSender(sent: DispatchJob[] = []): Sender {
  return {
    async send(outgoing) {
      sent.push(outgoing);
    },
  };
}

function throwingSender(error: unknown): Sender {
  return {
    async send() {
      throw error;
    },
  };
}

describe("dispatchOnce", () => {
  let sent: DispatchJob[];

  beforeEach(() => {
    sent = [];
  });

  it("waits for the paced slot, then sends", async () => {
    const { deps, slept } = makeDeps(okSender(sent));
    const result = await dispatchOnce(deps, job);
    expect(result).toEqual({ kind: "sent", waitedMs: 42.5 });
    expect(slept).toEqual([42.5]);
    expect(sent).toHaveLength(1);
  });

  it("applies jitter to the very first message", async () => {
    // Every send is jittered — an unjittered first message is still a signature.
    const { deps, slept } = makeDeps(okSender(sent));
    await dispatchOnce(deps, job);
    expect(slept[0]).toBeGreaterThanOrEqual(35);
  });

  it("spaces two messages to the same chat", async () => {
    const { deps, slept } = makeDeps(okSender(sent));
    await dispatchOnce(deps, job);
    await dispatchOnce(deps, job);
    expect(slept[1]).toBeGreaterThanOrEqual(1_000);
  });

  it("re-queues on a 429 instead of retrying inline", async () => {
    // Sleeping through retry_after inside the single dispatch worker would hold
    // every other chat hostage for the same window.
    const { deps, requeued, slept } = makeDeps(
      throwingSender({ status: 429, parameters: { retry_after: 7 } }),
    );
    const result = await dispatchOnce(deps, job);
    expect(result).toEqual({ kind: "requeued", retryAfterMs: 7_000 });
    expect(requeued).toEqual([{ job, delayMs: 7_000 }]);
    expect(slept).not.toContain(7_000);
  });

  it("uses a generous fallback when a 429 carries no retry_after", async () => {
    const { deps, requeued } = makeDeps(throwingSender({ status: 429 }));
    await dispatchOnce(deps, job);
    expect(requeued[0].delayMs).toBe(30_000);
  });

  it("reports an ordinary failure without re-queueing", async () => {
    const { deps, requeued } = makeDeps(
      throwingSender(new Error("network down")),
    );
    const result = await dispatchOnce(deps, job);
    expect(result.kind).toBe("failed");
    expect(requeued).toEqual([]);
  });

  it("fails a job for a channel this process does not serve", async () => {
    const { deps } = makeDeps(okSender(sent));
    const result = await dispatchOnce(
      { ...deps, senders: { tg: deps.senders.tg } as DispatchDeps["senders"] },
      { ...job, channel: "wa" },
    );
    expect(result.kind).toBe("failed");
  });

  it("does not pace WhatsApp against Telegram's budget", async () => {
    // Different platform, different limits, no shared 30/s.
    const { deps, slept } = makeDeps(okSender(sent));
    const result = await dispatchOnce(deps, { ...job, channel: "wa" });
    expect(result).toEqual({ kind: "sent", waitedMs: 0 });
    expect(slept).toEqual([]);
  });

  it("applies the group limit when the chat is a group", async () => {
    const pacer = new SendPacer({ now: () => 0, random: () => 0.5 });
    const { deps } = makeDeps(okSender(sent), { pacer });
    await dispatchOnce(deps, { ...job, isGroup: true });
    expect(sent[0].isGroup).toBe(true);
  });
});

describe("fallbackJob", () => {
  it("builds a graceful reply for a dead-lettered job", () => {
    // A failed turn still owes the user a reply.
    const fallback = fallbackJob(job, "Something went wrong on my end.");
    expect(fallback).toEqual({
      chatId: "chat-1",
      channel: "tg",
      isGroup: undefined,
      traceId: undefined,
      text: "Something went wrong on my end.",
      fallback: true,
    });
  });

  it("refuses to build a fallback for a fallback", () => {
    // Otherwise a broken chat produces an endless chain of apologies.
    expect(fallbackJob({ ...job, fallback: true }, "sorry")).toBeNull();
  });

  it("carries the trace id through, so the failure stays joinable", () => {
    const fallback = fallbackJob({ ...job, traceId: "abc123" }, "sorry");
    expect(fallback?.traceId).toBe("abc123");
  });
});
