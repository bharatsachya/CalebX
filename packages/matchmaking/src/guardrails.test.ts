/// <reference types="bun" />
import { describe, expect, it } from "bun:test";
import { ForbiddenError } from "@calebx/errors";
import { assertNoContactLeak, looksOffMode } from "./guardrails.ts";

describe("assertNoContactLeak", () => {
  it("passes a clean anonymized candidate card", () => {
    expect(() =>
      assertNoContactLeak(
        {
          id: "c2",
          city: "Bengaluru",
          age: 29,
          occupation: "Product designer",
          interestText: "trekking and filter coffee",
        },
        { allowNumericFields: ["age"] },
      ),
    ).not.toThrow();
  });

  it("catches an Indian mobile number in any field", () => {
    expect(() =>
      assertNoContactLeak({ note: "reach me on +91 98765 43210" }),
    ).toThrow(ForbiddenError);
  });

  it("catches a bare 10-digit number", () => {
    expect(() => assertNoContactLeak({ note: "9876543210" })).toThrow(
      /phone number/,
    );
  });

  it("catches a number formatted with parens and dashes", () => {
    expect(() => assertNoContactLeak({ note: "(080) 4123-4567" })).toThrow(
      /phone/,
    );
  });

  it("catches an email address", () => {
    expect(() => assertNoContactLeak({ note: "priya.r@example.com" })).toThrow(
      /email address/,
    );
  });

  it("catches a Telegram invite link", () => {
    expect(() =>
      assertNoContactLeak({ note: "join https://t.me/+AbCdEf" }),
    ).toThrow(/contact link/);
  });

  it("catches a WhatsApp link and a group link", () => {
    expect(() => assertNoContactLeak({ note: "wa.me/919876543210" })).toThrow(
      /contact link/,
    );
    expect(() =>
      assertNoContactLeak({ note: "chat.whatsapp.com/XYZ" }),
    ).toThrow(/contact link/);
  });

  it("catches a social handle", () => {
    expect(() =>
      assertNoContactLeak({ note: "find her @priyadesigns" }),
    ).toThrow(/contact link/);
  });

  it("scans nested structures, not just top-level fields", () => {
    // The fields that leak are the ones nobody thought to check.
    expect(() =>
      assertNoContactLeak({
        candidates: [{ profile: { extra: "+919876543210" } }],
      }),
    ).toThrow(ForbiddenError);
  });

  it("allows contact details once a coordinator unlocked them", () => {
    expect(() =>
      assertNoContactLeak(
        { phone: "+919876543210" },
        { contactUnlocked: true },
      ),
    ).not.toThrow();
  });

  it("does not mistake an allowed numeric field for a phone number", () => {
    // Ages and incomes are digit runs too.
    expect(() =>
      assertNoContactLeak(
        { age: 29, incomeMin: 1500000 },
        {
          allowNumericFields: ["age", "incomeMin"],
        },
      ),
    ).not.toThrow();
  });

  it("still catches a phone number alongside allowed numerics", () => {
    expect(() =>
      assertNoContactLeak(
        { age: 29, note: "call 9876543210" },
        { allowNumericFields: ["age"] },
      ),
    ).toThrow(/phone/);
  });

  it("handles null and undefined payloads", () => {
    expect(() => assertNoContactLeak(null)).not.toThrow();
    expect(() => assertNoContactLeak(undefined)).not.toThrow();
  });

  it("handles an empty list", () => {
    expect(() => assertNoContactLeak([])).not.toThrow();
  });

  it("does not flag a short id or a year", () => {
    expect(() =>
      assertNoContactLeak({ id: "c2", matchId: "m1", since: 2024 }),
    ).not.toThrow();
  });
});

describe("looksOffMode", () => {
  it("recognises community-mode requests", () => {
    for (const text of [
      "know a good work cafe?",
      "any coworking nearby",
      "where do people hang out",
      "a gym in koramangala",
    ]) {
      expect(looksOffMode(text)).toBe(true);
    }
  });

  it("does not flag ordinary matrimonial talk", () => {
    for (const text of [
      "someone easygoing who travels",
      "she should be vegetarian",
      "I am 29, based in Pune",
    ]) {
      expect(looksOffMode(text)).toBe(false);
    }
  });

  it("is case-insensitive", () => {
    expect(looksOffMode("A GYM please")).toBe(true);
  });

  it("handles empty input", () => {
    expect(looksOffMode("")).toBe(false);
  });
});
