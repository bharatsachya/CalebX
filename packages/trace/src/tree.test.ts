/// <reference types="bun" />
import { describe, expect, it } from "bun:test";
import { buildTraceTree, renderTraceTree, summarizeByName } from "./tree.ts";
import type { SpanRecord } from "./types.ts";

function span(
  overrides: Partial<SpanRecord> & Pick<SpanRecord, "spanId" | "name">,
): SpanRecord {
  return {
    traceId: "t1",
    parentSpanId: null,
    kind: "internal",
    startedAt: 0,
    endedAt: 10,
    durationMs: 10,
    status: "ok",
    attributes: {},
    events: [],
    ...overrides,
  };
}

describe("buildTraceTree", () => {
  it("nests children under parents", () => {
    const roots = buildTraceTree([
      span({ spanId: "b", name: "child", parentSpanId: "a" }),
      span({ spanId: "a", name: "root" }),
    ]);
    expect(roots).toHaveLength(1);
    expect(roots[0].span.name).toBe("root");
    expect(roots[0].children[0].span.name).toBe("child");
  });

  it("works when children are exported before parents", () => {
    // Spans always arrive in completion order, so this is the normal case.
    const roots = buildTraceTree([
      span({ spanId: "c", name: "grandchild", parentSpanId: "b" }),
      span({ spanId: "b", name: "child", parentSpanId: "a" }),
      span({ spanId: "a", name: "root" }),
    ]);
    expect(roots[0].children[0].children[0].span.name).toBe("grandchild");
  });

  it("promotes an orphan to a root instead of dropping it", () => {
    const roots = buildTraceTree([
      span({ spanId: "b", name: "orphan", parentSpanId: "missing" }),
    ]);
    expect(roots).toHaveLength(1);
    expect(roots[0].span.name).toBe("orphan");
  });

  it("sorts siblings by start time, not export order", () => {
    const roots = buildTraceTree([
      span({ spanId: "a", name: "root" }),
      span({ spanId: "z", name: "late", parentSpanId: "a", startedAt: 50 }),
      span({ spanId: "m", name: "early", parentSpanId: "a", startedAt: 5 }),
    ]);
    expect(roots[0].children.map((c) => c.span.name)).toEqual([
      "early",
      "late",
    ]);
  });

  it("computes self time as duration minus children", () => {
    const roots = buildTraceTree([
      span({ spanId: "a", name: "root", durationMs: 100 }),
      span({ spanId: "b", name: "c1", parentSpanId: "a", durationMs: 30 }),
      span({ spanId: "c", name: "c2", parentSpanId: "a", durationMs: 50 }),
    ]);
    expect(roots[0].selfMs).toBe(20);
  });

  it("clamps self time at zero for overlapping concurrent children", () => {
    // Two children running in parallel can sum past the parent's wall clock.
    const roots = buildTraceTree([
      span({ spanId: "a", name: "root", durationMs: 40 }),
      span({ spanId: "b", name: "c1", parentSpanId: "a", durationMs: 35 }),
      span({ spanId: "c", name: "c2", parentSpanId: "a", durationMs: 35 }),
    ]);
    expect(roots[0].selfMs).toBe(0);
  });

  it("returns several roots when a file holds several traces", () => {
    const roots = buildTraceTree([
      span({ spanId: "a", name: "turn1" }),
      span({ spanId: "b", name: "turn2", traceId: "t2" }),
    ]);
    expect(roots).toHaveLength(2);
  });

  it("returns an empty list for no spans", () => {
    expect(buildTraceTree([])).toEqual([]);
  });

  it("does not loop forever on a self-referencing span", () => {
    // Defensive: a corrupt file should not hang the viewer.
    const roots = buildTraceTree([
      span({ spanId: "a", name: "self", parentSpanId: "a" }),
    ]);
    expect(roots).toHaveLength(0);
  });
});

describe("renderTraceTree", () => {
  it("renders durations and indentation", () => {
    const output = renderTraceTree([
      span({ spanId: "a", name: "agent.turn", durationMs: 900 }),
      span({
        spanId: "b",
        name: "llm.response",
        parentSpanId: "a",
        kind: "llm",
        durationMs: 700,
      }),
    ]);
    expect(output).toContain("agent.turn  900ms");
    expect(output).toContain("└─ ◆ llm.response  700ms");
  });

  it("marks failed spans and shows the error", () => {
    const output = renderTraceTree([
      span({
        spanId: "a",
        name: "tool.search",
        status: "error",
        error: { name: "ForbiddenError", message: "not owner" },
      }),
    ]);
    expect(output).toContain("✗");
    expect(output).toContain("ForbiddenError: not owner");
  });

  it("prints attributes inline", () => {
    const output = renderTraceTree([
      span({ spanId: "a", name: "tool.x", attributes: { mode: "matchmaker" } }),
    ]);
    expect(output).toContain("[mode=matchmaker]");
  });

  it("returns an empty string for no spans", () => {
    expect(renderTraceTree([])).toBe("");
  });
});

describe("summarizeByName", () => {
  it("aggregates count, total, max and errors, slowest first", () => {
    const rows = summarizeByName([
      span({ spanId: "1", name: "llm.response", durationMs: 700 }),
      span({ spanId: "2", name: "llm.response", durationMs: 300 }),
      span({ spanId: "3", name: "db.query", durationMs: 20, status: "error" }),
    ]);
    expect(rows[0]).toEqual({
      name: "llm.response",
      count: 2,
      totalMs: 1000,
      maxMs: 700,
      errors: 0,
    });
    expect(rows[1].errors).toBe(1);
  });

  it("returns an empty list for no spans", () => {
    expect(summarizeByName([])).toEqual([]);
  });
});
