/// <reference types="bun" />
import { describe, expect, it } from "bun:test";
import type { UserModeState } from "@calebx/core";
import {
  modeFromClassification,
  otherMode,
  parseSwitchTarget,
  resolveMode,
  resolveSwitch,
} from "./modes.ts";

const state = (overrides: Partial<UserModeState> = {}): UserModeState => ({
  userId: "tg:1001",
  activeMode: null,
  enrolledModes: [],
  ...overrides,
});

describe("resolveMode", () => {
  it("asks for the router when the user has never been seen", () => {
    expect(resolveMode(null)).toEqual({ kind: "needs_router" });
  });

  it("asks for the router when a row exists with no active mode", () => {
    expect(resolveMode(state())).toEqual({ kind: "needs_router" });
  });

  it("runs the active mode", () => {
    expect(resolveMode(state({ activeMode: "matchmaker" }))).toEqual({
      kind: "run",
      mode: "matchmaker",
    });
  });
});

describe("resolveSwitch", () => {
  it("switches to the other mode when already enrolled", () => {
    const current = state({
      activeMode: "matchmaker",
      enrolledModes: ["matchmaker", "community_connector"],
    });
    expect(resolveSwitch(current)).toEqual({
      kind: "run",
      mode: "community_connector",
    });
  });

  it("requires that mode's consent when not enrolled", () => {
    // The two modes collect genuinely different data, so entering one for the
    // first time needs its own grant.
    const current = state({
      activeMode: "matchmaker",
      enrolledModes: ["matchmaker"],
    });
    expect(resolveSwitch(current)).toEqual({
      kind: "needs_consent",
      mode: "community_connector",
    });
  });

  it("says so when the user is already in the target mode", () => {
    const current = state({
      activeMode: "matchmaker",
      enrolledModes: ["matchmaker", "community_connector"],
    });
    expect(resolveSwitch(current, "matchmaker")).toEqual({
      kind: "already_active",
      mode: "matchmaker",
    });
  });

  it("honours an explicit target over the implicit other one", () => {
    const current = state({
      activeMode: "community_connector",
      enrolledModes: ["matchmaker", "community_connector"],
    });
    expect(resolveSwitch(current, "matchmaker")).toEqual({
      kind: "run",
      mode: "matchmaker",
    });
  });

  it("routes instead of switching when no mode is set yet", () => {
    expect(resolveSwitch(null)).toEqual({ kind: "needs_router" });
    expect(resolveSwitch(state())).toEqual({ kind: "needs_router" });
  });

  it("allows switching back — the lock is not one-way", () => {
    // A misclassified first message must not strand a user in the wrong product.
    const both = ["matchmaker", "community_connector"] as const;
    const first = resolveSwitch(
      state({ activeMode: "matchmaker", enrolledModes: [...both] }),
    );
    expect(first).toEqual({ kind: "run", mode: "community_connector" });
    const back = resolveSwitch(
      state({ activeMode: "community_connector", enrolledModes: [...both] }),
    );
    expect(back).toEqual({ kind: "run", mode: "matchmaker" });
  });
});

describe("otherMode", () => {
  it("flips between the two modes", () => {
    expect(otherMode("matchmaker")).toBe("community_connector");
    expect(otherMode("community_connector")).toBe("matchmaker");
  });

  it("is null when there is no current mode", () => {
    expect(otherMode(null)).toBeNull();
  });
});

describe("parseSwitchTarget", () => {
  it("accepts the canonical names", () => {
    expect(parseSwitchTarget("matchmaker")).toBe("matchmaker");
    expect(parseSwitchTarget("community_connector")).toBe(
      "community_connector",
    );
  });

  it("accepts what people actually type", () => {
    for (const word of ["marriage", "matrimonial", "shaadi", "matches"]) {
      expect(parseSwitchTarget(word)).toBe("matchmaker");
    }
    for (const word of ["community", "friends", "places", "groups", "social"]) {
      expect(parseSwitchTarget(word)).toBe("community_connector");
    }
  });

  it("normalises spacing, case and hyphens", () => {
    expect(parseSwitchTarget("  Community-Connector ")).toBe(
      "community_connector",
    );
    expect(parseSwitchTarget("community connector")).toBe(
      "community_connector",
    );
  });

  it("returns undefined for no argument, meaning 'the other one'", () => {
    expect(parseSwitchTarget(undefined)).toBeUndefined();
    expect(parseSwitchTarget("")).toBeUndefined();
  });

  it("returns undefined for something unrecognised", () => {
    // With two modes, "switch to the other one" is almost always what was meant.
    expect(parseSwitchTarget("astrology")).toBeUndefined();
  });
});

describe("modeFromClassification", () => {
  it("recognises the matchmaker classification", () => {
    expect(modeFromClassification("matchmaker")).toBe("matchmaker");
    expect(modeFromClassification("  MATRIMONIAL  ")).toBe("matchmaker");
    expect(modeFromClassification('{"mode":"matchmaker"}')).toBe("matchmaker");
  });

  it("defaults to the community connector when unsure", () => {
    // The community side collects less and asks less, so a wrong guess there is
    // a mildly odd conversation rather than an opening question about marriage.
    for (const raw of ["", "unknown", "not sure", "banana"]) {
      expect(modeFromClassification(raw)).toBe("community_connector");
    }
  });
});
