/// <reference types="bun" />
import { describe, expect, it } from "bun:test";
import {
  EMPTY_EXTRACTION,
  extractionPromptFor,
  parseExtraction,
} from "./extraction.ts";

describe("extractionPromptFor", () => {
  it("uses a different prompt per mode", () => {
    // "I like quiet places" is a venue preference in one mode and a temperament
    // signal in the other; one shared extractor would blur both.
    const matchmaker = extractionPromptFor("matchmaker");
    const community = extractionPromptFor("community_connector");
    expect(matchmaker).not.toBe(community);
    expect(matchmaker).toContain("prefs");
    expect(community).toContain("chunks");
  });
});

describe("parseExtraction", () => {
  it("parses a well-formed community extraction", () => {
    const out = parseExtraction(
      JSON.stringify({
        intents: ["find_places"],
        entities: ["Koramangala"],
        sentiment: "positive",
        location_hint: "Koramangala",
        chunks: [
          { text: "prefers quiet cafes for work", category: "interest" },
        ],
      }),
    );
    expect(out.intents).toEqual(["find_places"]);
    expect(out.locationHint).toBe("Koramangala");
    expect(out.chunks).toEqual([
      { text: "prefers quiet cafes for work", category: "interest" },
    ]);
  });

  it("parses a well-formed matchmaker extraction", () => {
    const out = parseExtraction(
      JSON.stringify({
        intents: [],
        entities: [],
        sentiment: "neutral",
        location_hint: null,
        prefs: {
          ageMin: 27,
          ageMax: 33,
          dietPref: "vegetarian",
          prefTags: ["travel"],
        },
      }),
    );
    expect(out.prefs).toEqual({
      ageMin: 27,
      ageMax: 33,
      dietPref: "vegetarian",
      prefTags: ["travel"],
    });
  });

  it("returns an empty extraction for prose", () => {
    // This runs in a background job whose failure the user never sees, so a
    // crash here would just silently lose a persona write.
    expect(parseExtraction("Sure! Here's what I found.")).toBe(
      EMPTY_EXTRACTION,
    );
  });

  it("returns an empty extraction for truncated JSON", () => {
    expect(parseExtraction('{"intents":["a"')).toBe(EMPTY_EXTRACTION);
  });

  it("returns an empty extraction for a JSON array", () => {
    expect(parseExtraction("[1,2,3]")).toBe(EMPTY_EXTRACTION);
  });

  it("strips markdown fences", () => {
    const out = parseExtraction('```json\n{"sentiment":"positive"}\n```');
    expect(out.sentiment).toBe("positive");
  });

  it("defaults an unknown sentiment to neutral", () => {
    expect(parseExtraction('{"sentiment":"ecstatic"}').sentiment).toBe(
      "neutral",
    );
  });

  it("drops chunks with an unknown category", () => {
    const out = parseExtraction(
      JSON.stringify({
        chunks: [{ text: "likes long walks", category: "vibes" }],
      }),
    );
    expect(out.chunks).toEqual([]);
  });

  it("drops chunks too short to be useful", () => {
    const out = parseExtraction(
      JSON.stringify({ chunks: [{ text: "cafes", category: "interest" }] }),
    );
    expect(out.chunks).toEqual([]);
  });

  it("caps chunks at five", () => {
    const chunks = Array.from({ length: 9 }, (_, index) => ({
      text: `a durable fact number ${index}`,
      category: "interest",
    }));
    expect(parseExtraction(JSON.stringify({ chunks })).chunks).toHaveLength(5);
  });

  it("coerces numeric strings in prefs", () => {
    expect(parseExtraction('{"prefs":{"ageMin":"28"}}').prefs.ageMin).toBe(28);
  });

  it("discards an inverted age range rather than storing it", () => {
    // Stored inverted, it matches nobody and reads as "no results".
    const out = parseExtraction('{"prefs":{"ageMin":40,"ageMax":30}}');
    expect(out.prefs.ageMin).toBeUndefined();
    expect(out.prefs.ageMax).toBeUndefined();
  });

  it("keeps a single-ended age range", () => {
    expect(parseExtraction('{"prefs":{"ageMin":30}}').prefs.ageMin).toBe(30);
  });

  it("omits absent pref fields entirely rather than as undefined keys", () => {
    const out = parseExtraction('{"prefs":{"dietPref":"jain"}}');
    expect(Object.keys(out.prefs)).toEqual(["dietPref"]);
  });

  it("ignores blank strings in lists", () => {
    expect(
      parseExtraction('{"intents":["", "  ", "find_places"]}').intents,
    ).toEqual(["find_places"]);
  });

  it("treats a missing location hint as null", () => {
    expect(parseExtraction("{}").locationHint).toBeNull();
    expect(parseExtraction('{"location_hint":""}').locationHint).toBeNull();
  });

  it("survives a null chunks field", () => {
    expect(parseExtraction('{"chunks":null}').chunks).toEqual([]);
  });

  it("survives entirely wrong types", () => {
    const out = parseExtraction(
      '{"intents":"nope","entities":5,"chunks":"x","prefs":"y"}',
    );
    expect(out.intents).toEqual([]);
    expect(out.entities).toEqual([]);
    expect(out.chunks).toEqual([]);
    expect(out.prefs).toEqual({});
  });
});
