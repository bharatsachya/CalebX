import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { SpanExporter, SpanRecord } from "./types.ts";

/** Keeps spans in memory. The only exporter tests use. */
export class MemoryExporter implements SpanExporter {
  readonly spans: SpanRecord[] = [];

  export(span: SpanRecord): void {
    this.spans.push(span);
  }

  clear(): void {
    this.spans.length = 0;
  }

  /** Spans of one trace, in the order they finished. */
  trace(traceId: string): SpanRecord[] {
    return this.spans.filter((span) => span.traceId === traceId);
  }

  byName(name: string): SpanRecord[] {
    return this.spans.filter((span) => span.name === name);
  }
}

/**
 * One JSON object per line, appended synchronously.
 *
 * Synchronous is the right call here: a worker that is being killed still gets
 * its spans on disk, which is precisely the trace you want when something is
 * crash-looping. Spans are small and infrequent relative to the LLM calls they
 * describe, so the write cost is noise.
 */
export class JsonlFileExporter implements SpanExporter {
  private ready = false;

  constructor(private readonly filePath: string) {}

  export(span: SpanRecord): void {
    if (!this.ready) {
      mkdirSync(path.dirname(this.filePath), { recursive: true });
      this.ready = true;
    }
    appendFileSync(this.filePath, `${JSON.stringify(span)}\n`, "utf8");
  }
}

/**
 * Writes to stdout as JSON lines. Not `console.log` — this is a data stream, and
 * mixing it with human log output through the same call is how log pipelines end
 * up with half-parsed lines.
 */
export class StdoutExporter implements SpanExporter {
  export(span: SpanRecord): void {
    process.stdout.write(`${JSON.stringify({ type: "span", ...span })}\n`);
  }
}

/** Fans out to several exporters; one failing does not stop the others. */
export class MultiExporter implements SpanExporter {
  constructor(private readonly exporters: SpanExporter[]) {}

  export(span: SpanRecord): void {
    for (const exporter of this.exporters) {
      try {
        exporter.export(span);
      } catch {
        /* an exporter must not break its neighbours */
      }
    }
  }

  async flush(): Promise<void> {
    await Promise.all(
      this.exporters.map((e) => e.flush?.() ?? Promise.resolve()),
    );
  }
}
