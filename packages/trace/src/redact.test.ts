/// <reference types="bun" />
import { describe, expect, it } from "bun:test";
import {
  fingerprint,
  isSensitiveKey,
  maskUserId,
  redactAttributes,
} from "./redact.ts";

describe("fingerprint", () => {
  it("keeps length and a stable hash, not the value", () => {
    const out = fingerprint("I love working from cafes");
    expect(out).toBe("[redacted:25:3f5c6db3]");
    expect(out).not.toContain("cafes");
  });

  it("is stable for equal inputs and different for different ones", () => {
    expect(fingerprint("hello")).toBe(fingerprint("hello"));
    expect(fingerprint("hello")).not.toBe(fingerprint("hellp"));
  });

  it("handles the empty string without throwing", () => {
    expect(fingerprint("")).toBe("[redacted:0:811c9dc5]");
  });
});

describe("maskUserId", () => {
  it("masks a WhatsApp id, which is a phone number", () => {
    expect(maskUserId("wa:16505551234")).toBe("wa:***234");
  });

  it("masks a Telegram id but keeps the channel readable", () => {
    expect(maskUserId("tg:1101953596")).toBe("tg:***596");
  });

  it("does not pad short native ids into something longer", () => {
    expect(maskUserId("tg:7")).toBe("tg:***7");
    expect(maskUserId("tg:42")).toBe("tg:***42");
  });

  it("fingerprints an id with no namespace rather than passing it through", () => {
    // An unrecognised shape is exactly when we do not know what we are logging.
    expect(maskUserId("1101953596")).toStartWith("[redacted:10:");
  });

  it("fingerprints a namespace with an empty native id", () => {
    expect(maskUserId("tg:")).toStartWith("[redacted:3:");
  });

  it("fingerprints a leading-colon id", () => {
    expect(maskUserId(":123")).toStartWith("[redacted:4:");
  });
});

describe("isSensitiveKey", () => {
  it("matches on substrings so unwritten attributes are covered", () => {
    for (const key of [
      "user_message",
      "replyText",
      "candidate_name",
      "invite_link",
      "OPENROUTER_API_KEY",
      "photoUrl",
      "biodata",
    ]) {
      expect(isSensitiveKey(key)).toBe(true);
    }
  });

  it("allows the explicit exceptions", () => {
    for (const key of [
      "tool.name",
      "model.name",
      "text.length",
      "queue.name",
    ]) {
      expect(isSensitiveKey(key)).toBe(false);
    }
  });

  it("leaves ordinary keys alone", () => {
    for (const key of ["mode", "candidateCount", "durationMs", "attempt"]) {
      expect(isSensitiveKey(key)).toBe(false);
    }
  });
});

describe("redactAttributes", () => {
  it("redacts sensitive strings and keeps the rest", () => {
    const out = redactAttributes({
      mode: "matchmaker",
      "text.length": 25,
      user_message: "I want to meet indie hackers",
      candidateCount: 4,
      flagged: true,
    });
    expect(out.mode).toBe("matchmaker");
    expect(out["text.length"]).toBe(25);
    expect(out.candidateCount).toBe(4);
    expect(out.flagged).toBe(true);
    expect(String(out.user_message)).toStartWith("[redacted:");
  });

  it("masks any key that names a user id", () => {
    const out = redactAttributes({
      userId: "wa:16505551234",
      "peer.userId": "tg:1101953596",
      target_user_id: "wa:447700900123",
    });
    expect(out.userId).toBe("wa:***234");
    expect(out["peer.userId"]).toBe("tg:***596");
    expect(out.target_user_id).toBe("wa:***123");
  });

  it("never mutates the input object", () => {
    const input = { user_message: "hello" };
    redactAttributes(input);
    expect(input.user_message).toBe("hello");
  });

  it("drops undefined values instead of serialising them", () => {
    const out = redactAttributes({ a: 1, b: undefined });
    expect("b" in out).toBe(false);
    expect(out.a).toBe(1);
  });

  it("passes values through verbatim when disabled", () => {
    const out = redactAttributes({ user_message: "hello" }, false);
    expect(out.user_message).toBe("hello");
  });

  it("leaves nulls as nulls", () => {
    expect(redactAttributes({ location_hint: null }).location_hint).toBeNull();
  });

  it("does not redact non-string values under a sensitive key", () => {
    // `message.count` is a number; redacting it would destroy a useful metric.
    expect(redactAttributes({ "message.count": 12 })["message.count"]).toBe(12);
  });
});
