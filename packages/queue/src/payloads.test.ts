/// <reference types="bun" />
import { describe, expect, it } from "bun:test";
import { ValidationError } from "@calebx/errors";
import {
  CONCURRENCY,
  QUEUE_NAMES,
  RETRY_POLICY,
  parseAgentJob,
  parseDispatchJob,
  parseIngestJob,
} from "./payloads.ts";

describe("parseAgentJob", () => {
  const valid = {
    userId: "tg:1001",
    chatId: "1001",
    text: "hey",
    channel: "Telegram",
  };

  it("accepts a well-formed job", () => {
    expect(parseAgentJob(valid)).toEqual({
      ...valid,
      isGroup: false,
      traceId: undefined,
      command: undefined,
    });
  });

  it("rejects missing required fields", () => {
    // A payload written before a deploy is read back by the new worker, so it
    // is validated on the way out rather than trusted.
    for (const field of ["userId", "chatId", "text", "channel"]) {
      expect(() => parseAgentJob({ ...valid, [field]: undefined })).toThrow(
        ValidationError,
      );
    }
  });

  it("rejects a blank string", () => {
    expect(() => parseAgentJob({ ...valid, text: "   " })).toThrow(
      /text is required/,
    );
  });

  it("rejects an oversized message", () => {
    expect(() => parseAgentJob({ ...valid, text: "x".repeat(5_000) })).toThrow(
      /exceeds 4096/,
    );
  });

  it("keeps a valid trace id and drops an invalid one", () => {
    expect(parseAgentJob({ ...valid, traceId: "abc123" }).traceId).toBe(
      "abc123",
    );
    expect(
      parseAgentJob({ ...valid, traceId: "not a trace" }).traceId,
    ).toBeUndefined();
  });

  it("parses a command with and without an argument", () => {
    expect(
      parseAgentJob({ ...valid, command: { name: "switch" } }).command,
    ).toEqual({
      name: "switch",
      argument: undefined,
    });
    expect(
      parseAgentJob({
        ...valid,
        command: { name: "switch", argument: "community" },
      }).command,
    ).toEqual({ name: "switch", argument: "community" });
  });

  it("drops a malformed command rather than failing the job", () => {
    expect(
      parseAgentJob({ ...valid, command: { argument: "x" } }).command,
    ).toBeUndefined();
  });

  it("handles a null payload", () => {
    expect(() => parseAgentJob(null)).toThrow(ValidationError);
  });
});

describe("parseIngestJob", () => {
  const valid = {
    userId: "tg:1001",
    mode: "community_connector",
    text: "I work from cafes",
    reply: "Nice.",
  };

  it("accepts a well-formed job", () => {
    expect(parseIngestJob(valid).mode).toBe("community_connector");
  });

  it("rejects an unknown mode", () => {
    expect(() => parseIngestJob({ ...valid, mode: "dating" })).toThrow(
      /known agent mode/,
    );
  });

  it("allows an empty reply, since a fallback turn still has a message", () => {
    expect(parseIngestJob({ ...valid, reply: "" }).reply).toBe("");
    expect(parseIngestJob({ ...valid, reply: undefined }).reply).toBe("");
  });

  it("still requires the user's text", () => {
    expect(() => parseIngestJob({ ...valid, text: "" })).toThrow(
      ValidationError,
    );
  });
});

describe("parseDispatchJob", () => {
  const valid = { chatId: "1001", text: "hello", channel: "tg" };

  it("accepts a well-formed job", () => {
    expect(parseDispatchJob(valid)).toMatchObject({
      channel: "tg",
      fallback: false,
    });
  });

  it("rejects an unknown channel", () => {
    expect(() => parseDispatchJob({ ...valid, channel: "discord" })).toThrow(
      /must be "tg" or "wa"/,
    );
  });

  it("keeps only known parse modes", () => {
    expect(parseDispatchJob({ ...valid, parseMode: "HTML" }).parseMode).toBe(
      "HTML",
    );
    expect(
      parseDispatchJob({ ...valid, parseMode: "LaTeX" }).parseMode,
    ).toBeUndefined();
  });

  it("carries the fallback flag", () => {
    expect(parseDispatchJob({ ...valid, fallback: true }).fallback).toBe(true);
  });
});

describe("policies", () => {
  it("covers every queue", () => {
    for (const name of Object.values(QUEUE_NAMES)) {
      expect(RETRY_POLICY[name]).toBeDefined();
      expect(CONCURRENCY[name]).toBeDefined();
    }
  });

  it("runs dispatch single-threaded, because the rate limit is global", () => {
    // A second dispatch worker would have its own pacer and no knowledge of the
    // first one's sends.
    expect(CONCURRENCY.dispatch).toBe(1);
  });

  it("retries dispatch hardest and the agent turn least", () => {
    expect(RETRY_POLICY.dispatch.attempts).toBeGreaterThan(
      RETRY_POLICY["agent-execution"].attempts,
    );
  });
});
