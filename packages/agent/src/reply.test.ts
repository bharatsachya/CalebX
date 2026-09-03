/// <reference types="bun" />
import { describe, expect, it } from "bun:test";
import {
  enforceOneQuestion,
  finalizeReply,
  stripInternalsTalk,
} from "./reply.ts";

describe("enforceOneQuestion", () => {
  it("leaves a single-question message alone", () => {
    const text = "There's a place in Indiranagar you'd like. Want the name?";
    expect(enforceOneQuestion(text)).toBe(text);
  });

  it("drops the second and later questions", () => {
    // Three questions at once reads as a form, which is what CALEBX is not.
    const out = enforceOneQuestion(
      "Which city are you in? Do you work from cafes? How old are you?",
    );
    expect(out).toBe("Which city are you in?");
  });

  it("keeps statements that come after a dropped question", () => {
    const out = enforceOneQuestion(
      "Want the name? It's near the metro. Shall I send it?",
    );
    expect(out).toContain("Want the name?");
    expect(out).toContain("It's near the metro.");
    expect(out).not.toContain("Shall I send it?");
  });

  it("keeps a statement that precedes the only question", () => {
    const out = enforceOneQuestion("Good to hear. What part of town?");
    expect(out).toBe("Good to hear. What part of town?");
  });

  it("leaves a message with no question alone", () => {
    expect(enforceOneQuestion("Noted, that helps.")).toBe("Noted, that helps.");
  });

  it("handles an empty string", () => {
    expect(enforceOneQuestion("")).toBe("");
  });

  it("handles a question with no terminator", () => {
    expect(enforceOneQuestion("which city")).toBe("which city");
  });

  it("survives a message that is only questions", () => {
    expect(enforceOneQuestion("Which city? Which area? Why?")).toBe(
      "Which city?",
    );
  });

  it("preserves newlines between kept sentences", () => {
    const out = enforceOneQuestion("First line.\nWhich city?\nAnd which area?");
    expect(out).toContain("First line.");
    expect(out).toContain("Which city?");
    expect(out).not.toContain("And which area?");
  });
});

describe("stripInternalsTalk", () => {
  it("removes a sentence that narrates the machinery", () => {
    const out = stripInternalsTalk(
      "Let me search the database. There's a place you'd like.",
    );
    expect(out).toBe("There's a place you'd like.");
  });

  it("catches every forbidden word", () => {
    for (const word of [
      "vector",
      "embedding",
      "Neo4j",
      "Postgres",
      "mem0",
      "tool call",
      "my tools",
      "LLM",
      "OpenRouter",
    ]) {
      expect(
        stripInternalsTalk(`I used the ${word} for this. Here you go.`),
      ).toBe("Here you go.");
    }
  });

  it("returns an empty string when the whole reply was internals talk", () => {
    // The caller substitutes a fallback; sending nothing is not an option.
    expect(stripInternalsTalk("Querying the vector database now.")).toBe("");
  });

  it("leaves an ordinary reply untouched", () => {
    const text = "There's a quiet spot off 12th Main. Want the name?";
    expect(stripInternalsTalk(text)).toBe(text);
  });

  it("is case-insensitive", () => {
    expect(stripInternalsTalk("DATABASE lookup done. Fine.")).toBe("Fine.");
  });
});

describe("finalizeReply", () => {
  const FALLBACK = "I'm here — what's on your mind?";

  it("applies both rules in order", () => {
    const out = finalizeReply(
      "Checking the database. Which city are you in? And which area?",
      FALLBACK,
    );
    expect(out).toBe("Which city are you in?");
  });

  it("falls back when the model returned nothing", () => {
    expect(finalizeReply("", FALLBACK)).toBe(FALLBACK);
    expect(finalizeReply("   ", FALLBACK)).toBe(FALLBACK);
  });

  it("falls back when stripping left nothing", () => {
    expect(finalizeReply("Running the embedding pipeline.", FALLBACK)).toBe(
      FALLBACK,
    );
  });

  it("keeps a good reply verbatim", () => {
    const text = "That sounds like Koramangala weather. Which side are you on?";
    expect(finalizeReply(text, FALLBACK)).toBe(text);
  });
});
