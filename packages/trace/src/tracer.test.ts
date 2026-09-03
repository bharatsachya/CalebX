/// <reference types="bun" />
import { beforeEach, describe, expect, it } from "bun:test";
import {
  configureTracer,
  currentContext,
  currentTraceId,
  resetTracer,
  withSpan,
  withTrace,
} from "./tracer.ts";
import { MemoryExporter } from "./exporters.ts";
import { sequentialIds } from "./ids.ts";

/** A clock that only moves when a test tells it to. */
function fakeClock(): { now(): number; advance(ms: number): void } {
  let t = 1_000;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

let exporter: MemoryExporter;
let clock: ReturnType<typeof fakeClock>;

beforeEach(() => {
  resetTracer();
  exporter = new MemoryExporter();
  clock = fakeClock();
  configureTracer({ exporters: [exporter], clock, ids: sequentialIds() });
});

describe("withTrace", () => {
  it("exports one root span with no parent", async () => {
    await withTrace("agent.turn", {}, {}, () => undefined);

    expect(exporter.spans).toHaveLength(1);
    expect(exporter.spans[0].name).toBe("agent.turn");
    expect(exporter.spans[0].parentSpanId).toBeNull();
    expect(exporter.spans[0].status).toBe("ok");
  });

  it("carries userId and mode on the context, masked in attributes", async () => {
    await withTrace(
      "agent.turn",
      { userId: "wa:16505551234", mode: "matchmaker" },
      { attributes: { userId: "wa:16505551234", mode: "matchmaker" } },
      () => {
        expect(currentContext()?.userId).toBe("wa:16505551234");
        expect(currentContext()?.mode).toBe("matchmaker");
      },
    );
    // The context keeps the real id (workers need it); the exported span does not.
    expect(exporter.spans[0].attributes.userId).toBe("wa:***234");
  });

  it("starts a fresh trace even when called inside an existing one", async () => {
    // A queue job is its own trace: it outlives the turn that enqueued it.
    await withTrace("outer", {}, {}, async () => {
      await withTrace("inner", {}, {}, () => undefined);
    });
    const [inner, outer] = exporter.spans;
    expect(inner.traceId).not.toBe(outer.traceId);
    expect(inner.parentSpanId).toBeNull();
  });

  it("honours an inherited traceId so a job can join the turn that queued it", async () => {
    await withTrace("job", { traceId: "abc123" }, {}, () => undefined);
    expect(exporter.spans[0].traceId).toBe("abc123");
  });
});

describe("withSpan nesting", () => {
  it("links children to their parent and shares the trace id", async () => {
    await withTrace("agent.turn", {}, {}, async () => {
      await withSpan("llm.extraction", { kind: "llm" }, () => undefined);
      await withSpan("llm.response", { kind: "llm" }, () => undefined);
    });

    const byName = new Map(exporter.spans.map((s) => [s.name, s]));
    const root = byName.get("agent.turn")!;
    expect(byName.get("llm.extraction")!.parentSpanId).toBe(root.spanId);
    expect(byName.get("llm.response")!.parentSpanId).toBe(root.spanId);
    expect(new Set(exporter.spans.map((s) => s.traceId)).size).toBe(1);
  });

  it("nests three deep without any context threading", async () => {
    await withTrace("a", {}, {}, () =>
      withSpan("b", {}, () => withSpan("c", {}, () => undefined)),
    );
    const byName = new Map(exporter.spans.map((s) => [s.name, s]));
    expect(byName.get("c")!.parentSpanId).toBe(byName.get("b")!.spanId);
    expect(byName.get("b")!.parentSpanId).toBe(byName.get("a")!.spanId);
  });

  it("keeps siblings independent when they run concurrently", async () => {
    await withTrace("root", {}, {}, async () => {
      await Promise.all([
        withSpan("left", {}, () => withSpan("left.child", {}, () => undefined)),
        withSpan("right", {}, () =>
          withSpan("right.child", {}, () => undefined),
        ),
      ]);
    });
    const byName = new Map(exporter.spans.map((s) => [s.name, s]));
    expect(byName.get("left.child")!.parentSpanId).toBe(
      byName.get("left")!.spanId,
    );
    expect(byName.get("right.child")!.parentSpanId).toBe(
      byName.get("right")!.spanId,
    );
  });

  it("starts its own trace when there is no ambient context", async () => {
    await withSpan("orphan", {}, () => undefined);
    expect(exporter.spans[0].parentSpanId).toBeNull();
    expect(exporter.spans[0].traceId).toBeTruthy();
  });

  it("uses an explicitly passed parent over the ambient one", async () => {
    await withTrace("outer", {}, {}, async () => {
      const parent = currentContext()!;
      await withTrace("other", {}, {}, async () => {
        await withSpan("pinned", { parent }, () => undefined);
      });
    });
    const byName = new Map(exporter.spans.map((s) => [s.name, s]));
    expect(byName.get("pinned")!.parentSpanId).toBe(
      byName.get("outer")!.spanId,
    );
    expect(byName.get("pinned")!.traceId).toBe(byName.get("outer")!.traceId);
  });
});

describe("durations", () => {
  it("measures elapsed time from the injected clock", async () => {
    await withTrace("turn", {}, {}, async () => {
      await withSpan("slow", {}, () => {
        clock.advance(250);
      });
      clock.advance(10);
    });
    const byName = new Map(exporter.spans.map((s) => [s.name, s]));
    expect(byName.get("slow")!.durationMs).toBe(250);
    expect(byName.get("turn")!.durationMs).toBe(260);
  });

  it("records a zero duration rather than a negative one", async () => {
    await withTrace("instant", {}, {}, () => undefined);
    expect(exporter.spans[0].durationMs).toBe(0);
  });
});

describe("errors", () => {
  it("marks the span failed, records the error, and rethrows", async () => {
    const boom = new Error("ollama exploded");
    await expect(
      withTrace("turn", {}, {}, () => {
        throw boom;
      }),
    ).rejects.toThrow("ollama exploded");

    const span = exporter.spans[0];
    expect(span.status).toBe("error");
    expect(span.error?.message).toBe("ollama exploded");
    expect(span.error?.name).toBe("Error");
  });

  it("captures a typed error's code field", async () => {
    class Coded extends Error {
      code = "ERR_FORBIDDEN";
    }
    await expect(
      withSpan("authz.check", { kind: "authz" }, () => {
        throw new Coded("nope");
      }),
    ).rejects.toThrow();
    expect(exporter.spans[0].error?.code).toBe("ERR_FORBIDDEN");
  });

  it("still exports the parent when a child throws", async () => {
    await withTrace("turn", {}, {}, async () => {
      await withSpan("child", {}, () => {
        throw new Error("inner");
      }).catch(() => undefined);
    });
    expect(exporter.spans.map((s) => s.name)).toEqual(["child", "turn"]);
    expect(exporter.spans[1].status).toBe("ok");
  });

  it("handles a thrown non-Error", async () => {
    await expect(
      withSpan("weird", {}, () => {
        throw "just a string";
      }),
    ).rejects.toBe("just a string");
    expect(exporter.spans[0].error?.message).toBe("just a string");
  });
});

describe("span mutation", () => {
  it("accepts attributes and events added during the span", async () => {
    await withTrace("turn", {}, {}, (span) => {
      span.setAttributes({ candidateCount: 3 });
      span.addEvent("shortlist.built", { size: 3 });
    });
    const span = exporter.spans[0];
    expect(span.attributes.candidateCount).toBe(3);
    expect(span.events).toHaveLength(1);
    expect(span.events[0].name).toBe("shortlist.built");
  });

  it("redacts attributes added late, not just at construction", async () => {
    await withTrace("turn", {}, {}, (span) => {
      span.setAttributes({ reply_text: "here are three cafes" });
    });
    expect(String(exporter.spans[0].attributes.reply_text)).toStartWith(
      "[redacted:",
    );
  });

  it("exports once even if end() is called twice", async () => {
    await withTrace("turn", {}, {}, (span) => {
      span.end();
    });
    expect(exporter.spans).toHaveLength(1);
  });
});

describe("exporter isolation", () => {
  it("does not fail the traced work when an exporter throws", async () => {
    configureTracer({
      exporters: [
        {
          export() {
            throw new Error("disk full");
          },
        },
        exporter,
      ],
    });
    const result = await withTrace("turn", {}, {}, () => "delivered");
    expect(result).toBe("delivered");
    expect(exporter.spans).toHaveLength(1);
  });

  it("records nothing when tracing is configured off", async () => {
    configureTracer({ exporters: [] });
    await withTrace("turn", {}, {}, () => undefined);
    expect(exporter.spans).toHaveLength(0);
  });
});

describe("currentTraceId", () => {
  it("is undefined outside a trace rather than a made-up id", () => {
    expect(currentTraceId()).toBeUndefined();
  });

  it("matches the exported span's trace id inside one", async () => {
    let seen: string | undefined;
    await withTrace("turn", {}, {}, () => {
      seen = currentTraceId();
    });
    expect(seen).toBe(exporter.spans[0].traceId);
  });

  it("does not leak the context after the trace ends", async () => {
    await withTrace("turn", {}, {}, () => undefined);
    expect(currentTraceId()).toBeUndefined();
  });
});
