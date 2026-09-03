/// <reference types="bun" />
import { describe, expect, it } from "bun:test";
import { looksLikeRecommendationRequest, parseCommand } from "./intent.ts";

describe("looksLikeRecommendationRequest", () => {
  it("recognises plain-language asks", () => {
    for (const text of [
      "can you recommend somewhere?",
      "any suggestions for the weekend",
      "show me some matches",
      "know a place near koramangala",
      "who should I meet",
      "got anything for a saturday",
      "any groups I'd like?",
    ]) {
      expect(looksLikeRecommendationRequest(text)).toBe(true);
    }
  });

  it("ignores ordinary conversation", () => {
    for (const text of [
      "just moved here from pune",
      "I work in product design",
      "yeah that sounds right",
      "not really into loud places",
    ]) {
      expect(looksLikeRecommendationRequest(text)).toBe(false);
    }
  });

  it("does not fire on an explicit refusal", () => {
    expect(
      looksLikeRecommendationRequest("please don't recommend anything"),
    ).toBe(false);
    expect(looksLikeRecommendationRequest("stop recommending places")).toBe(
      false,
    );
  });

  it("is case-insensitive", () => {
    expect(looksLikeRecommendationRequest("SHOW ME matches")).toBe(true);
  });

  it("handles empty input", () => {
    expect(looksLikeRecommendationRequest("")).toBe(false);
  });
});

describe("parseCommand", () => {
  it("returns null for ordinary text", () => {
    expect(parseCommand("hello there")).toBeNull();
    expect(parseCommand("  ")).toBeNull();
  });

  it("parses a bare command", () => {
    expect(parseCommand("/switch")).toEqual({ name: "switch" });
  });

  it("parses a command with an argument", () => {
    expect(parseCommand("/switch community")).toEqual({
      name: "switch",
      argument: "community",
    });
  });

  it("keeps a multi-word argument intact", () => {
    expect(parseCommand("/switch community connector")).toEqual({
      name: "switch",
      argument: "community connector",
    });
  });

  it("strips the @botname suffix groups add", () => {
    expect(parseCommand("/switch@calebx_bot community")).toEqual({
      name: "switch",
      argument: "community",
    });
  });

  it("lowercases the command name", () => {
    expect(parseCommand("/START")).toEqual({ name: "start" });
  });

  it("tolerates leading and trailing whitespace", () => {
    expect(parseCommand("  /forget  ")).toEqual({ name: "forget" });
  });

  it("returns null for a lone slash", () => {
    expect(parseCommand("/")).toBeNull();
  });
});
