/// <reference types="bun" />
import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  JsonlFileExporter,
  MemoryExporter,
  MultiExporter,
} from "./exporters.ts";
import type { SpanRecord } from "./types.ts";

const sample: SpanRecord = {
  traceId: "t1",
  spanId: "s1",
  parentSpanId: null,
  name: "agent.turn",
  kind: "internal",
  startedAt: 0,
  endedAt: 5,
  durationMs: 5,
  status: "ok",
  attributes: { mode: "community_connector" },
  events: [],
};

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "calebx-trace-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("MemoryExporter", () => {
  it("collects spans and filters by trace and name", () => {
    const exporter = new MemoryExporter();
    exporter.export(sample);
    exporter.export({ ...sample, spanId: "s2", traceId: "t2", name: "other" });

    expect(exporter.spans).toHaveLength(2);
    expect(exporter.trace("t1")).toHaveLength(1);
    expect(exporter.byName("other")[0].spanId).toBe("s2");
  });

  it("clears without replacing the array reference", () => {
    const exporter = new MemoryExporter();
    const reference = exporter.spans;
    exporter.export(sample);
    exporter.clear();
    expect(reference).toHaveLength(0);
  });
});

describe("JsonlFileExporter", () => {
  it("creates the directory and appends one JSON object per line", () => {
    const filePath = path.join(tempDir(), "nested", "agent.jsonl");
    const exporter = new JsonlFileExporter(filePath);

    exporter.export(sample);
    exporter.export({ ...sample, spanId: "s2" });

    expect(existsSync(filePath)).toBe(true);
    const lines = readFileSync(filePath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect((JSON.parse(lines[1]) as SpanRecord).spanId).toBe("s2");
  });

  it("round-trips attributes and events through JSON", () => {
    const filePath = path.join(tempDir(), "agent.jsonl");
    new JsonlFileExporter(filePath).export({
      ...sample,
      attributes: { count: 3, flagged: true, hint: null },
      events: [{ at: 1, name: "e", attributes: { size: 2 } }],
    });
    const parsed = JSON.parse(
      readFileSync(filePath, "utf8").trim(),
    ) as SpanRecord;
    expect(parsed.attributes).toEqual({ count: 3, flagged: true, hint: null });
    expect(parsed.events[0].attributes.size).toBe(2);
  });
});

describe("MultiExporter", () => {
  it("fans out to every child", () => {
    const a = new MemoryExporter();
    const b = new MemoryExporter();
    new MultiExporter([a, b]).export(sample);
    expect(a.spans).toHaveLength(1);
    expect(b.spans).toHaveLength(1);
  });

  it("keeps going when one child throws", () => {
    const good = new MemoryExporter();
    const bad = {
      export() {
        throw new Error("disk full");
      },
    };
    expect(() => new MultiExporter([bad, good]).export(sample)).not.toThrow();
    expect(good.spans).toHaveLength(1);
  });

  it("flushes children that support it and tolerates those that do not", async () => {
    let flushed = false;
    const withFlush = {
      export() {},
      flush: async () => {
        flushed = true;
      },
    };
    await new MultiExporter([withFlush, new MemoryExporter()]).flush();
    expect(flushed).toBe(true);
  });
});
