/// <reference types="bun" />
import { describe, expect, it } from "bun:test";
import { forgetEverything, type ForgetTargets } from "./forget.ts";

const noop = async () => undefined;
const boom = (message: string) => async () => {
  throw new Error(message);
};

describe("forgetEverything", () => {
  it("reports success when every store was erased", async () => {
    const report = await forgetEverything({
      memories: noop,
      graph: noop,
      modeState: noop,
      reviewTasks: noop,
      consent: noop,
      onboarding: noop,
    });
    expect(report.ok).toBe(true);
    expect(report.failed).toEqual([]);
    expect(report.outcomes).toHaveLength(6);
  });

  it("erases stores in a fixed order, so partial failures are reproducible", async () => {
    const order: string[] = [];
    const record = (name: string) => async () => {
      order.push(name);
    };
    await forgetEverything({
      onboarding: record("onboarding"),
      memories: record("memories"),
      graph: record("graph"),
      consent: record("consent"),
      modeState: record("modeState"),
      reviewTasks: record("reviewTasks"),
    });
    expect(order).toEqual([
      "memories",
      "graph",
      "modeState",
      "reviewTasks",
      "consent",
      "onboarding",
    ]);
  });

  it("keeps erasing the other stores when one fails", async () => {
    // A mem0 outage must not leave the graph and Postgres copies in place.
    const erased: string[] = [];
    const report = await forgetEverything({
      memories: boom("mem0 down"),
      graph: async () => {
        erased.push("graph");
      },
      modeState: async () => {
        erased.push("modeState");
      },
    });
    expect(erased).toEqual(["graph", "modeState"]);
    expect(report.ok).toBe(false);
    expect(report.failed).toEqual(["memories"]);
  });

  it("records the failure message so the user can be told the truth", async () => {
    const report = await forgetEverything({ memories: boom("mem0 down") });
    expect(report.outcomes[0]).toEqual({
      store: "memories",
      ok: false,
      error: "mem0 down",
    });
  });

  it("reports several failures", async () => {
    const report = await forgetEverything({
      memories: boom("a"),
      graph: boom("b"),
      modeState: noop,
    });
    expect(report.failed).toEqual(["memories", "graph"]);
    expect(report.ok).toBe(false);
  });

  it("skips stores that were not supplied", async () => {
    const report = await forgetEverything({ memories: noop });
    expect(report.outcomes.map((o) => o.store)).toEqual(["memories"]);
    expect(report.ok).toBe(true);
  });

  it("treats an empty target set as vacuously complete", async () => {
    const report = await forgetEverything({} as ForgetTargets);
    expect(report.ok).toBe(true);
    expect(report.outcomes).toEqual([]);
  });

  it("stringifies a thrown non-Error", async () => {
    const report = await forgetEverything({
      memories: async () => {
        throw "just a string";
      },
    });
    expect(report.outcomes[0].error).toBe("just a string");
  });
});
