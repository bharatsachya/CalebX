/**
 * `bun run packages/trace/src/view.ts [role] [traceId]`
 *
 * Reads a span file and prints traces as trees. With no trace id it prints the
 * most recent few, newest last, so the tail of your terminal is the newest turn.
 */
import { readFileSync } from "node:fs";
import { renderTraceTree, summarizeByName } from "./tree.ts";
import { traceFilePath } from "./setup.ts";
import type { SpanRecord } from "./types.ts";

const role = process.argv[2] ?? "agent";
const wantedTraceId = process.argv[3];
const limit = Number(process.env.TRACE_LIMIT ?? "5");

function readSpans(filePath: string): SpanRecord[] {
  try {
    return readFileSync(filePath, "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as SpanRecord];
        } catch {
          return []; // a torn last line during an active write is expected
        }
      });
  } catch {
    process.stdout.write(`no trace file at ${filePath}\n`);
    return [];
  }
}

const filePath = traceFilePath(role);
const spans = readSpans(filePath);
if (spans.length === 0) process.exit(0);

const byTrace = new Map<string, SpanRecord[]>();
for (const span of spans) {
  const list = byTrace.get(span.traceId) ?? [];
  list.push(span);
  byTrace.set(span.traceId, list);
}

const traceIds = wantedTraceId
  ? [wantedTraceId]
  : [...byTrace.keys()].slice(-limit);

for (const traceId of traceIds) {
  const traceSpans = byTrace.get(traceId) ?? [];
  if (traceSpans.length === 0) {
    process.stdout.write(`trace ${traceId} not found in ${filePath}\n`);
    continue;
  }
  const total =
    Math.max(...traceSpans.map((s) => s.endedAt)) -
    Math.min(...traceSpans.map((s) => s.startedAt));
  process.stdout.write(
    `\ntrace ${traceId}  ${traceSpans.length} spans  ${total}ms\n`,
  );
  process.stdout.write(`${renderTraceTree(traceSpans)}\n`);
}

if (!wantedTraceId) {
  process.stdout.write(`\nslowest span names across ${spans.length} spans\n`);
  for (const row of summarizeByName(spans).slice(0, 10)) {
    process.stdout.write(
      `  ${row.name.padEnd(28)} n=${String(row.count).padStart(4)}  total=${String(row.totalMs).padStart(7)}ms  max=${String(row.maxMs).padStart(6)}ms${row.errors ? `  errors=${row.errors}` : ""}\n`,
    );
  }
}
